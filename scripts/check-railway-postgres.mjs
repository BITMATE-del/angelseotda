/**
 * Read-only Railway PostgreSQL connectivity check.
 * This intentionally does not create tables, migrate data, or touch balances.
 * Run only in staging until application replacement of Supabase is complete.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DB_CHECK_MISSING_DATABASE_URL");
  process.exit(1);
}

const db = postgres(url, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
});

try {
  const rows = await db`select 1::integer as ok, current_database() as db_name`;
  if (rows[0]?.ok !== 1) throw new Error("Unexpected SELECT result");

  const tables = await db`
    select count(*)::integer as total
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `;
  console.log("DB_CHECK_OK");
  console.log("PUBLIC_TABLE_COUNT=" + tables[0]?.total);
} catch (error) {
  console.error("DB_CHECK_FAILED", error instanceof Error ? error.name : "UnknownError");
  process.exitCode = 1;
} finally {
  await db.end({ timeout: 5 });
}
