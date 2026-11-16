import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * TRON 입금 감시기 스케줄 엔드포인트.
 * - POST만 허용한다. (브라우저 주소창 접속으로는 실행 불가)
 * - 인증: `x-cron-secret` 헤더 또는 플랫폼 스케줄러의 `Authorization: Bearer <cron secret>`.
 * - 비밀값은 응답/로그에 남기지 않는다.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function authorize(request: Request): Promise<boolean> {
  const secret = process.env["LOVABLE_CRON_SECRET"] ?? "";
  if (!secret) return false;
  const provided = request.headers.get("x-cron-secret");
  if (provided && provided === secret) return true;
  // 플랫폼 스케줄러(Bearer) 경로
  const denied = await authenticateCronRequest(request);
  return denied === null;
}

export const Route = createFileRoute("/api/public/crypto-watcher")({
  server: {
    handlers: {
      GET: () => json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405),
      POST: async ({ request }) => {
        if (!(await authorize(request))) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
        const { runCryptoWatcherGuarded } = await import("@/lib/crypto/watcher.server");
        const result = await runCryptoWatcherGuarded();
        return json(result);
      },
    },
  },
});
