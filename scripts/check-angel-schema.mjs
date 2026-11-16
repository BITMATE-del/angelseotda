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
  if (tables[0]?.total !== 15
    || Number(map.deposit_fee_rate) !== 0
    || Number(map.withdrawal_fee_rate) !== 0
    || Number(map.pot_rake_rate) !== 0.03
    || map.payments_enabled !== false
    || map.settlement_enabled !== false) {
    throw new Error("BASELINE_INVARIANT_FAILED");
  }
  const session = await db`
    select version from public.angel_schema_migrations
    where version='0002_telegram_sessions'
  `;
  if (session.length !== 1) throw new Error("SESSION_SCHEMA_NOT_APPLIED");
  const privateSchema = await db`
    select version from public.angel_schema_migrations
    where version='0003_private_preview_deals'
  `;
  if (privateSchema.length !== 1) throw new Error("PRIVATE_DEALS_SCHEMA_NOT_APPLIED");
  const privateTables = await db`
    select count(*)::integer as n from information_schema.tables
    where table_schema='public' and table_name in
      ('angel_round_private_hands','angel_round_runtime')
  `;
  if (privateTables[0]?.['n'] !== 2) throw new Error("PRIVATE_TABLES_MISSING");
  const receiptSchema = await db`
    select version from public.angel_schema_migrations
    where version='0004_sandbox_bet_receipts'
  `;
  const receiptTable = await db`
    select count(*)::integer as n from information_schema.tables
    where table_schema='public' and table_name='angel_bet_receipts'
  `;
  if (receiptSchema.length!==1 || receiptTable[0]?.['n']!==1)
    throw new Error("SANDBOX_RECEIPT_SCHEMA_MISSING");
  console.log("ANGEL_BASELINE_OK");
  console.log("ANGEL_TABLE_COUNT=15");
  console.log("PAYMENTS_AND_SETTLEMENT_DISABLED");
} catch(e) {
  console.error("ANGEL_BASELINE_FAILED", e instanceof Error ? e.message : "UnknownError");
  process.exitCode=1;
} finally {
  await db.end({ timeout: 5 });
}
