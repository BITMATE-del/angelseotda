/**
 * Staging Postgres integration audit of CHECK/FOLD turn state.
 * Synthetic room/accounts/actions live ONLY inside an explicitly rolled back
 * transaction. No wallet, stake, payout, ledger or real game are touched.
 */
import {randomInt,randomUUID} from "node:crypto";
import postgres from "postgres";
import {applyPreviewTurn} from "../src/lib/railway/previewTurns.server.ts";
if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
   process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
   !process.env['DATABASE_URL']){
  console.error("PREVIEW_TURN_AUDIT_REFUSED");
  process.exit(1);
}
const sql=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
const rollback="PREVIEW_AUDIT_ROLLBACK_EXPECTED";
const seed=randomInt(3000000000,8000000000);
const ids=[seed,seed+1,seed+2];
const request=()=> "turn_"+randomUUID().replaceAll("-","");
function assert(test,why){if(!test)throw new Error("PREVIEW_TURN_AUDIT_FAILED:"+why);}
async function rejects(fn,reason){
  try{await fn();}catch(error){
    if(error instanceof Error && error.message===reason)return;
    throw error;
  }
  throw new Error("PREVIEW_TURN_AUDIT_FAILED:expected "+reason);
}
try{
  try{
    await sql.begin(async tx=>{
      const accounts=await tx`
        insert into public.angel_accounts(telegram_id,nickname)
        values
        (${ids[0]}::bigint,'TURN_AUDIT_A'),
        (${ids[1]}::bigint,'TURN_AUDIT_B'),
        (${ids[2]}::bigint,'TURN_AUDIT_C')
        returning id
      `;
      assert(accounts.length===3,"accounts");
      const a=String(accounts[0]?.['id']);
      const b=String(accounts[1]?.['id']);
      const c=String(accounts[2]?.['id']);
      const rooms=await tx`
        insert into public.angel_rooms(mode,room_name,base_bet,owner_id)
        values('SUTDA2','TURN_AUDIT_ROLLBACK_ONLY',100,${a}::uuid)
        returning id
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
        insert into public.angel_round_runtime(round_id,turn_seat,accepts_bets)
        values(${roundId}::uuid,1,false)
      `;
      const checkId=request();
      const first=await applyPreviewTurn(tx,a,roomId,checkId,"CHECK");
      assert(first.turnSeat===2 && first.complete===false,"first check advances");
      const replay=await applyPreviewTurn(tx,a,roomId,checkId,"CHECK");
      assert(replay.reused===true,"same request replay");
      await rejects(()=>applyPreviewTurn(tx,c,roomId,request(),"CHECK"),"NOT_YOUR_TURN");
      await rejects(()=>applyPreviewTurn(tx,a,roomId,checkId,"FOLD"),"REQUEST_ID_CONFLICT");
      const fold=await applyPreviewTurn(tx,b,roomId,request(),"FOLD");
      assert(fold.turnSeat===3 && fold.foldedSeats?.includes(2),"fold skips seat");
      const last=await applyPreviewTurn(tx,c,roomId,request(),"CHECK");
      assert(last.complete===true && last.turnSeat===null,"round completes");
      assert(last.activeSeats?.join(",")==="1,3","fold exclusion");
      await rejects(()=>applyPreviewTurn(tx,a,roomId,request(),"CHECK"),"PREVIEW_ROUND_FINISHED");
      const counts=await tx`
        select
          (select count(*)::integer from public.angel_game_actions
            where round_id=${roundId}::uuid and action_type in
              ('PREVIEW_CHECK','PREVIEW_FOLD')) as actions,
          (select count(*)::integer from public.angel_ledger_events
            where round_id=${roundId}::uuid) as ledger_events,
          (select pot from public.angel_rounds
            where id=${roundId}::uuid) as pot,
          (select count(*)::integer from public.angel_bet_receipts
            where round_id=${roundId}::uuid) as receipts
      `;
      assert(Number(counts[0]?.['actions'])===3,"exactly three actions");
      assert(Number(counts[0]?.['ledger_events'])===0,"no ledger movement");
      assert(Number(counts[0]?.['pot'])===0,"no pot movement");
      assert(Number(counts[0]?.['receipts'])===0,"no debit receipt");
      console.log("PREVIEW_TURN_DB_AUDIT_PASS");
      throw new Error(rollback);
    });
    throw new Error("PREVIEW_TURN_AUDIT_ROLLBACK_MISSING");
  }catch(error){
    if(!(error instanceof Error)||error.message!==rollback)throw error;
  }
  const left=await sql`
    select count(*)::integer as n from public.angel_accounts
    where telegram_id in
      (${ids[0]}::bigint,${ids[1]}::bigint,${ids[2]}::bigint)
  `;
  assert(Number(left[0]?.['n'])===0,"rollback deleted synthetic players");
  console.log("PREVIEW_TURN_ROLLBACK_VERIFIED");
}catch(error){
  console.error("PREVIEW_TURN_AUDIT_FAILED",
    error instanceof Error?error.message:"UnknownError");
  process.exitCode=1;
}finally{await sql.end({timeout:5});}
