/** One-time staging-only migration for server-private preview card hands. */
import { readFileSync } from "node:fs";
import postgres from "postgres";
if (process.env['BACKEND_MODE'] !== "railway_postgres_staging" ||
    process.env['RAILWAY_ENVIRONMENT_NAME'] !== "staging" ||
    !process.env['DATABASE_URL']) {
  console.error("PRIVATE_DEALS_MIGRATION_REFUSED_ENV");
  process.exit(1);
}
const db = postgres(process.env['DATABASE_URL'], { max: 1, prepare: false, connect_timeout: 10 });
try {
  const body = readFileSync(new URL("../db/0003_railway_private_preview_deals.sql", import.meta.url), "utf8");
  await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(5481162026)`;
    const rows = await tx`
      select version from public.angel_schema_migrations
      where version in ('0001_staging_baseline','0002_telegram_sessions')
    `;
    if (rows.length !== 2) throw new Error("PREVIOUS_SCHEMA_MISSING");
    const unrelated = await tx`
      select count(*)::integer as n from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
        and table_name not like 'angel_%'
    `;
    if (Number(unrelated[0]?.['n']) !== 0) throw new Error("UNRELATED_TABLES_FOUND");
    await tx.unsafe(body);
  });
  console.log("ANGEL_PRIVATE_DEALS_SCHEMA_OK");
} catch (error) {
  console.error("ANGEL_PRIVATE_DEALS_SCHEMA_FAILED", error instanceof Error ? error.message : "UnknownError");
  process.exitCode=1;
} finally {
  await db.end({ timeout:5 });
}
