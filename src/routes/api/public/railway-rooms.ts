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
  if (["INVALID_ROOM_INPUT", "INVALID_ROOM", "INVALID_REQUEST_ID", "INVALID_FINAL_CHOICE", "INVALID_FINAL_MODE", "INVALID_DORI_MAKE", "INVALID_PREVIEW_ACTION"].includes(reason))
    return json({ error: reason }, 400);
  if (["ROOM_FULL", "ROOM_UNAVAILABLE", "NOT_IN_ROOM", "ROUND_ALREADY_PREPARED", "INVALID_PLAYER_COUNT", "ROUND_NOT_PREPARED", "INACTIVE_PLAYER", "ROUND_NOT_DEALT", "NOT_IN_ROUND", "NOT_YOUR_TURN", "INVALID_PREVIEW_TURN_STATE", "REQUEST_ID_CONFLICT", "FINAL_CHOICE_LOCKED", "FINAL_CHOICE_NOT_REQUIRED", "PREVIEW_ROUND_FINISHED"].includes(reason))
    return json({ error: reason }, 409);
  if (reason === "OWNER_ONLY") return json({ error: "OWNER_ONLY" }, 403);
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
          const { getStagingRooms, getStagingRoomDetail, isRoomUuid } =
            await import("@/lib/railway/rooms.server");
          const url = new URL(request.url);
          const roomId = url.searchParams.get("roomId");
          if (roomId !== null) {
            if (!isRoomUuid(roomId)) return json({ error: "INVALID_ROOM" }, 400);
            const { getStagingPreparedRound, getOwnPreviewCards } =
              await import("@/lib/railway/rounds.server");
            const privatePreview = await getOwnPreviewCards(account.id, roomId);
            let betPreview = null;
            if (privatePreview) {
              const { getBettingDryRun } = await import("@/lib/railway/bettingPreview.server");
              betPreview = await getBettingDryRun(account.id, roomId);
            }
            const { readOwnFinalChoice } = await import("@/lib/railway/finalChoices.server");
            const finalChoice = privatePreview
              ? await readOwnFinalChoice(account.id, roomId) : null;
            const {getPreviewTurnStatus}=await import("@/lib/railway/previewTurns.server");
            const turnStatus=privatePreview
              ? await getPreviewTurnStatus(account.id,roomId) : null;
            const { readPreviewOutcome } = await import("@/lib/railway/outcomePreview.server");
            const outcome = privatePreview
              ? await readPreviewOutcome(account.id, roomId) : null;
            return json({ room: await getStagingRoomDetail(account.id, roomId),
              preparedRound: await getStagingPreparedRound(account.id, roomId),
              privatePreview, betPreview, finalChoice, outcome, turnStatus });
          }
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
          const { createStagingRoom, joinStagingRoom, leaveStagingRoom, validMode } =
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
          if (body['action'] === "prepare") {
            if (typeof body['roomId'] !== "string")
              return json({ error: "INVALID_ROOM" }, 400);
            const { prepareStagingRound } = await import("@/lib/railway/rounds.server");
            return json({ ok: true, ...(await prepareStagingRound(account.id, body['roomId'])) });
          }
          if (body['action'] === "dealPreview") {
            if (typeof body['roomId'] !== "string")
              return json({ error: "INVALID_ROOM" }, 400);
            const { dealStagingRound } = await import("@/lib/railway/rounds.server");
            return json({ ok: true, ...(await dealStagingRound(account.id, body['roomId'])) });
          }
          if (body['action'] === "previewPass" ||
              body['action'] === "previewCheck" ||
              body['action'] === "previewFold") {
            if (typeof body['roomId'] !== "string" ||
                typeof body['requestId'] !== "string")
              return json({ error: "INVALID_ACTION" }, 400);
            const { actPreviewTurn } = await import("@/lib/railway/previewTurns.server");
            const previewAction=body['action']==="previewFold"?"FOLD":"CHECK";
            return json({ok:true,
              ...(await actPreviewTurn(account.id,body['roomId'],
                body['requestId'],previewAction))});
          }
          if (body['action'] === "chooseFinal") {
            if (typeof body['roomId'] !== "string" ||
                !Array.isArray(body['chosen']) ||
                !body['chosen'].every(x => typeof x === "string") ||
                body['chosen'].length > 3)
              return json({ error: "INVALID_FINAL_CHOICE" }, 400);
            const { chooseFinalHand } = await import("@/lib/railway/finalChoices.server");
            return json({ok:true,
              ...(await chooseFinalHand(account.id,body['roomId'],body['chosen']))});
          }
          if (body['action'] === "leave") {
            if (typeof body['roomId'] !== "string")
              return json({ error: "INVALID_ROOM" }, 400);
            return json({ ok: true, ...(await leaveStagingRoom(account.id, body['roomId'])) });
          }
          return json({ error: "INVALID_ACTION" }, 400);
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});
