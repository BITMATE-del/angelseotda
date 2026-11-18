/**
 * Telegram Mini App initData 서버 검증 (Telegram 공식 Ed25519 third-party 검증 방식).
 * 봇 토큰 없이 bot_id + Telegram 공개키로 서명을 검증한다. 클라이언트 값은 신뢰하지 않는다.
 * https://core.telegram.org/bots/webapps#validating-data-for-third-party-use
 */
export const TELEGRAM_BOT_ID = 8939445776;
const TELEGRAM_PUBLIC_KEY_HEX = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
const MAX_AGE_SECONDS = 60 * 60; // 1시간 지난 initData 재사용 차단

export interface VerifiedTelegramUser {
  id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  auth_date: number;
}

function getEffectiveTelegramBotId(): number {
  if (process.env["RAILWAY_ENVIRONMENT_NAME"] !== "staging"
    || process.env["BACKEND_MODE"] !== "railway_postgres_staging") return TELEGRAM_BOT_ID;
  const botToken = process.env["ANGEL_TELEGRAM_BOT_TOKEN"];
  if (!botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) throw new Error("TG_BOT_NOT_CONFIGURED");
  const botId = Number(botToken.split(":")[0]);
  if (!Number.isSafeInteger(botId) || botId <= 0) throw new Error("TG_BOT_NOT_CONFIGURED");
  return botId;
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64UrlToBytes(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function verifyTelegramInitData(initData: string): Promise<VerifiedTelegramUser> {
  if (!initData || initData.length > 4096) throw new Error("TG_INVALID");
  const params = new URLSearchParams(initData);
  const signature = params.get("signature");
  if (!signature) throw new Error("TG_INVALID");

  const pairs: string[] = [];
  params.forEach((v, k) => {
    if (k !== "hash" && k !== "signature") pairs.push(`${k}=${v}`);
  });
  pairs.sort();
  const checkString = `${getEffectiveTelegramBotId()}:WebAppData\n${pairs.join("\n")}`;

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(TELEGRAM_PUBLIC_KEY_HEX),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    base64UrlToBytes(signature),
    new TextEncoder().encode(checkString),
  );
  if (!ok) throw new Error("TG_INVALID");

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || now - authDate > MAX_AGE_SECONDS || authDate - now > 300)
    throw new Error("TG_EXPIRED");

  const user = JSON.parse(params.get("user") ?? "null") as Record<string, unknown> | null;
  if (!user || typeof user["id"] !== "number") throw new Error("TG_INVALID");
  const str = (k: string) => (typeof user[k] === "string" ? (user[k] as string) : null);
  return {
    id: user["id"] as number,
    username: str("username"),
    first_name: str("first_name"),
    last_name: str("last_name"),
    language_code: str("language_code"),
    auth_date: authDate,
  };
}
