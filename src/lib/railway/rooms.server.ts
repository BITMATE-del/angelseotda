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
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(roomId)) throw new Error("INVALID_ROOM");
  const sql = db();
  return sql.begin(async tx => {
    // Serializes seat assignment for one room.
    const room = await tx`
      select id, status from public.angel_rooms
      where id = ${roomId}::uuid for update
    `;
    if (!room.length || room[0]?.['status'] !== "WAITING")
      throw new Error("ROOM_UNAVAILABLE");
    const existing = await tx`
      select seat_number from public.angel_room_seats
      where room_id=${roomId}::uuid and account_id=${accountId}::uuid
    `;
    if (existing.length) return { roomId, seatNumber: Number(existing[0]?.['seat_number']) };
    const occupied = await tx`
      select seat_number from public.angel_room_seats
      where room_id=${roomId}::uuid order by seat_number
    `;
    const filled = new Set(occupied.map(r => Number(r['seat_number'])));
    let seatNumber = 0;
    for (let i = 1; i <= MAX_SEATS; i++) if (!filled.has(i)) { seatNumber=i; break; }
    if (!seatNumber) throw new Error("ROOM_FULL");
    await tx`
      insert into public.angel_room_seats(room_id,seat_number,account_id)
      values(${roomId}::uuid,${seatNumber},${accountId}::uuid)
    `;
    return { roomId, seatNumber };
  });
}
