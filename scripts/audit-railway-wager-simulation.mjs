/**
 * Real Railway staging PostgreSQL audit: independent simulated raises/calls
 * + request id replay, out-of-turn rejection, zero real ledger/pot.
 * Every account/room/sim/action is rolled back as ONE transaction.
 */
import {randomInt,randomUUID} from "node:crypto";
import postgres from "postgres";
import {calculateSimulationShowdown} from "../src/lib/railway/simulatedShowdown.server.ts";
import {
  initializeWagerSimulation,applyWagerSimulation,
} from "../src/lib/railway/wagerSimulationStore.server.ts";
if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
   process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
   !process.env['DATABASE_URL']){
  console.error("SIM_AUDIT_REFUSED");process.exit(1);
}
const sql=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
const marker="SIM_AUDIT_EXPECTED_ROLLBACK";
const seed=randomInt(3000000000,8000000000);
const ids=[seed,seed+1,seed+2];
const request=()=> "wager_"+randomUUID().replaceAll("-","");
const assert=(condition,why)=>{if(!condition)throw new Error("SIM_AUDIT_FAILED:"+why);};
async function rejects(fn,reason){
  try{await fn();}catch(e){if(e instanceof Error && e.message===reason)return;throw e;}
  throw new Error("SIM_AUDIT_FAILED:expected "+reason);
}
try{
  try{
    await sql.begin(async tx=>{
      const accounts=await tx`
        insert into public.angel_accounts(telegram_id,nickname)
        values(${ids[0]}::bigint,'SIM_A'),(${ids[1]}::bigint,'SIM_B'),
              (${ids[2]}::bigint,'SIM_C') returning id
      `;
      assert(accounts.length===3,"create fake accounts");
      const [a,b,c]=accounts.map(row=>String(row['id']));
      const rooms=await tx`
        insert into public.angel_rooms(mode,room_name,base_bet,owner_id)
        values('SUTDA2','SIM_ROLLBACK_ONLY',10,${a}::uuid) returning id
      `;
      const roomId=String(rooms[0]?.['id']);
      const rounds=await tx`
        insert into public.angel_rounds(room_id,round_number,phase)
        values(${roomId}::uuid,1,'DEALT_PREVIEW') returning id
      `;
      const roundId=String(rounds[0]?.['id']);
      await tx`insert into public.angel_round_runtime(round_id,turn_seat,accepts_bets)
        values(${roundId}::uuid,1,false)`;
      for(const [account,seat] of [[a,1],[b,2],[c,3]]){
        await tx`
          insert into public.angel_round_players(round_id,account_id,seat_number)
          values(${roundId}::uuid,${account}::uuid,${seat})
        `;
      }
      await tx`
        insert into public.angel_round_private_hands(round_id,account_id,card_ids)
        values
        (${roundId}::uuid,${a}::uuid,${tx.json(["03-gwang","08-gwang"])}),
        (${roundId}::uuid,${b}::uuid,${tx.json(["02-a","05-a"])}),
        (${roundId}::uuid,${c}::uuid,${tx.json(["04-a","06-a"])})
      `;
      const started=await initializeWagerSimulation(tx,a,roomId);
      assert(started.turnSeat===1 && started.samplePot==="0.000","start");
      await rejects(()=>initializeWagerSimulation(tx,b,roomId),"OWNER_ONLY");
      await applyWagerSimulation(tx,a,roomId,request(),"check");
      const raiseRequest=request();
      const raised=await applyWagerSimulation(tx,b,roomId,raiseRequest,"ping");
      assert(raised.turnSeat===3 && raised.sampleCurrentBet==="10.000","raise");
      const repeat=await applyWagerSimulation(tx,b,roomId,raiseRequest,"ping");
      assert(repeat.reused===true,"replay");
      await rejects(()=>applyWagerSimulation(tx,c,roomId,raiseRequest,"ping"),"REQUEST_ID_CONFLICT");
      await applyWagerSimulation(tx,c,roomId,request(),"call");
      const final=await applyWagerSimulation(tx,a,roomId,request(),"call");
      assert(final.complete && final.samplePot==="30.000","all match and close");
      await rejects(()=>applyWagerSimulation(tx,b,roomId,request(),"call"),"SIM_ROUND_COMPLETE");
      const inspect=await tx`
        select
          (select pot from public.angel_rounds where id=${roundId}::uuid) as real_pot,
          (select count(*)::integer from public.angel_ledger_events
            where round_id=${roundId}::uuid) as ledger_events,
          (select count(*)::integer from public.angel_wager_sim_actions
            where round_id=${roundId}::uuid) as sim_actions,
          (select count(*)::integer from public.angel_bet_receipts
            where round_id=${roundId}::uuid) as receipts,
          (select sum(committed_amount) from public.angel_round_players
            where round_id=${roundId}::uuid) as real_committed
      `;
      assert(Number(inspect[0]?.['real_pot'])===0,"real POT unchanged");
      assert(Number(inspect[0]?.['ledger_events'])===0,"ledger untouched");
      assert(Number(inspect[0]?.['receipts'])===0,"no real debit receipt");
      assert(Number(inspect[0]?.['real_committed'])===0,"real committed unchanged");
      assert(Number(inspect[0]?.['sim_actions'])===4,"exactly four actions");
      const saved=await tx`
        select state from public.angel_wager_simulations
        where round_id=${roundId}::uuid
      `;
      const privateHands=await tx`
        select p.account_id,p.seat_number,h.card_ids
        from public.angel_round_players p
        join public.angel_round_private_hands h
          on h.round_id=p.round_id and h.account_id=p.account_id
        where p.round_id=${roundId}::uuid order by p.seat_number
      `;
      const showdown=calculateSimulationShowdown("SUTDA2",saved[0]['state'],
        privateHands.map(h=>({
          accountId:String(h['account_id']),seat:Number(h['seat_number']),
          cards:h['card_ids'],
        })));
      assert(showdown.status==="CALCULATED","server-only showdown");
      assert(showdown.pot==="30.000"&&showdown.fee==="1.000",
        "original whole-point 3 percent rake");
      assert(showdown.winnerSeats?.join(",")==="1","38-gwang wins");
      assert(showdown.payouts?.find(p=>p.seat===1)?.amount==="29.000",
        "virtual payout reconciled");
      console.log("WAGER_SIM_SHOWDOWN_AUDIT_PASS");
      console.log("WAGER_SIM_DB_AUDIT_PASS");
      throw new Error(marker);
    });
    throw new Error("SIM_AUDIT_NO_ROLLBACK");
  }catch(e){if(!(e instanceof Error)||e.message!==marker)throw e;}
  const remaining=await sql`
    select count(*)::integer as n from public.angel_accounts
    where telegram_id in (${ids[0]}::bigint,${ids[1]}::bigint,${ids[2]}::bigint)
  `;
  assert(Number(remaining[0]?.['n'])===0,"synthetic records rollback");
  console.log("WAGER_SIM_ROLLBACK_VERIFIED");
}catch(e){
  console.error("WAGER_SIM_AUDIT_FAILED",e instanceof Error?e.message:"UnknownError");
  process.exitCode=1;
}finally{await sql.end({timeout:5});}
