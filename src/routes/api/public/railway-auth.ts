import { createFileRoute } from "@tanstack/react-router";

/**
 * Isolated Railway login API. Legacy Supabase-powered UI remains unchanged.
 * No public traffic should be routed here until the entire game API is migrated.
 */
function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(headers ?? {})
  } });
}
function previewEnabled() {
  return process.env['BACKEND_MODE'] === "railway_postgres_staging"
    && process.env['RAILWAY_ENVIRONMENT_NAME'] === "staging"
    && process.env['ANGEL_AUTH_PREVIEW_ENABLED'] === "true";
}
function hidden() {
  return json({ error: "NOT_FOUND" }, 404);
}
export const Route = createFileRoute("/api/public/railway-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!previewEnabled()) return hidden();
        const { isSameOriginPost, createRailwaySession, cookieHeader } =
          await import("@/lib/railway/session.server");
        if (!isSameOriginPost(request)) return json({ error: "INVALID_ORIGIN" }, 403);
        if (Number(request.headers.get("content-length") ?? "0") > 6000)
          return json({ error: "TOO_LARGE" }, 413);
        const body = await request.json().catch(() => null) as { initData?: unknown } | null;
        if (typeof body?.initData !== "string" ||
            body.initData.length < 1 || body.initData.length > 4096)
          return json({ error: "INVALID_AUTH_PAYLOAD" }, 400);
        try {
          const session = await createRailwaySession(body.initData);
          return json({ ok: true, account: session.account }, 200,
            { "Set-Cookie": cookieHeader(session.token) });
        } catch {
          // No verifier details or account data in error response.
          return json({ error: "AUTH_FAILED" }, 401);
        }
      },
      GET: async ({ request }) => {
        if (!previewEnabled()) return hidden();
        const { tokenFromCookie, getRailwaySession } =
          await import("@/lib/railway/session.server");
        const token = tokenFromCookie(request.headers.get("cookie"));
        if (!token) return json({ authenticated: false }, 401);
        try {
          const account = await getRailwaySession(token);
          return account
            ? json({ authenticated: true, account })
            : json({ authenticated: false }, 401);
        } catch {
          return json({ error: "SESSION_UNAVAILABLE" }, 503);
        }
      },
      DELETE: async ({ request }) => {
        if (!previewEnabled()) return hidden();
        const { tokenFromCookie, revokeRailwaySession, clearCookieHeader, isSameOriginPost } =
          await import("@/lib/railway/session.server");
        // Revoke is state-changing; origin required, no JSON body needed.
        const origin = request.headers.get("origin");
        if (!origin || origin !== new URL(request.url).origin) return json({ error: "INVALID_ORIGIN" }, 403);
        const token = tokenFromCookie(request.headers.get("cookie"));
        if (token) await revokeRailwaySession(token);
        return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
      }
    }
  }
});
