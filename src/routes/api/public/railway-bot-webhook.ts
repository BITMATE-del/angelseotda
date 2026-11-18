import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

const WEBAPP_URL = "https://angelseotda-preview-staging.up.railway.app/telegram";
const EXPECTED_BOT = "angelseotda_bot";

function enabled() {
  return process.env["BACKEND_MODE"] === "railway_postgres_staging"
    && process.env["RAILWAY_ENVIRONMENT_NAME"] === "staging";
}
function secretFromToken(token: string) {
  return createHash("sha256").update("angel-sutda-webhook-v1:" + token).digest("hex");
}
function authorized(received: string | null, expected: string) {
  if (!received || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
function response(status = 200) {
  return new Response(status === 200 ? "OK" : "Not found", { status, headers: { "cache-control": "no-store" } });
}

/** Staging-only Telegram update receiver; never accepts unsigned updates. */
export const Route = createFileRoute("/api/public/railway-bot-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!enabled()) return response(404);
        const token = process.env["ANGEL_TELEGRAM_BOT_TOKEN"];
        if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) return response(404);
        if (!authorized(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), secretFromToken(token))) return response(403);
        if (Number(request.headers.get("content-length") ?? "0") > 16384) return response(413);
        const update = await request.json().catch(() => null) as {
          message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } };
        } | null;
        const msg = update?.message;
        if (!msg || typeof msg.text !== "string" || !/^\/start(?:\s|$)/.test(msg.text)) return response();
        if (!msg.chat || msg.chat.type !== "private" || !Number.isSafeInteger(msg.chat.id)) return response();
        const answer = {
          chat_id: msg.chat.id,
          text: "엔젤섯다에 오신 것을 환영합니다. 아래 버튼을 눌러 입장해 주세요.",
          reply_markup: {
            inline_keyboard: [[{ text: "엔젤섯다 입장하기", web_app: { url: WEBAPP_URL } }]],
          },
        };
        try {
          const result = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(answer),
            signal: AbortSignal.timeout(8000),
          });
          if (!result.ok) {
            console.error("TELEGRAM_START_DELIVERY_FAILED", result.status);
            return response(503);
          }
        } catch {
          console.error("TELEGRAM_START_DELIVERY_UNAVAILABLE");
          return response(503);
        }
        return response();
      },
    },
  },
});
