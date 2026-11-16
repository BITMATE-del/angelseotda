/**
 * PostgreSQL-backed lobby operations, separate from the legacy Supabase game engine.
 * Only account-authenticated, zero-bet WAITING rooms are supported in this stage.
 * NEVER deals cards, starts betting, or moves balances.
 */
import postgres from "postgres";

let pool: ReturnType<typeof postgres> | undefined;
function db() {
  if (process.env['BACKEND_MODE'] !== "railway_postgres_staging" ||
      process.env['RAILWAY_ENVIRONMENT_NAME'] !== "staging" ||
      !process.env['DATABASE_URL'])
    throw new Error("STAGING_ONLY");
  pool ??= postgres(process.env['DATABASE_URL'], { max: 5, prepare: false, connect_timeout: 10 });
  return pool;
}

export type RoomMode = "SUTDA2" | "SUTDA3" | "DORI";
export const ROOM_MODES: readonly RoomMode[] = ["SUTDA2", "SUTDA3", "DORI"];
export function validMode(input: unknown): input is RoomMode {
  return typeof input === "string" && ROOM_MODES.includes(input as RoomMode);
}
const MAX_SEATS = 10;

export async function getStagingRooms(accountId: string) {
  const sql = db();
  const rows = await sql`
    select r.id, r.mode, r.room_name, r.base_bet, r.status,
           r.owner_id, r.created_at, count(s.account_id)::integer as seats,
           bool_or(s.account_id = ${accountId}::uuid) as joined
    from public.angel_rooms r
    left join public.angel_room_seats s on s.room_id = r.id
    where r.status = 'WAITING'
    group by r.id
    order by r.created_at desc
    limit 60
  `;
  return rows.map(r => ({
    id: String(r['id']), mode: String(r['mode']),
    title: String(r['room_name']), baseBet: String(r['base_bet']),
    seats: Number(r['seats']), joined: Boolean(r['joined']),
    ownerId: String(r['owner_id']), status: String(r['status']),
  }));
}

export async function createStagingRoom(accountId: string, mode: RoomMode, title: string, baseBet: string) {
  const normalized = title.trim();
  // Preview only; values stored for display, never charged.
  if (!validMode(mode) || normalized.length < 1 || normalized.length > 80 ||
      !/^(?:[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(baseBet)) {
    throw new Error("INVALID_ROOM_INPUT");
  }
  const sql = db();
  return sql.begin(async tx => {
    const owner = await tx`
      select id from public.angel_accounts where id = ${accountId}::uuid
        and status='ACTIVE' for update
    `;
    if (!owner.length) throw new Error("NOT_AUTHORIZED");
    const created = await tx`
      insert into public.angel_rooms(mode,room_name,base_bet,owner_id)
      values (${mode},${normalized},${baseBet}::numeric,${accountId}::uuid)
      returning id
    `;
    const roomId = String(created[0]?.['id']);
    await tx`
      insert into public.angel_room_seats(room_id,seat_number,account_id)
      values(${roomId}::uuid,1,${accountId}::uuid)
    `;
    return { roomId, seatNumber: 1 };
  });
}

export async function joinStagingRoom(accountId: string, roomId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId)) throw new Error("INVALID_ROOM");
  const sql = db();
  return sql.begin(async tx => {
    // Serializes seat assignment for one room.
    const room = await tx`
      select id, status, mode from public.angel_rooms
      where id = ${roomId}::uuid for update
    `;
    if (!room.length || room[0]?.['status'] !== "WAITING")
      throw new Error("ROOM_UNAVAILABLE");
    const existing = await tx`
      select seat_number from public.angel_room_seats
      where room_id=${roomId}::uuid and account_id=${accountId}::uuid
    `;
    if (existing.length) return { roomId, seatNumber: Number(existing[0]?.['seat_number']) };
    const preparing = await tx`
      select id from public.angel_rounds
      where room_id=${roomId}::uuid and phase='PREPARING'
        and settlement_status='PENDING' limit 1
    `;
    if (preparing.length) throw new Error("ROUND_ALREADY_PREPARED");
    const occupied = await tx`
      select seat_number from public.angel_room_seats
      where room_id=${roomId}::uuid order by seat_number
    `;
    const filled = new Set(occupied.map(r => Number(r['seat_number'])));
    let seatNumber = 0;
    const maxSeats = room[0]?.['mode'] === "DORI" ? 4 : MAX_SEATS;
    for (let i = 1; i <= maxSeats; i++) if (!filled.has(i)) { seatNumber=i; break; }
    if (!seatNumber) throw new Error("ROOM_FULL");
    await tx`
      insert into public.angel_room_seats(room_id,seat_number,account_id)
      values(${roomId}::uuid,${seatNumber},${accountId}::uuid)
    `;
    return { roomId, seatNumber };
  });
}


export function isRoomUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Detailed seating: never selects card identities or any private game state.
 * Only exposes waiting-room nicknames to authenticated users.
 */
export async function getStagingRoomDetail(accountId: string, roomId: string) {
  if (!isRoomUuid(roomId)) throw new Error("INVALID_ROOM");
  const sql = db();
  const roomRows = await sql`
    select id, mode, room_name, base_bet, status, owner_id
    from public.angel_rooms
    where id=${roomId}::uuid and status='WAITING'
    limit 1
  `;
  const room = roomRows[0];
  if (!room) throw new Error("ROOM_UNAVAILABLE");
  const players = await sql`
    select s.seat_number, a.nickname,
      (s.account_id=${accountId}::uuid) as is_me,
      (s.account_id=${room['owner_id']}::uuid) as is_owner
    from public.angel_room_seats s
    join public.angel_accounts a on a.id=s.account_id
    where s.room_id=${roomId}::uuid
    order by s.seat_number
  `;
  return {
    id: String(room['id']),
    mode: String(room['mode']),
    title: String(room['room_name']),
    baseBet: String(room['base_bet']),
    status: String(room['status']),
    ownerId: String(room['owner_id']),
    seats: players.map(p => ({
      number: Number(p['seat_number']),
      nickname: String(p['nickname']),
      isMe: Boolean(p['is_me']),
      isOwner: Boolean(p['is_owner']),
    })),
  };
}

/**
 * Leave a WAITING room without changing wallets. Room row lock prevents
 * concurrent seat assignment during departure.
 * An empty waiting room becomes CLOSED (history is not deleted).
 * Leaving the owner seat while others remain transfers ownership to
 * the lowest occupied seat to avoid orphaned waiting rooms.
 */
export async function leaveStagingRoom(accountId: string, roomId: string) {
  if (!isRoomUuid(roomId)) throw new Error("INVALID_ROOM");
  const sql = db();
  return sql.begin(async tx => {
    const roomRows = await tx`
      select id, status, owner_id
      from public.angel_rooms where id=${roomId}::uuid for update
    `;
    const room = roomRows[0];
    if (!room || room['status'] !== "WAITING")
      throw new Error("ROOM_UNAVAILABLE");
    const preparing = await tx`
      select id from public.angel_rounds
      where room_id=${roomId}::uuid and phase='PREPARING'
        and settlement_status='PENDING' limit 1
    `;
    if (preparing.length) throw new Error("ROUND_ALREADY_PREPARED");
    const removed = await tx`
      delete from public.angel_room_seats
      where room_id=${roomId}::uuid and account_id=${accountId}::uuid
      returning seat_number
    `;
    if (removed.length !== 1) throw new Error("NOT_IN_ROOM");
    const remaining = await tx`
      select account_id from public.angel_room_seats
      where room_id=${roomId}::uuid order by seat_number asc limit 1
    `;
    if (!remaining.length) {
      await tx`
        update public.angel_rooms set status='CLOSED'
        where id=${roomId}::uuid
      `;
      return { roomId, left: true, closed: true };
    }
    if (String(room['owner_id']) === accountId) {
      await tx`
        update public.angel_rooms set owner_id=${String(remaining[0]?.['account_id'])}::uuid
        where id=${roomId}::uuid
      `;
    }
    return { roomId, left: true, closed: false };
  });
}
