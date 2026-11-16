/**
 * ANGEL SUTDA Railway staging pre-round preparation only.
 *
 * A prepared round is NOT a live game: no deck, betting, balance mutation,
 * winner calculation, rake, or settlement. The owner snapshots 2+ active
 * waiting-room seats inside a single transaction; repeated start requests
 * return the same round. No browser-provided player list is trusted.
 */
import postgres from "postgres";
import { isRoomUuid } from "./rooms.server";

let pool: ReturnType<typeof postgres> | undefined;
function db() {
  if (process.env['BACKEND_MODE'] !== "railway_postgres_staging" ||
      process.env['RAILWAY_ENVIRONMENT_NAME'] !== "staging" ||
      !process.env['DATABASE_URL'])
    throw new Error("STAGING_ONLY");
  pool ??= postgres(process.env['DATABASE_URL'], {
    max: 5, prepare: false, connect_timeout: 10,
  });
  return pool;
}

export const MIN_PREPARE_PLAYERS = 2;
export const MAX_DORI_PLAYERS = 4;
export function canPrepareRound(count: number, mode: string) {
  return Number.isInteger(count) &&
    count >= MIN_PREPARE_PLAYERS &&
    count <= (mode === "DORI" ? MAX_DORI_PLAYERS : 10);
}

/**
 * Keeps the room in WAITING until the actual audited game engine exists,
 * so no real play can be mistaken for this preparation phase.
 */
export async function prepareStagingRound(accountId: string, roomId: string) {
  if (!isRoomUuid(roomId)) throw new Error("INVALID_ROOM");
  const sql = db();
  return sql.begin(async tx => {
    // Room-row lock serializes with seat join/leave and other start attempts.
    const rows = await tx`
      select id, mode, owner_id, status
      from public.angel_rooms where id=${roomId}::uuid for update
    `;
    const room = rows[0];
    if (!room || room['status'] !== "WAITING") throw new Error("ROOM_UNAVAILABLE");
    if (String(room['owner_id']) !== accountId) throw new Error("OWNER_ONLY");

    const existing = await tx`
      select id, round_number, phase
      from public.angel_rounds
      where room_id=${roomId}::uuid and phase='PREPARING'
        and settlement_status='PENDING'
      order by round_number desc limit 1
    `;
    if (existing[0]) {
      return { roundId:String(existing[0]['id']),
        roundNumber:Number(existing[0]['round_number']), reused:true };
    }

    const seats = await tx`
      select s.seat_number, s.account_id, a.status
      from public.angel_room_seats s
      join public.angel_accounts a on a.id=s.account_id
      where s.room_id=${roomId}::uuid
      order by s.seat_number
    `;
    if (!canPrepareRound(seats.length, String(room['mode'])))
      throw new Error("INVALID_PLAYER_COUNT");
    if (seats.some(s => s['status'] !== "ACTIVE")) throw new Error("INACTIVE_PLAYER");

    const next = await tx`
      select coalesce(max(round_number),0)::integer+1 as n
      from public.angel_rounds where room_id=${roomId}::uuid
    `;
    const roundNumber = Number(next[0]?.['n'] ?? 1);
    const created = await tx`
      insert into public.angel_rounds(room_id,round_number,phase)
      values (${roomId}::uuid,${roundNumber},'PREPARING')
      returning id
    `;
    const roundId = String(created[0]?.['id']);
    for (const seat of seats) {
      await tx`
        insert into public.angel_round_players(round_id,account_id,seat_number)
        values (${roundId}::uuid,${String(seat['account_id'])}::uuid,${Number(seat['seat_number'])})
      `;
    }
    return { roundId, roundNumber, reused:false };
  });
}

/** Read-only staging round state. Never expose private cards or wallet entries. */
export async function getStagingPreparedRound(accountId: string, roomId: string) {
  if (!isRoomUuid(roomId)) throw new Error("INVALID_ROOM");
  const sql = db();
  const rounds = await sql`
    select r.id, r.phase, r.round_number, r.pot,
           (select count(*)::integer from public.angel_round_players p
            where p.round_id=r.id) as players
    from public.angel_rounds r
    join public.angel_room_seats seat
      on seat.room_id=r.room_id and seat.account_id=${accountId}::uuid
    where r.room_id=${roomId}::uuid and r.phase='PREPARING'
      and r.settlement_status='PENDING'
    order by r.round_number desc limit 1
  `;
  const row = rounds[0];
  if (!row) return null;
  return { id:String(row['id']), phase:String(row['phase']),
    roundNumber:Number(row['round_number']),
    playerCount:Number(row['players']), pot:String(row['pot']),
    realGameStarted:false };
}
