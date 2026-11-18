import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const MINI_APP_URL = "https://angel-sd.com/telegram";

function deriveSecret(key: string) {
  return createHash("sha256").update(`telegram-webhook:${key}`).digest("base64url");
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lovableKey = process.env["LOVABLE_API_KEY"];
        const tgKey = process.env["TELEGRAM_API_KEY"];
        if (!lovableKey || !tgKey) return new Response("not configured", { status: 500 });
        const got = Buffer.from(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "");
        const exp = Buffer.from(deriveSecret(tgKey));
        if (got.length !== exp.length || !timingSafeEqual(got, exp))
          return new Response("Unauthorized", { status: 401 });

        const update = (await request.json().catch(() => null)) as {
          message?: { chat?: { id?: number; type?: string }; text?: string };
        } | null;
        const msg = update?.message;
        if (msg?.chat?.id && msg.chat.type === "private" && msg.text?.startsWith("/start")) {
          const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableKey}`,
              "X-Connection-Api-Key": tgKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              text: "🎴 ANGEL SUTDA\n텔레그램에서 바로 엔젤섯다를 즐겨보세요.",
              reply_markup: {
                inline_keyboard: [[{ text: "🎴 엔젤섯다 입장", web_app: { url: MINI_APP_URL } }]],
              },
            }),
          });
          if (!res.ok) console.error(`Telegram sendMessage failed [${res.status}]: ${await res.text()}`);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
