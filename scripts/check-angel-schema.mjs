/**
 * Read-only validation for the ANGEL SUTDA isolated PostgreSQL baseline.
 * Safe to run on every staging deployment.
 */
import postgres from "postgres";
if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging"
 || process.env.BACKEND_MODE !== "railway_postgres_staging"
 || !process.env.DATABASE_URL) {
  console.error("BASELINE_CHECK_REFUSED");
  process.exit(1);
}
const db = postgres(process.env.DATABASE_URL, {max: 1, connect_timeout: 10, prepare: false});
try {
  const tables = await db`
    select count(*)::integer as total
    from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE'
      and table_name like 'angel_%'
  `;
  const settings = await db`
    select key, value from public.angel_app_settings
    where key in ('deposit_fee_rate','withdrawal_fee_rate','pot_rake_rate',
                  'payments_enabled','settlement_enabled')
  `;
  const map = Object.fromEntries(settings.map(s => [s.key,s.value]));
  if (tables[0]?.total !== 11
    || Number(map.deposit_fee_rate) !== 0
    || Number(map.withdrawal_fee_rate) !== 0
    || Number(map.pot_rake_rate) !== 0.03
    || map.payments_enabled !== false
    || map.settlement_enabled !== false) {
    throw new Error("BASELINE_INVARIANT_FAILED");
  }
  console.log("ANGEL_BASELINE_OK");
  console.log("ANGEL_TABLE_COUNT=11");
  console.log("PAYMENTS_AND_SETTLEMENT_DISABLED");
} catch(e) {
  console.error("ANGEL_BASELINE_FAILED", e instanceof Error ? e.message : "UnknownError");
  process.exitCode=1;
} finally {
  await db.end({ timeout: 5 });
}
