/**
 * Staging-only one-time additive session migration.
 * Refuses to touch any unexpected database or pre-baseline schema.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

if (process.env['RAILWAY_ENVIRONMENT_NAME'] !== "staging" ||
    process.env['BACKEND_MODE'] !== "railway_postgres_staging" ||
    !process.env['DATABASE_URL']) {
  console.error("SESSION_MIGRATION_REFUSED_ENV");
  process.exit(1);
}
const db = postgres(process.env['DATABASE_URL'], {
  max: 1, prepare: false, connect_timeout: 10,
});
try {
  const sql = readFileSync(new URL("../db/0002_railway_telegram_sessions.sql", import.meta.url), "utf8");
  await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(5481162026)`;
    const base = await tx`
      select version from public.angel_schema_migrations
      where version='0001_staging_baseline'
    `;
    if (base.length !== 1) throw new Error("BASELINE_MISSING");
    await tx.unsafe(sql);
  });
  const result = await db`
    select version from public.angel_schema_migrations
    where version='0002_telegram_sessions'
  `;
  if (result.length !== 1) throw new Error("SESSION_MIGRATION_NOT_RECORDED");
  console.log("ANGEL_AUTH_SESSION_SCHEMA_OK");
} catch (error) {
  console.error("SESSION_MIGRATION_FAILED",
    error instanceof Error ? error.message : "UnknownError");
  process.exitCode = 1;
} finally {
  await db.end({ timeout: 5 });
}
