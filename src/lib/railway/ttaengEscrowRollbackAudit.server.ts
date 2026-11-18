/**
 * STRICTLY ROLLBACK-ONLY rehearsal of Sutda ttaeng escrow.
 * No public route, no worker, no committed transaction.
 * Uses originalTtaengEscrow calculator; never trusts browser input.
 */
import type postgres from "postgres";
import {isRoomUuid} from "./rooms.server";
import {calculateOriginalTtaengEscrow} from "./originalGameFeePolicy.server";
import {toMilli,fromMilli} from "./bettingPreview.server";
import {evaluateSutda2} from "@/lib/game/sutda2Rules";
type Tx=postgres.TransactionSql;
const auditGuard=()=>{
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
    process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
    process.env['ANGEL_TTAENG_ROLLBACK_AUDIT']!=="1")
    throw new Error("AUDIT_ONLY");
};
const points=(n:bigint)=>fromMilli(n*1000n);
const integer=(value:string)=>{
  const n=toMilli(value);
  if(n%1000n!==0n)throw new Error("INTEGER_POINTS_REQUIRED");
  return n/1000n;
};
const sampleSchedule={regular:500n,jang:1000n,gwang:1500n};
const isMode=(v:string)=>v==="SUTDA2"||v==="SUTDA3";

export async function reserveAuditTtaeng(tx:Tx,roundId:string){
  auditGuard();
  if(!isRoomUuid(roundId))throw new Error("INVALID_ROUND");
  const rounds=await tx`
    select r.id,r.phase,r.settlement_status,rm.mode,rm.status
    from public.angel_rounds r
    join public.angel_rooms rm on rm.id=r.room_id
    where r.id=${roundId}::uuid for update of r,rm
  `;
  const round=rounds[0];
  if(!round || !isMode(String(round['mode'])))
    throw new Error("TTAENG_NOT_FOR_DORI");
  if(round['status']!=="WAITING"||round['phase']!=="DEALT_PREVIEW"||
     round['settlement_status']!=="PENDING")
    throw new Error("ROUND_NOT_AUDITABLE");
  const previous=await tx`
    select account_id,reserved,state from public.angel_ttaeng_audit_escrows
    where round_id=${roundId}::uuid order by account_id
  `;
  if(previous.length){
    if(previous.some(x=>x['state']!=="HELD"))throw new Error("TTAENG_ALREADY_RESOLVED");
    return {reserved:true,reused:true,count:previous.length};
  }
  const members=await tx`
    select p.account_id,a.status from public.angel_round_players p
    join public.angel_accounts a on a.id=p.account_id
    where p.round_id=${roundId}::uuid order by p.account_id
  `;
  if(members.length<2||members.length>(round['mode']==="SUTDA3"?6:10)||
    members.some(x=>x['status']!=="ACTIVE"))
    throw new Error("INVALID_TTAENG_PARTICIPANTS");
  // Stable wallet row lock order across every participant.
  const locked=[];
  for(const member of members){
    const id=String(member['account_id']);
    const wallet=await tx`
      select balance,locked_balance from public.angel_wallets
      where account_id=${id}::uuid for update
    `;
    if(!wallet[0])throw new Error("WALLET_NOT_FOUND");
    locked.push({id,balance:integer(String(wallet[0]['balance'])),
      held:integer(String(wallet[0]['locked_balance']))});
  }
  // Entire ttaeng feature is disabled for the round if one member cannot
  // reserve max liability. No partial locks, no debt.
  if(locked.some(w=>w.balance-w.held<sampleSchedule.gwang))
    return {reserved:false,reused:false,count:0};
  for(const w of locked){
    await tx`
      update public.angel_wallets
      set locked_balance=locked_balance+${points(sampleSchedule.gwang)}::numeric,
        updated_at=now()
      where account_id=${w.id}::uuid
    `;
    await tx`
      insert into public.angel_ttaeng_audit_escrows(round_id,account_id,reserved)
      values(${roundId}::uuid,${w.id}::uuid,${points(sampleSchedule.gwang)}::numeric)
    `;
  }
  return {reserved:true,reused:false,count:locked.length};
}

/** Server-owned winner ID and card check; caller supplies a resolution ONLY
 * inside the audit harness. Fold/rematch/void always release all locks.
 */
export async function resolveAuditTtaeng(tx:Tx,roundId:string,
  resolution:"SETTLED"|"REMATCH"|"VOID"|"REFUNDED",winnerId:string|null,
  nonFoldedCount:number){
  auditGuard();
  if(!isRoomUuid(roundId))throw new Error("INVALID_ROUND");
  const roundRows=await tx`
    select r.id,r.phase,r.settlement_status,rm.mode,rm.status
    from public.angel_rounds r
    join public.angel_rooms rm on rm.id=r.room_id
    where r.id=${roundId}::uuid for update of r,rm
  `;
  const round=roundRows[0];
  if(!round||!isMode(String(round['mode'])))throw new Error("TTAENG_NOT_FOR_DORI");
  if(round['status']!=="WAITING"||round['phase']!=="DEALT_PREVIEW" ||
     round['settlement_status']!=="PENDING")throw new Error("ROUND_NOT_AUDITABLE");
  const escrows=await tx`
    select e.account_id,e.reserved,e.charged,e.state,h.card_ids,
           a.status
    from public.angel_ttaeng_audit_escrows e
    join public.angel_accounts a on a.id=e.account_id
    join public.angel_round_private_hands h
      on h.round_id=e.round_id and h.account_id=e.account_id
    where e.round_id=${roundId}::uuid
    order by e.account_id for update of e
  `;
  if(!escrows.length)throw new Error("TTAENG_NOT_RESERVED");
  if(escrows.some(x=>x['state']!=="HELD"))
    throw new Error("TTAENG_ALREADY_RESOLVED");
  if(escrows.some(x=>x['status']!=="ACTIVE"))
    throw new Error("INACTIVE_PLAYER");
  const ids=escrows.map(x=>String(x['account_id']));
  if(winnerId && !ids.includes(winnerId))throw new Error("TTAENG_INVALID_WINNER");
  // Never accept a caller-supplied hand grade. Read verified server cards.
  let winnerHandCode:string|null=null;
  if(resolution==="SETTLED"&&winnerId){
    const owned=escrows.find(x=>String(x['account_id'])===winnerId);
    const cards=owned?.['card_ids'];
    if(!Array.isArray(cards))throw new Error("PRIVATE_HAND_CORRUPT");
    if(round['mode']==="SUTDA2"){
      winnerHandCode=evaluateSutda2(cards as string[]).code;
    }else{
      const choice=await tx`
        select selected_card_ids from public.angel_round_final_selections
        where round_id=${roundId}::uuid and account_id=${winnerId}::uuid
      `;
      if(!choice[0]||!Array.isArray(choice[0]['selected_card_ids']))
        throw new Error("FINAL_CHOICE_REQUIRED");
      const pair=choice[0]['selected_card_ids'] as string[];
      if(pair.length!==2 || !pair.every(c=>cards.includes(c)))
        throw new Error("FINAL_CHOICE_INVALID");
      winnerHandCode=evaluateSutda2(pair).code;
    }
  }
  const result=calculateOriginalTtaengEscrow({
    mode:round['mode'] as "SUTDA2"|"SUTDA3",participants:ids,
    reservations:Object.fromEntries(escrows.map(x=>[
      String(x['account_id']),integer(String(x['reserved']))])),
    status:resolution,winnerId,winnerHandCode,nonFoldedCount,
    schedule:sampleSchedule,
  });
  const event=await tx`
    insert into public.angel_ledger_events(idempotency_key,event_type,round_id,metadata)
    values(${'ttaeng-audit:'+roundId},'STAGING_TTAENG_AUDIT',${roundId}::uuid,
      ${tx.json({rollbackMandatory:true,resolution})}) returning id
  `;
  const eventId=String(event[0]?.['id']);
  // Lock wallets in deterministic order. Existing wallet balance holds
  // already reserved funds; releasing lock and transferring losers' fees
  // must occur in this same transaction.
  for(const id of ids){
    const wallet=await tx`
      select balance,locked_balance from public.angel_wallets
      where account_id=${id}::uuid for update
    `;
    const held=integer(String(escrows.find(x=>String(x['account_id'])===id)!['reserved']));
    if(!wallet[0]||integer(String(wallet[0]['locked_balance']))<held)
      throw new Error("TTAENG_ESCROW_LOCK_MISMATCH");
    const paid=result.paidBy[id]??0n;
    const received=id===winnerId?result.winnerBonus:0n;
    const next=integer(String(wallet[0]['balance']))-paid+received;
    const remainingLock=integer(String(wallet[0]['locked_balance']))-held;
    if(next<remainingLock)throw new Error("TTAENG_BALANCE_INCONSISTENT");
    await tx`
      update public.angel_wallets
      set balance=${points(next)}::numeric,
          locked_balance=${points(remainingLock)}::numeric,updated_at=now()
      where account_id=${id}::uuid
    `;
    if(paid>0n)await tx`
      insert into public.angel_ledger_entries(event_id,account_id,amount)
      values(${eventId}::uuid,${id}::uuid,-${points(paid)}::numeric)
    `;
    if(received>0n)await tx`
      insert into public.angel_ledger_entries(event_id,account_id,amount)
      values(${eventId}::uuid,${id}::uuid,${points(received)}::numeric)
    `;
    await tx`
      update public.angel_ttaeng_audit_escrows
      set charged=${points(paid)}::numeric,
        state=${resolution==="SETTLED"?"SETTLED":"REFUNDED"}
      where round_id=${roundId}::uuid and account_id=${id}::uuid
    `;
  }
  const ledger=await tx`
    select coalesce(sum(amount),0)::numeric as net from public.angel_ledger_entries
    where event_id=${eventId}::uuid
  `;
  if(Number(ledger[0]?.['net'])!==0)
    throw new Error("TTAENG_NOT_ZERO_SUM");
  return {winnerBonus:result.winnerBonus,
    totalCharged:Object.values(result.paidBy).reduce((a,b)=>a+b,0n),
    refunded:result.refunds,resolution,rollbackMandatory:true};
}
