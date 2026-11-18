/**
 * Apply the isolated ANGEL SUTDA staging baseline.
 * Only for the dedicated Railway staging database.
 * This script never copies Lovable/Supabase data or creates users/balances.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging"
  || process.env.BACKEND_MODE !== "railway_postgres_staging") {
  console.error("SCHEMA_SETUP_REFUSED: requires staging and railway_postgres_staging");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("SCHEMA_SETUP_REFUSED: DATABASE_URL missing");
  process.exit(1);
}

const sql = readFileSync(new URL("../db/0001_railway_staging_baseline.sql", import.meta.url), "utf8");
const db = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  prepare: false,
});
try {
  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(5481162026)`;
    const other = await tx`
      select count(*)::integer as count
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name not like 'angel_%'
    `;
    if (other[0]?.count !== 0) {
      throw new Error("SCHEMA_SETUP_REFUSED: unrelated public tables exist");
    }
    const migrated = await tx`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public'
          and table_name = 'angel_schema_migrations'
      ) as exists
    `;
    if (migrated[0]?.exists) {
      const rows = await tx`
        select 1 as ok from public.angel_schema_migrations
        where version = '0001_staging_baseline' limit 1
      `;
      if (rows.length) {
        console.log("SCHEMA_ALREADY_INSTALLED");
        return;
      }
      throw new Error("SCHEMA_SETUP_REFUSED: unexpected existing angel schema");
    }
    await tx.unsafe(sql);
    console.log("SCHEMA_BASELINE_INSTALLED");
  });
  const rows = await db`
    select count(*)::integer as total
    from information_schema.tables
    where table_schema = 'public' and table_name like 'angel_%'
      and table_type = 'BASE TABLE'
  `;
  console.log("ANGEL_TABLE_COUNT=" + rows[0]?.total);
} catch (err) {
  console.error("SCHEMA_SETUP_FAILED", err instanceof Error ? err.message : "UnknownError");
  process.exitCode = 1;
} finally {
  await db.end({ timeout: 5 });
}
