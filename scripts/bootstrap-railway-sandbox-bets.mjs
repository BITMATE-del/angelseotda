/** Guarded one-time additive schema migration; staging only. */
import { readFileSync } from "node:fs";
import postgres from "postgres";
if (process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
    process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
    !process.env['DATABASE_URL']) {
  console.error("SANDBOX_BET_MIGRATION_REFUSED");
  process.exit(1);
}
const db=postgres(process.env['DATABASE_URL'],{max:1,prepare:false,connect_timeout:10});
try {
  await db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(5481162026)`;
    const previous=await tx`
      select version from public.angel_schema_migrations
      where version in
      ('0001_staging_baseline','0002_telegram_sessions','0003_private_preview_deals')
    `;
    if(previous.length!==3) throw new Error("PREVIOUS_MIGRATIONS_MISSING");
    const unrelated=await tx`
      select count(*)::integer as n from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
        and table_name not like 'angel_%'
    `;
    if(Number(unrelated[0]?.['n'])!==0) throw new Error("UNRELATED_TABLES_FOUND");
    const body=readFileSync(new URL("../db/0004_railway_sandbox_bet_receipts.sql",import.meta.url),"utf8");
    await tx.unsafe(body);
  });
  const rows=await db`
    select version from public.angel_schema_migrations
    where version='0004_sandbox_bet_receipts'
  `;
  if(rows.length!==1) throw new Error("SANDBOX_BET_SCHEMA_MISSING");
  console.log("SANDBOX_BET_RECEIPTS_SCHEMA_OK");
} catch(error){
  console.error("SANDBOX_BET_SCHEMA_FAILED",error instanceof Error?error.message:"UnknownError");
  process.exitCode=1;
} finally { await db.end({timeout:5}); }
