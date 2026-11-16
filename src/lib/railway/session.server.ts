import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { findOrCreateRailwayTelegramAccount } from "./accounts.server";

const SESSION_SECONDS = 12 * 60 * 60;
export const ANGEL_SESSION_COOKIE = "__Host-angel_session";

let pool: ReturnType<typeof postgres> | undefined;
function db() {
  if (process.env['BACKEND_MODE'] !== "railway_postgres_staging" ||
      process.env['RAILWAY_ENVIRONMENT_NAME'] !== "staging" ||
      !process.env['DATABASE_URL']) {
    throw new Error("SESSION_STAGING_ONLY");
  }
  pool ??= postgres(process.env['DATABASE_URL'], { max: 5, prepare: false, connect_timeout: 10 });
  return pool;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function cookieHeader(token: string) {
  return `${ANGEL_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function clearCookieHeader() {
  return `${ANGEL_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function tokenFromCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const value = part.trim();
    if (!value.startsWith(`${ANGEL_SESSION_COOKIE}=`)) continue;
    const token = value.slice(ANGEL_SESSION_COOKIE.length + 1);
    if (/^[a-f0-9]{64}$/.test(token)) return token;
  }
  return null;
}

export function isSameOriginPost(request: Request) {
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type") ?? "";
  if (!origin || !contentType.toLowerCase().startsWith("application/json")) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

/** Issue one server-stored opaque session only after Telegram-signed initData is verified. */
export async function createRailwaySession(initData: string) {
  const account = await findOrCreateRailwayTelegramAccount(initData);
  const token = randomBytes(32).toString("hex");
  const sql = db();
  await sql`
    insert into public.angel_auth_sessions(account_id,token_sha256,expires_at)
    values (${account.id},${hashToken(token)},now()+interval '12 hours')
  `;
  return { account, token };
}

/** DB check on each session-dependent request; cookies alone do not grant rights. */
export async function getRailwaySession(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const sql = db();
  const rows = await sql`
    select a.id, a.telegram_id, a.nickname, a.status, w.balance
    from public.angel_auth_sessions s
    join public.angel_accounts a on a.id=s.account_id
    join public.angel_wallets w on w.account_id=a.id
    where s.token_sha256=${hashToken(token)}
      and s.revoked_at is null
      and s.expires_at > now() and a.status='ACTIVE'
    limit 1
  `;
  const a = rows[0];
  if (!a) return null;
  return { id:String(a['id']), telegramId:String(a['telegram_id']),
    nickname:String(a['nickname']), status:String(a['status']),
    balance:String(a['balance']) };
}

export async function revokeRailwaySession(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  const sql = db();
  await sql`
    update public.angel_auth_sessions set revoked_at=now()
    where token_sha256=${hashToken(token)} and revoked_at is null
  `;
}
