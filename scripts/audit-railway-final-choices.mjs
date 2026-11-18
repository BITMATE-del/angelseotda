/**
 * Integration audit of authenticated final-hand persistence using fake accounts.
 * Entire transaction is explicitly rolled back. No permanent fixture.
 */
import {randomInt} from "node:crypto";
import postgres from "postgres";
import {applyFinalChoice} from "../src/lib/railway/finalChoices.server.ts";
if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
   process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
   !process.env['DATABASE_URL'])process.exit(1);
const sql=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
const rollback="EXPECTED_FINAL_CHOICES_ROLLBACK";
const telegramId=String(randomInt(3000000000,9000000000));
const assert=(v,why)=>{if(!v)throw new Error("FINAL_CHOICE_AUDIT_FAILED:"+why);};
async function rejects(fn,msg){
  try{await fn();}catch(e){if(e instanceof Error && e.message===msg)return;throw e;}
  throw new Error("FINAL_CHOICE_AUDIT_FAILED:expected "+msg);
}
try{
  try {
    await sql.begin(async tx=>{
      const people=await tx`
        insert into public.angel_accounts(telegram_id,nickname)
        values(${telegramId}::bigint,'FINAL_AUDIT')
        returning id
      `;
      const userId=String(people[0]?.['id']);
      const rooms=await tx`
        insert into public.angel_rooms(mode,room_name,base_bet,owner_id)
        values('SUTDA3','FINAL_AUDIT_ROOM',100,${userId}::uuid)
        returning id
      `;
      const roomId=String(rooms[0]?.['id']);
      const rounds=await tx`
        insert into public.angel_rounds(room_id,round_number,phase)
        values(${roomId}::uuid,1,'DEALT_PREVIEW') returning id
      `;
      const roundId=String(rounds[0]?.['id']);
      await tx`
        insert into public.angel_round_private_hands(round_id,account_id,card_ids)
        values(${roundId}::uuid,${userId}::uuid,
          ${tx.json(["01-gwang","03-gwang","05-a"])})
      `;
      const chosen=["01-gwang","03-gwang"];
      const first=await applyFinalChoice(tx,userId,roomId,chosen);
      assert(first.reused===false && first.handName==="13광땡","first selection");
      const second=await applyFinalChoice(tx,userId,roomId,[...chosen].reverse());
      assert(second.reused===true,"immutable replay");
      await rejects(()=>applyFinalChoice(tx,userId,roomId,["01-gwang","05-a"]),"FINAL_CHOICE_LOCKED");
      await rejects(()=>applyFinalChoice(tx,userId,roomId,["02-a","03-gwang"]),"INVALID_FINAL_CHOICE");
      const selected=await tx`
        select selected_card_ids from public.angel_round_final_selections
        where round_id=${roundId}::uuid and account_id=${userId}::uuid
      `;
      assert(selected.length===1 &&
        selected[0]?.['selected_card_ids']?.length===2,"only one immutable choice");
      console.log("FINAL_CHOICE_DB_AUDIT_PASS");
      throw new Error(rollback);
    });
    throw new Error("ROLLBACK_NOT_TRIGGERED");
  } catch(e){if(!(e instanceof Error) || e.message!==rollback)throw e;}
  const remains=await sql`
    select count(*)::integer as n from public.angel_accounts
    where telegram_id=${telegramId}::bigint
  `;
  assert(Number(remains[0]?.['n'])===0,"rollback left synthetic account");
  console.log("FINAL_CHOICE_ROLLBACK_VERIFIED");
}catch(e){
  console.error("FINAL_CHOICE_AUDIT_FAILED",e instanceof Error?e.message:"UnknownError");
  process.exitCode=1;
}finally{await sql.end({timeout:5});}
