import { createFileRoute } from "@tanstack/react-router";

const noCache = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noCache });
}
function enabled() {
  return process.env['BACKEND_MODE'] === "railway_postgres_staging" &&
    process.env['RAILWAY_ENVIRONMENT_NAME'] === "staging" &&
    process.env['ANGEL_AUTH_PREVIEW_ENABLED'] === "true";
}
async function caller(request: Request) {
  const { getRailwaySession, tokenFromCookie } = await import("@/lib/railway/session.server");
  const token = tokenFromCookie(request.headers.get("cookie"));
  if (!token) return null;
  return getRailwaySession(token);
}
function failure(error: unknown) {
  const reason = error instanceof Error ? error.message : "";
  if (["INVALID_ROOM_INPUT", "INVALID_ROOM"].includes(reason))
    return json({ error: reason }, 400);
  if (reason === "ROOM_FULL" || reason === "ROOM_UNAVAILABLE")
    return json({ error: reason }, 409);
  if (reason === "NOT_AUTHORIZED") return json({ error: "UNAUTHORIZED" }, 401);
  console.error("RAILWAY_LOBBY_FAILED", reason);
  return json({ error: "LOBBY_UNAVAILABLE" }, 503);
}

/**
 * Preview lobby API; no Supabase and no points/settlement operations.
 * The same session cookie must be present for reads and writes.
 */
export const Route = createFileRoute("/api/public/railway-rooms")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!enabled()) return json({ error: "NOT_FOUND" }, 404);
        try {
          const account = await caller(request);
          if (!account) return json({ error: "UNAUTHORIZED" }, 401);
          const { getStagingRooms } = await import("@/lib/railway/rooms.server");
          return json({ rooms: await getStagingRooms(account.id) });
        } catch (error) {
          return failure(error);
        }
      },
      POST: async ({ request }) => {
        if (!enabled()) return json({ error: "NOT_FOUND" }, 404);
        const { isSameOriginPost } = await import("@/lib/railway/session.server");
        if (!isSameOriginPost(request)) return json({ error: "INVALID_ORIGIN" }, 403);
        if (Number(request.headers.get("content-length") ?? "0") > 2048)
          return json({ error: "TOO_LARGE" }, 413);
        try {
          const account = await caller(request);
          if (!account) return json({ error: "UNAUTHORIZED" }, 401);
          const body = await request.json().catch(() => null) as Record<string, unknown> | null;
          if (!body || typeof body['action'] !== "string")
            return json({ error: "INVALID_ACTION" }, 400);
          const { createStagingRoom, joinStagingRoom, validMode } =
            await import("@/lib/railway/rooms.server");
          if (body['action'] === "create") {
            if (!validMode(body['mode']) ||
                typeof body['title'] !== "string" ||
                typeof body['baseBet'] !== "string")
              return json({ error: "INVALID_ROOM_INPUT" }, 400);
            return json({
              ok: true,
              ...(await createStagingRoom(account.id, body['mode'], body['title'], body['baseBet'])),
            });
          }
          if (body['action'] === "join") {
            if (typeof body['roomId'] !== "string")
              return json({ error: "INVALID_ROOM" }, 400);
            return json({ ok: true,
              ...(await joinStagingRoom(account.id, body['roomId'])) });
          }
          return json({ error: "INVALID_ACTION" }, 400);
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
