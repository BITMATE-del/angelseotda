/**
 * Rollback-only PostgreSQL financial audit. Creates three synthetic members
 * and complete server-owned cards, runs a virtual wager then applies a
 * hypothetical atomic wallet debit + payout, verifies 3% rake conservation,
 * retry safety, insufficient funds guard and mandatory full rollback.
 *
 * NEVER committed. MUST run only with ANGEL_SETTLEMENT_ROLLBACK_AUDIT=1
 * and staging environment guards. No HTTP path is wired to this helper.
 */
import {randomInt,randomUUID} from "node:crypto";
import postgres from "postgres";
import {initializeWagerSimulation,applyWagerSimulation}
  from "../src/lib/railway/wagerSimulationStore.server.ts";
import {applyRollbackOnlySettlement}
  from "../src/lib/railway/settlementRollbackAudit.server.ts";
if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
   process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
   process.env['ANGEL_SETTLEMENT_ROLLBACK_AUDIT']!=="1" ||
   !process.env['DATABASE_URL']){
  console.error("SETTLEMENT_ROLLBACK_AUDIT_REFUSED");process.exit(1);
}
const db=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
const rollback="SETTLEMENT_ROLLBACK_INTENTIONAL";
const seed=randomInt(3000000000,8000000000);
const telegrams=[seed,seed+1,seed+2];
const rid=()=> "rollback_"+randomUUID().replaceAll("-","");
const assert=(x,reason)=>{if(!x)throw new Error("SETTLEMENT_AUDIT_FAILED:"+reason);};
async function mustFail(callback,message){
  try{await callback();}catch(e){
    if(e instanceof Error&&e.message===message)return;
    throw e;
  }
  throw new Error("SETTLEMENT_AUDIT_FAILED:expected "+message);
}
try{
  try{
    await db.begin(async tx=>{
      const users=await tx`
        insert into public.angel_accounts(telegram_id,nickname)
        values
          (${telegrams[0]}::bigint,'AUDIT_SETTLE_A'),
          (${telegrams[1]}::bigint,'AUDIT_SETTLE_B'),
          (${telegrams[2]}::bigint,'AUDIT_SETTLE_C')
        returning id
      `;
      assert(users.length===3,"three synthetic accounts");
      const [a,b,c]=users.map(x=>String(x['id']));
      await tx`
        insert into public.angel_wallets(account_id,balance,locked_balance)
        values (${a}::uuid,100,0),(${b}::uuid,100,0),(${c}::uuid,100,0)
      `;
      const rooms=await tx`
        insert into public.angel_rooms(mode,room_name,base_bet,owner_id)
        values('SUTDA2','ROLLBACK_SETTLEMENT_ONLY',10,${a}::uuid)
        returning id
      `;
      const roomId=String(rooms[0]?.['id']);
      const rounds=await tx`
        insert into public.angel_rounds(room_id,round_number,phase)
        values (${roomId}::uuid,1,'DEALT_PREVIEW') returning id
      `;
      const roundId=String(rounds[0]?.['id']);
      await tx`
        insert into public.angel_round_runtime(round_id,turn_seat,accepts_bets)
        values(${roundId}::uuid,1,false)
      `;
      for(const [id,seat] of [[a,1],[b,2],[c,3]]){
        await tx`
          insert into public.angel_round_players
            (round_id,account_id,seat_number)
          values (${roundId}::uuid,${id}::uuid,${seat})
        `;
      }
      await tx`
        insert into public.angel_round_private_hands
          (round_id,account_id,card_ids)
        values
          (${roundId}::uuid,${a}::uuid,${tx.json(["03-gwang","08-gwang"])}),
          (${roundId}::uuid,${b}::uuid,${tx.json(["02-a","05-a"])}),
          (${roundId}::uuid,${c}::uuid,${tx.json(["04-a","06-a"])})
      `;
      await initializeWagerSimulation(tx,a,roomId);
      await applyWagerSimulation(tx,a,roomId,rid(),"check");
      await applyWagerSimulation(tx,b,roomId,rid(),"ping");
      await applyWagerSimulation(tx,c,roomId,rid(),"call");
      const end=await applyWagerSimulation(tx,a,roomId,rid(),"call");
      assert(end.complete===true && end.samplePot==="30.000","wager complete");

      // A losing player's real, synthetic wallet cannot cover their stake.
      await tx`update public.angel_wallets set balance=5
        where account_id=${b}::uuid`;
      await mustFail(()=>applyRollbackOnlySettlement(tx,roomId),
        "INSUFFICIENT_AVAILABLE_BALANCE");
      const unchanged=await tx`
        select pot,settlement_status from public.angel_rounds
        where id=${roundId}::uuid
      `;
      assert(Number(unchanged[0]?.['pot'])===0 &&
        unchanged[0]?.['settlement_status']==="PENDING",
        "insufficient funds never post");
      await tx`update public.angel_wallets set balance=100
        where account_id=${b}::uuid`;

      const posted=await applyRollbackOnlySettlement(tx,roomId);
      assert(posted.reused===false&&posted.pot==="30.000"&&posted.fee==="1.000",
        "single atomic settlement");
      assert(posted.payouts.find(p=>p.seat===1)?.amount==="29.000",
        "payout winner 38 gwang");
      const replay=await applyRollbackOnlySettlement(tx,roomId);
      assert(replay.reused===true,"same round never double posts");

      const verify=await tx`
        select r.pot,r.rake_amount,r.settlement_status,
          (select count(*)::integer from public.angel_settlement_audit_receipts
           where round_id=r.id) as receipts,
          (select count(*)::integer from public.angel_ledger_events
           where round_id=r.id) as events,
          (select coalesce(sum(e.amount),0)::numeric
           from public.angel_ledger_entries e
           join public.angel_ledger_events v on v.id=e.event_id
           where v.round_id=r.id) as ledger_net,
          (select coalesce(sum(committed_amount),0)::numeric
           from public.angel_round_players where round_id=r.id) as committed,
          (select coalesce(sum(payout_amount),0)::numeric
           from public.angel_round_players where round_id=r.id) as paid
        from public.angel_rounds r where r.id=${roundId}::uuid
      `;
      const v=verify[0];
      assert(v?.['settlement_status']==="POSTED" &&
        Number(v?.['pot'])===30&&Number(v?.['rake_amount'])===1,
        "round marked posted exactly once");
      assert(Number(v?.['receipts'])===1&&Number(v?.['events'])===1,
        "unique receipt and ledger event");
      assert(Number(v?.['committed'])===30&&Number(v?.['paid'])===29 &&
        Number(v?.['ledger_net'])===-1,"ledger and fees reconcile");
      const wallets=await tx`
        select account_id,balance,locked_balance
        from public.angel_wallets
        where account_id in (${a}::uuid,${b}::uuid,${c}::uuid)
      `;
      const sums=wallets.reduce((s,w)=>s+Number(w['balance']),0);
      assert(Math.abs(sums-299)<0.000001,"rake only monetary sink");
      assert(wallets.every(w=>Number(w['balance'])>=Number(w['locked_balance'])),
        "all wallet locks conserved");
      console.log("SETTLEMENT_ATOMIC_LEDGER_AUDIT_PASS");
      console.log("SETTLEMENT_INSUFFICIENT_FUNDS_GUARD_PASS");
      console.log("SETTLEMENT_DOUBLE_POST_GUARD_PASS");
      // Required abort of the ENTIRE test transaction, even after success.
      throw new Error(rollback);
    });
    throw new Error("SETTLEMENT_AUDIT_ROLLBACK_NOT_TRIGGERED");
  }catch(e){
    if(!(e instanceof Error)||e.message!==rollback)throw e;
  }
  const remaining=await db`
    select count(*)::integer as n from public.angel_accounts
    where telegram_id in
      (${telegrams[0]}::bigint,${telegrams[1]}::bigint,${telegrams[2]}::bigint)
  `;
  assert(Number(remaining[0]?.['n'])===0,"synthetic accounts rolled back");
  const auditEvents=await db`
    select count(*)::integer as n from public.angel_ledger_events
    where event_type='STAGING_ROLLBACK_SETTLEMENT'
  `;
  assert(Number(auditEvents[0]?.['n'])===0,"no audit settlement permanently posted");
  console.log("SETTLEMENT_ROLLBACK_VERIFIED");
}catch(e){
  console.error("SETTLEMENT_AUDIT_FAILED",
    e instanceof Error?e.message:"UnknownError");
  process.exitCode=1;
}finally{await db.end({timeout:5});}
