/** Guarded additive Railway staging-only preview action order migration. */
import {readFileSync} from "node:fs";
import postgres from "postgres";
if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
  process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
  !process.env['DATABASE_URL'])process.exit(1);
const db=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
try{
  await db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(5481162026)`;
    const versions=await tx`select count(*)::integer as n
      from public.angel_schema_migrations where version in
      ('0001_staging_baseline','0002_telegram_sessions',
      '0003_private_preview_deals','0004_sandbox_bet_receipts',
      '0005_final_hand_selections')`;
    if(Number(versions[0]?.['n'])!==5)throw new Error("PREVIOUS_MIGRATIONS_MISSING");
    const foreign=await tx`select count(*)::integer as n
      from information_schema.tables where table_schema='public'
      and table_type='BASE TABLE' and table_name not like 'angel_%'`;
    if(Number(foreign[0]?.['n'])!==0)throw new Error("UNRELATED_TABLES_FOUND");
    await tx.unsafe(readFileSync(new URL("../db/0006_railway_preview_turn_sequence.sql",import.meta.url),"utf8"));
  });
  console.log("ANGEL_PREVIEW_TURN_SEQUENCE_SCHEMA_OK");
}catch(e){
  console.error("ANGEL_PREVIEW_TURN_SCHEMA_FAILED",e instanceof Error?e.message:"UnknownError");
  process.exitCode=1;
}finally{await db.end({timeout:5});}
