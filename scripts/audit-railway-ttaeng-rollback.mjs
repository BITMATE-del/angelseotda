/**
 * Entire synthetic account/escrow/ledger transaction intentionally rolled
 * back. Never schedules a committed payment and never opens an API.
 */
import {randomInt} from "node:crypto";
import postgres from "postgres";
import {reserveAuditTtaeng,resolveAuditTtaeng}
 from "../src/lib/railway/ttaengEscrowRollbackAudit.server.ts";
const enabled=process.env['BACKEND_MODE']==="railway_postgres_staging" &&
 process.env['RAILWAY_ENVIRONMENT_NAME']==="staging" &&
 process.env['ANGEL_TTAENG_ROLLBACK_AUDIT']==="1" &&
 !!process.env['DATABASE_URL'];
if(!enabled){console.error("TTAENG_AUDIT_REFUSED");process.exit(1);}
const db=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
const token="ROLLBACK_TTAENG_AUDIT_INTENTIONAL";
const seed=randomInt(3000000000,8000000000);
const ids=[seed,seed+1,seed+2];
const assert=(condition,why)=>{if(!condition)throw new Error("TTAENG_AUDIT_FAILED:"+why);};
async function mustReject(fn,message) {
 try{await fn();}catch(e){if(e instanceof Error && e.message===message)return;throw e;}
 throw new Error("TTAENG_AUDIT_FAILED:expected "+message);
}
try{
 try{
  await db.begin(async tx=>{
   const users=await tx`
     insert into public.angel_accounts(telegram_id,nickname)
     values(${ids[0]}::bigint,'TTAENG_AUDIT_A'),
           (${ids[1]}::bigint,'TTAENG_AUDIT_B'),
           (${ids[2]}::bigint,'TTAENG_AUDIT_C')
     returning id
   `;
   const [a,b,c]=users.map(r=>String(r['id']));
   for(const id of [a,b,c]){
     await tx`
       insert into public.angel_wallets(account_id,balance,locked_balance)
       values(${id}::uuid,4000,0)
     `;
   }
   const rooms=await tx`
     insert into public.angel_rooms(mode,room_name,base_bet,owner_id)
     values('SUTDA2','TTAENG_ROLLBACK_ONLY',10,${a}::uuid) returning id
   `;
   const roomId=String(rooms[0]?.['id']);
   const rounds=await tx`
     insert into public.angel_rounds(room_id,round_number,phase)
     values(${roomId}::uuid,1,'DEALT_PREVIEW') returning id
   `;
   const roundId=String(rounds[0]?.['id']);
   for(const [id,seat] of [[a,1],[b,2],[c,3]]){
     await tx`
       insert into public.angel_round_players(round_id,account_id,seat_number)
       values(${roundId}::uuid,${id}::uuid,${seat})
     `;
   }
   await tx`
     insert into public.angel_round_private_hands(round_id,account_id,card_ids)
     values
      (${roundId}::uuid,${a}::uuid,${tx.json(["03-gwang","08-gwang"])}),
      (${roundId}::uuid,${b}::uuid,${tx.json(["02-a","05-a"])}),
      (${roundId}::uuid,${c}::uuid,${tx.json(["04-a","06-a"])})
   `;
   // One member unable to reserve 1500 => entire round skips, no partial hold.
   await tx`update public.angel_wallets set balance=1000 where account_id=${b}::uuid`;
   const skipped=await reserveAuditTtaeng(tx,roundId);
   assert(!skipped.reserved&&skipped.count===0,"all-or-none reserve");
   const empty=await tx`
     select count(*)::integer as n from public.angel_ttaeng_audit_escrows
     where round_id=${roundId}::uuid
   `;
   assert(Number(empty[0]?.['n'])===0,"no partial receipts");
   await tx`update public.angel_wallets set balance=4000 where account_id=${b}::uuid`;
   const first=await reserveAuditTtaeng(tx,roundId);
   const replay=await reserveAuditTtaeng(tx,roundId);
   assert(first.reserved&&first.count===3&&!replay.reused===false,"reserved/replay");
   const held=await tx`
     select balance,locked_balance from public.angel_wallets
     where account_id in (${a}::uuid,${b}::uuid,${c}::uuid)
   `;
   assert(held.length===3 && held.every(x=>Number(x['balance'])===4000 &&
     Number(x['locked_balance'])===1500),"reserve locks not debits");
   // Server-owned 38-gwang winner: each other member transfers 1500P.
   const result=await resolveAuditTtaeng(tx,roundId,"SETTLED",a,3);
   assert(result.winnerBonus===3000n&&result.totalCharged===3000n,
     "full gwang bonus 3000");
   await mustReject(
     ()=>resolveAuditTtaeng(tx,roundId,"SETTLED",a,3),
     "TTAENG_ALREADY_RESOLVED");
   const after=await tx`
     select account_id,balance,locked_balance from public.angel_wallets
     where account_id in (${a}::uuid,${b}::uuid,${c}::uuid)
   `;
   const byId=new Map(after.map(x=>[String(x['account_id']),Number(x['balance'])]));
   assert(byId.get(a)===7000 && byId.get(b)===2500 && byId.get(c)===2500,
     "winner and losers amounts");
   assert(after.every(x=>Number(x['locked_balance'])===0),
     "all locks released");
   assert(after.reduce((s,x)=>s+Number(x['balance']),0)===12000,
     "bonus is exactly zero sum");
   const ledger=await tx`
     select count(*)::integer as n,coalesce(sum(e.amount),0)::numeric as net
     from public.angel_ledger_entries e
     join public.angel_ledger_events v on v.id=e.event_id
     where v.round_id=${roundId}::uuid and v.event_type='STAGING_TTAENG_AUDIT'
   `;
   assert(Number(ledger[0]?.['n'])===3 && Number(ledger[0]?.['net'])===0,
     "3 ledger entries, zero company rake");
   console.log("TTAENG_RESERVE_ALL_OR_NONE_PASS");
   console.log("TTAENG_WINNER_TRANSFER_ZERO_SUM_PASS");
   console.log("TTAENG_DOUBLE_RESOLVE_BLOCKED");
   throw new Error(token);
  });
  throw new Error("ROLLBACK_NOT_TRIGGERED");
 }catch(e){if(!(e instanceof Error)||e.message!==token)throw e;}
 const users=await db`
   select count(*)::integer as n from public.angel_accounts
   where telegram_id in (${ids[0]}::bigint,${ids[1]}::bigint,${ids[2]}::bigint)
 `;
 const remaining=await db`
   select count(*)::integer as n from public.angel_ttaeng_audit_escrows
 `;
 const ledger=await db`
   select count(*)::integer as n from public.angel_ledger_events
   where event_type='STAGING_TTAENG_AUDIT'
 `;
 assert(Number(users[0]?.['n'])===0 &&
   Number(remaining[0]?.['n'])===0 &&
   Number(ledger[0]?.['n'])===0,"rollback empty");
 console.log("TTAENG_AUDIT_ROLLBACK_VERIFIED");
}catch(e){
 console.error("TTAENG_AUDIT_FAILED",e instanceof Error?e.message:"UnknownError");
 process.exitCode=1;
}finally{await db.end({timeout:5});}
