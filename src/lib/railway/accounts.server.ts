/**
 * Railway-only server data access. Never import from browser/client code.
 * This module is inert until explicitly called by a verified server handler.
 */
import postgres from "postgres";
import { verifyTelegramInitData } from "@/lib/telegram/verify.server";

let pool: ReturnType<typeof postgres> | undefined;

function database() {
  if (process.env['BACKEND_MODE'] !== "railway_postgres_staging" ||
      process.env['RAILWAY_ENVIRONMENT_NAME'] !== "staging") {
    throw new Error("RAILWAY_STAGING_ONLY");
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  pool ??= postgres(url, { max: 5, connect_timeout: 10, prepare: false });
  return pool;
}

export interface RailwayAngelAccount {
  id: string;
  telegramId: string;
  nickname: string;
  balance: string;
  status: string;
}

/**
 * Provision only from signed Telegram Mini App initData.
 * New accounts start at 0P. No money operations are made here.
 *
 * NOTE: No session cookie/token is issued; the production auth gateway
 * must be implemented and separately audited before enabling the client.
 */
export async function findOrCreateRailwayTelegramAccount(
  initData: string
): Promise<RailwayAngelAccount> {
  const tg = await verifyTelegramInitData(initData);
  if (!Number.isSafeInteger(tg.id) || tg.id <= 0) throw new Error("TG_INVALID");
  const nickname = (tg.username || tg.first_name || `회원${tg.id}`).trim().slice(0, 40);
  if (!nickname) throw new Error("INVALID_NICKNAME");
  const db = database();

  return db.begin(async (tx) => {
    const accounts = await tx`
      insert into public.angel_accounts (telegram_id, nickname)
      values (${tg.id}, ${nickname})
      on conflict (telegram_id) do update
        set updated_at = now()
      returning id, telegram_id, nickname, status
    `;
    const account = accounts[0];
    if (!account || account['status'] !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");
    await tx`
      insert into public.angel_wallets (account_id, balance)
      values (${account['id']}, 0)
      on conflict (account_id) do nothing
    `;
    const wallets = await tx`
      select balance from public.angel_wallets where account_id = ${account['id']}
    `;
    return {
      id: String(account['id']),
      telegramId: String(account['telegram_id']),
      nickname: String(account['nickname']),
      balance: String(wallets[0]?.['balance'] ?? "0"),
      status: String(account['status']),
    };
  });
}
