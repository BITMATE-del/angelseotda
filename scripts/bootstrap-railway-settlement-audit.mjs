/**
 * Staging-only additive receipt migration. Never run on production.
 * It does not expose any transfer, withdrawal or settlement endpoint.
 */
import {readFileSync} from "node:fs";
import postgres from "postgres";
if(process.env['BACKEND_MODE']!=="railway_postgres_staging" ||
   process.env['RAILWAY_ENVIRONMENT_NAME']!=="staging" ||
   !process.env['DATABASE_URL']){
  console.error("SETTLEMENT_AUDIT_MIGRATION_REFUSED");process.exit(1);
}
const db=postgres(process.env['DATABASE_URL'],{max:1,connect_timeout:10,prepare:false});
try{
  await db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(5481162026)`;
    const prev=await tx`
      select count(*)::integer as n from public.angel_schema_migrations
      where version in ('0001_staging_baseline','0002_telegram_sessions',
      '0003_private_preview_deals','0004_sandbox_bet_receipts',
      '0005_final_hand_selections','0006_preview_turn_sequence',
      '0007_wager_simulation')
    `;
    if(Number(prev[0]?.['n'])!==7)throw new Error("PREVIOUS_MIGRATIONS_MISSING");
    const other=await tx`
      select count(*)::integer as n from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
        and table_name not like 'angel_%'
    `;
    if(Number(other[0]?.['n'])!==0)throw new Error("UNRELATED_TABLES_FOUND");
    const source=readFileSync(new URL("../db/0008_railway_settlement_rollback_audit.sql",import.meta.url),"utf8");
    await tx.unsafe(source);
  });
  console.log("SETTLEMENT_ROLLBACK_AUDIT_SCHEMA_OK");
}catch(error){
  console.error("SETTLEMENT_AUDIT_MIGRATION_FAILED",
    error instanceof Error?error.message:"UnknownError");
  process.exitCode=1;
}finally{await db.end({timeout:5});}
