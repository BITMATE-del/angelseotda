/** Register the staging bot only after validating identity. Never touches production bots. */
import { createHash } from "node:crypto";

if (process.env.RAILWAY_ENVIRONMENT_NAME !== "staging" || process.env.BACKEND_MODE !== "railway_postgres_staging") {
  console.error("TELEGRAM_STAGING_REGISTRATION_REFUSED");
  process.exit(1);
}
const token = process.env.ANGEL_TELEGRAM_BOT_TOKEN;
if (!token) {
  console.log("TELEGRAM_STAGING_BOT_NOT_CONFIGURED");
  process.exit(0);
}
if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
  console.error("TELEGRAM_BOT_TOKEN_INVALID_FORMAT");
  process.exit(1);
}
const api = "https://api.telegram.org/bot" + token;
async function call(path, body) {
  const r = await fetch(api + "/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (!r.ok || !j?.ok) throw new Error("Telegram " + path + " failed: " + r.status);
  return j.result;
}
try {
  const bot = await call("getMe");
  if (bot.username?.toLowerCase() !== "angelseotda_bot" || String(bot.id) !== token.split(":")[0]) {
    throw new Error("TELEGRAM_WRONG_BOT_IDENTITY");
  }
  const secret = createHash("sha256").update("angel-sutda-webhook-v1:" + token).digest("hex");
  await call("setWebhook", {
    url: "https://angelseotda-preview-staging.up.railway.app/api/public/railway-bot-webhook",
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  console.log("TELEGRAM_STAGING_WEBHOOK_CONFIGURED_FOR_" + bot.username);
} catch (e) {
  console.error(e instanceof Error ? e.message : "TELEGRAM_WEBHOOK_SETUP_FAILED");
  process.exitCode = 1;
}
