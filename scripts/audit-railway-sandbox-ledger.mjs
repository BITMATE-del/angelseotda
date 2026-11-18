/**
 * Staging integration audit: creates two fake players, exercises one debit,
 * duplicate request and rejection cases, then deliberately ROLLS BACK all data.
 * No balance grant or game transaction is ever committed by this script.
 */
import { randomInt, randomUUID } from "node:crypto";
import postgres from "postgres";
import { applySandboxDebit } from "../src/lib/railway/sandboxLedger.server.ts";
if (process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
    process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
    !process.env['DATABASE_URL']) {
  console.error("SANDBOX_LEDGER_AUDIT_REFUSED");
  process.exit(1);
}
const sql=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
const marker="AUDIT_EXPECTED_ROLLBACK";
const tg1=String(randomInt(300_000_000,900_000_000));
const tg2=String(randomInt(300_000_000,900_000_000));
function assert(ok,reason){if(!ok)throw new Error("SANDBOX_AUDIT_FAILED:"+reason);}
async function rejects(fn,expected){
  try{await fn();}catch(e){
    if(e instanceof Error && e.message===expected)return;
    throw e;
  }
  throw new Error("SANDBOX_AUDIT_FAILED:expected "+expected);
}
try{
  try{
    await sql.begin(async tx=>{
      const a=await tx`
        insert into public.angel_accounts(telegram_id,nickname)
        values(${tg1}::bigint,'SANDBOX_A'),(${tg2}::bigint,'SANDBOX_B')
        returning id
      `;
      const owner=String(a[0]?.['id']),guest=String(a[1]?.['id']);
      assert(Boolean(owner&&guest),"account fixture");
      await tx`
        insert into public.angel_wallets(account_id,balance,locked_balance)
        values(${owner}::uuid,100,20),(${guest}::uuid,0,0)
      `;
      const room=await tx`
        insert into public.angel_rooms(mode,room_name,base_bet,owner_id)
        values('SUTDA2','SANDBOX ROLLBACK ONLY',10,${owner}::uuid)
        returning id
      `;
      const roomId=String(room[0]?.['id']);
      await tx`
        insert into public.angel_room_seats(room_id,seat_number,account_id)
        values(${roomId}::uuid,1,${owner}::uuid),
              (${roomId}::uuid,2,${guest}::uuid)
      `;
      const round=await tx`
        insert into public.angel_rounds(room_id,round_number,phase)
        values(${roomId}::uuid,1,'DEALT_PREVIEW') returning id
      `;
      const roundId=String(round[0]?.['id']);
      await tx`
        insert into public.angel_round_players(round_id,account_id,seat_number)
        values(${roundId}::uuid,${owner}::uuid,1),
              (${roundId}::uuid,${guest}::uuid,2)
      `;
      await tx`
        insert into public.angel_round_runtime(round_id,turn_seat,accepts_bets)
        values(${roundId}::uuid,1,false)
      `;
      const requestId="audit_"+randomUUID().replaceAll("-","");
      const input={roomId,roundId,actorId:owner,requestId,amount:"30.000"};
      const first=await applySandboxDebit(tx,input);
      assert(!first.reused && Number(first.walletAfter)===70 && Number(first.potAfter)===30,"first debit");
      const replay=await applySandboxDebit(tx,input);
      assert(replay.reused && Number(replay.walletAfter)===70,"duplicate idempotency");
      await rejects(()=>applySandboxDebit(tx,{...input,actorId:guest}),"REQUEST_ID_CONFLICT");
      await rejects(()=>applySandboxDebit(tx,{
        ...input,requestId:"audit_"+randomUUID().replaceAll("-","")
      }),"SANDBOX_ALREADY_DEBITED");
      const receipt=await tx`
        select count(*)::integer as n from public.angel_bet_receipts
        where round_id=${roundId}::uuid
      `;
      const actions=await tx`
        select count(*)::integer as n from public.angel_game_actions
        where round_id=${roundId}::uuid and action_type='SANDBOX_DEBIT'
      `;
      const ledger=await tx`
        select sum(e.amount)::numeric as total
        from public.angel_ledger_entries e
        join public.angel_ledger_events v on v.id=e.event_id
        where v.round_id=${roundId}::uuid and v.event_type='SANDBOX_BET'
      `;
      assert(Number(receipt[0]?.['n'])===1,"one receipt");
      assert(Number(actions[0]?.['n'])===1,"one action");
      assert(Number(ledger[0]?.['total'])===-30,"ledger debit matches pot");
      console.log("SANDBOX_ATOMIC_DEBIT_AUDIT_PASS");
      // Important: ensure this entire fixture is reverted, even on success.
      throw new Error(marker);
    });
    throw new Error("SANDBOX_AUDIT_FAILED:rollback not triggered");
  } catch(error){
    if(!(error instanceof Error) || error.message!==marker) throw error;
  }
  const remains=await sql`
    select count(*)::integer as n from public.angel_accounts
    where telegram_id in (${tg1}::bigint,${tg2}::bigint)
  `;
  assert(Number(remains[0]?.['n'])===0,"fixture rollback");
  console.log("SANDBOX_ROLLBACK_VERIFIED");
} catch(error){
  console.error("SANDBOX_AUDIT_FAILED",error instanceof Error?error.message:"UnknownError");
  process.exitCode=1;
} finally {await sql.end({timeout:5});}
