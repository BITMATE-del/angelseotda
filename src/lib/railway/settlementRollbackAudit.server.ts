/**
 * NEVER CALL FROM HTTP OR A COMMITTED TRANSACTION.
 * The only allowed caller is scripts/audit-railway-settlement-rollback.mjs,
 * which uses this helper inside an explicitly rolled-back fixture transaction.
 *
 * Mirrors a complete debit + payout + 3% fee ledger posting in ONE TX,
 * using server-owned dealt hands and the isolated simulation state.
 * Not an authorized implementation of legacy rematch/deung-gap/dori payout.
 */
import type postgres from "postgres";
import {isRoomUuid} from "./rooms.server";
import {calculateSimulationShowdown} from "./simulatedShowdown.server";
import {fromMilli,toMilli} from "./bettingPreview.server";
import type {SimState} from "./wagerSimulation.server";
import type {PreviewMode} from "./showdownPreview.server";

type Tx=postgres.TransactionSql;
type Hand={
  accountId:string;seat:number;cards:string[];
  selectedPair?:string[];selectedMake?:string[];
};
const sum=(xs:readonly bigint[])=>xs.reduce((a,b)=>a+b,0n);
const environmentGuard=()=>{
  if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
     process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
     process.env['ANGEL_SETTLEMENT_ROLLBACK_AUDIT']!=="1")
    throw new Error("AUDIT_ONLY");
};

export async function applyRollbackOnlySettlement(tx:Tx,roomId:string) {
  environmentGuard();
  if(!isRoomUuid(roomId))throw new Error("INVALID_ROOM");
  const rooms=await tx`
    select id,mode,status from public.angel_rooms
    where id=${roomId}::uuid for update
  `;
  const room=rooms[0];
  if(room?.['status']!=="WAITING")throw new Error("ROOM_UNAVAILABLE");

  const rounds=await tx`
    select r.id,r.phase,r.settlement_status,r.pot,r.rake_amount,
           runtime.accepts_bets,sim.state
    from public.angel_rounds r
    join public.angel_round_runtime runtime on runtime.round_id=r.id
    join public.angel_wager_simulations sim on sim.round_id=r.id
    where r.room_id=${roomId}::uuid
    order by r.round_number desc limit 1
    for update of r,runtime,sim
  `;
  const round=rounds[0];
  if(!round||round['phase']!=="DEALT_PREVIEW" ||
     round['accepts_bets']!==false)throw new Error("ROUND_NOT_AUDITABLE");
  const roundId=String(round['id']);

  const settings=await tx`
    select key,value from public.angel_app_settings
    where key in ('payments_enabled','settlement_enabled','pot_rake_rate')
    order by key for update
  `;
  const map=Object.fromEntries(settings.map(s=>[s['key'],s['value']]));
  if(settings.length!==3||map['payments_enabled']!==false ||
     map['settlement_enabled']!==false || Number(map['pot_rake_rate'])!==0.03)
    throw new Error("MONETARY_FLAGS_NOT_DISABLED");

  const receipts=await tx`
    select gross_pot,rake_amount,payouts
    from public.angel_settlement_audit_receipts
    where round_id=${roundId}::uuid
  `;
  if(receipts[0]){
    if(round['settlement_status']!=="POSTED")
      throw new Error("AUDIT_RECEIPT_STATE_MISMATCH");
    return {reused:true,pot:String(receipts[0]['gross_pot']),
      fee:String(receipts[0]['rake_amount']),payouts:receipts[0]['payouts']};
  }
  if(round['settlement_status']!=="PENDING" ||
     toMilli(String(round['pot']))!==0n ||
     toMilli(String(round['rake_amount']))!==0n)
    throw new Error("ROUND_ALREADY_HAS_MONEY");

  const pending=await tx`
    select count(*)::integer as n from public.angel_ledger_events
    where round_id=${roundId}::uuid
  `;
  if(Number(pending[0]?.['n'])!==0)throw new Error("ROUND_HAS_LEDGER_EVENTS");
  const playerRows=await tx`
    select p.account_id,p.seat_number,p.committed_amount,p.payout_amount,
           a.status,h.card_ids,s.selected_card_ids
    from public.angel_round_players p
    join public.angel_accounts a on a.id=p.account_id
    join public.angel_round_private_hands h
      on h.round_id=p.round_id and h.account_id=p.account_id
    left join public.angel_round_final_selections s
      on s.round_id=p.round_id and s.account_id=p.account_id
    where p.round_id=${roundId}::uuid
    order by p.seat_number for update of p
  `;
  const state=round['state'] as SimState;
  if(!state?.complete || !Array.isArray(state.players) ||
     playerRows.length!==state.players.length)
    throw new Error("SIM_NOT_COMPLETE_OR_PLAYERS_CHANGED");
  const mode=String(room['mode']) as PreviewMode;
  const hands:Hand[]=playerRows.map(p=>{
    if(p['status']!=="ACTIVE" ||
       toMilli(String(p['committed_amount']))!==0n ||
       toMilli(String(p['payout_amount']))!==0n)
      throw new Error("MEMBER_OR_ROUND_DIRTY");
    if(!Array.isArray(p['card_ids'])||
       !p['card_ids'].every((x:unknown)=>typeof x==="string"))
      throw new Error("PRIVATE_HAND_CORRUPT");
    const choice=p['selected_card_ids'];
    if(choice!==null&&!Array.isArray(choice))throw new Error("FINAL_CHOICE_CORRUPT");
    return {
      accountId:String(p['account_id']),seat:Number(p['seat_number']),
      cards:p['card_ids'] as string[],
      ...(mode==="SUTDA3"&&Array.isArray(choice)?{selectedPair:choice as string[]}:{}),
      ...(mode==="DORI"&&Array.isArray(choice)?{selectedMake:choice as string[]}:{}),
    };
  });
  const calculated=calculateSimulationShowdown(mode,state,hands);
  if(calculated.status!=="CALCULATED")throw new Error("SHOWDOWN_NOT_FINAL");
  const seatAccount=new Map(hands.map(h=>[h.seat,h.accountId]));
  const gross=toMilli(calculated.pot),fee=toMilli(calculated.fee);
  const payouts=calculated.payouts.map(p=>({
    accountId:seatAccount.get(p.seat)??"",seat:p.seat,amount:p.amount,
  }));
  if(payouts.some(p=>!p.accountId)||sum(payouts.map(p=>toMilli(p.amount)))+fee!==gross)
    throw new Error("SETTLEMENT_BALANCE_MISMATCH");
  const contributions=state.players.map(p=>({
    accountId:seatAccount.get(p.seat)??"",seat:p.seat,amount:p.contributed,
  }));
  if(contributions.some(p=>!p.accountId) ||
     sum(contributions.map(p=>toMilli(p.amount)))!==gross)
    throw new Error("CONTRIBUTION_MISMATCH");

  // Deterministic ordering for concurrent account operations. The mock
  // wallet must already be funded by the rollback-only fixture.
  const sorted=[...hands].sort((a,b)=>a.accountId.localeCompare(b.accountId));
  const startingBalances=new Map<string,bigint>();
  for(const h of sorted){
    const wallets=await tx`
      select w.balance,w.locked_balance from public.angel_wallets w
      where w.account_id=${h.accountId}::uuid for update
    `;
    if(!wallets[0])throw new Error("WALLET_NOT_FOUND");
    const bal=toMilli(String(wallets[0]['balance']));
    const locked=toMilli(String(wallets[0]['locked_balance']));
    const debit=toMilli(contributions.find(p=>p.accountId===h.accountId)!.amount);
    if(bal-locked<debit)throw new Error("INSUFFICIENT_AVAILABLE_BALANCE");
    startingBalances.set(h.accountId,bal);
  }

  const event=await tx`
    insert into public.angel_ledger_events
      (idempotency_key,event_type,round_id,metadata)
    values (${'rollback-audit:'+roundId},
      'STAGING_ROLLBACK_SETTLEMENT',${roundId}::uuid,
      ${tx.json({auditOnly:true,rollbackMandatory:true,
        grossPot:calculated.pot,rake:calculated.fee})})
    returning id
  `;
  const eventId=String(event[0]?.['id']);
  for(const h of sorted){
    const debit=toMilli(contributions.find(p=>p.accountId===h.accountId)!.amount);
    const credit=toMilli(payouts.find(p=>p.accountId===h.accountId)!.amount);
    const finalBalance=startingBalances.get(h.accountId)!-debit+credit;
    const updated=await tx`
      update public.angel_wallets
      set balance=${fromMilli(finalBalance)}::numeric,updated_at=now()
      where account_id=${h.accountId}::uuid
      returning balance
    `;
    if(updated.length!==1)throw new Error("WALLET_UPDATE_FAILED");
    if(debit>0n)await tx`
      insert into public.angel_ledger_entries(event_id,account_id,amount)
      values(${eventId}::uuid,${h.accountId}::uuid,-${fromMilli(debit)}::numeric)
    `;
    if(credit>0n)await tx`
      insert into public.angel_ledger_entries(event_id,account_id,amount)
      values(${eventId}::uuid,${h.accountId}::uuid,${fromMilli(credit)}::numeric)
    `;
    await tx`
      update public.angel_round_players
      set committed_amount=${fromMilli(debit)}::numeric,
          payout_amount=${fromMilli(credit)}::numeric
      where round_id=${roundId}::uuid and account_id=${h.accountId}::uuid
    `;
  }
  const updatedRound=await tx`
    update public.angel_rounds set
      pot=${calculated.pot}::numeric,rake_amount=${calculated.fee}::numeric,
      settlement_status='POSTED',closed_at=now()
    where id=${roundId}::uuid and settlement_status='PENDING'
    returning id
  `;
  if(updatedRound.length!==1)throw new Error("ROUND_SETTLEMENT_CONFLICT");
  await tx`
    insert into public.angel_settlement_audit_receipts
      (round_id,ledger_event_id,gross_pot,rake_amount,payouts)
    values (${roundId}::uuid,${eventId}::uuid,${calculated.pot}::numeric,
            ${calculated.fee}::numeric,${tx.json(payouts)})
  `;
  const reconciliation=await tx`
    select coalesce(sum(amount),0)::numeric as total
    from public.angel_ledger_entries where event_id=${eventId}::uuid
  `;
  if(toMilli(String(reconciliation[0]?.['total']))!==-fee)
    throw new Error("LEDGER_RAKE_RECONCILIATION_FAILED");
  return {reused:false,pot:calculated.pot,fee:calculated.fee,
    payouts,ledgerEventId:eventId,rollbackMandatory:true};
}
