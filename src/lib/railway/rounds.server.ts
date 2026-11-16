/**
 * ANGEL SUTDA Railway staging pre-round preparation only.
 *
 * A prepared round is NOT a live game: no deck, betting, balance mutation,
 * winner calculation, rake, or settlement. The owner snapshots 2+ active
 * waiting-room seats inside a single transaction; repeated start requests
 * return the same round. No browser-provided player list is trusted.
 */
import postgres from "postgres";
import { randomInt } from "node:crypto";
import { SUTDA_CARDS } from "@/data/sutdaCards";
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
    count <= (mode === "DORI" ? MAX_DORI_PLAYERS : mode === "SUTDA3" ? 6 : mode === "SUTDA2" ? 10 : 0);
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
      where room_id=${roomId}::uuid and phase in ('PREPARING','DEALT_PREVIEW')
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
    where r.room_id=${roomId}::uuid and r.phase in ('PREPARING','DEALT_PREVIEW')
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


/**
 * Pure CSPRNG Fisher-Yates. Never use Math.random for card allocation.
 * This uses the original 20-card manifest; no cards are generated client-side.
 */
export function cryptographicShuffle(ids: readonly string[], roll: (max: number) => number = randomInt): string[] {
  const out = [...ids];
  for (let i=out.length-1;i>0;i--) {
    const j = roll(i+1);
    if (!Number.isInteger(j) || j<0 || j>i) throw new Error("INVALID_RANDOM_INDEX");
    [out[i],out[j]]=[out[j]!,out[i]!];
  }
  return out;
}

export function dealPrivateHands(mode: string, seatNumbers: readonly number[]) {
  if (!canPrepareRound(seatNumbers.length, mode) ||
      new Set(seatNumbers).size !== seatNumbers.length)
    throw new Error("INVALID_PLAYER_COUNT");
  const perPlayer = mode === "DORI" ? 5 : mode === "SUTDA3" ? 3 : 2;
  const deck = cryptographicShuffle(SUTDA_CARDS.map(c => c.id));
  if (seatNumbers.length*perPlayer > deck.length) throw new Error("DECK_CAPACITY_EXCEEDED");
  const hands: Array<{ seat:number; cards:string[] }> = seatNumbers.map(seat => ({seat,cards:[]}));
  let index=0;
  for (let card=0;card<perPlayer;card++) {
    for (const hand of hands) hand.cards.push(deck[index++]!);
  }
  return hands;
}

/**
 * Owner may generate ONE preview deal for a prepared round.
 * Row-level room lock serializes repeated clicks and never changes balances.
 * Cards are written into a dedicated private DB table, never returned here.
 */
export async function dealStagingRound(accountId:string,roomId:string) {
  if (!isRoomUuid(roomId)) throw new Error("INVALID_ROOM");
  const sql=db();
  return sql.begin(async tx => {
    const rooms=await tx`
      select id, owner_id, mode, status from public.angel_rooms
      where id=${roomId}::uuid for update
    `;
    const room=rooms[0];
    if (!room || room['status']!=="WAITING") throw new Error("ROOM_UNAVAILABLE");
    if (String(room['owner_id'])!==accountId) throw new Error("OWNER_ONLY");
    const rounds=await tx`
      select id, round_number, phase from public.angel_rounds
      where room_id=${roomId}::uuid and phase in ('PREPARING','DEALT_PREVIEW')
        and settlement_status='PENDING'
      order by round_number desc limit 1 for update
    `;
    const round=rounds[0];
    if (!round) throw new Error("ROUND_NOT_PREPARED");
    const roundId=String(round['id']);
    if (round['phase']==="DEALT_PREVIEW") return {
      roundId, roundNumber:Number(round['round_number']), reused:true,
      realGameStarted:false,
    };
    const seats=await tx`
      select p.account_id,p.seat_number from public.angel_round_players p
      join public.angel_accounts a on a.id=p.account_id
      where p.round_id=${roundId}::uuid and a.status='ACTIVE'
      order by p.seat_number
    `;
    if (!canPrepareRound(seats.length,String(room['mode'])))
      throw new Error("INVALID_PLAYER_COUNT");
    const allocation=dealPrivateHands(String(room['mode']),seats.map(s=>Number(s['seat_number'])));
    for (let i=0;i<seats.length;i++) {
      const row=seats[i]!,hand=allocation[i]!;
      await tx`
        insert into public.angel_round_private_hands(round_id,account_id,card_ids)
        values (${roundId}::uuid,${String(row['account_id'])}::uuid,${tx.json(hand.cards)})
      `;
    }
    const initialSeat=Number(seats[0]?.['seat_number']);
    await tx`
      insert into public.angel_round_runtime(round_id,turn_seat,accepts_bets)
      values (${roundId}::uuid,${initialSeat},false)
    `;
    await tx`
      update public.angel_rounds set phase='DEALT_PREVIEW'
      where id=${roundId}::uuid and phase='PREPARING'
    `;
    return { roundId, roundNumber:Number(round['round_number']),
      reused:false,realGameStarted:false };
  });
}

/**
 * Read view: reveal ONLY requester's own cards, never an opponent's hand.
 * Return seat numbers and face-down counts to authorized round participants.
 */
export async function getOwnPreviewCards(accountId:string,roomId:string) {
  if (!isRoomUuid(roomId)) throw new Error("INVALID_ROOM");
  const sql=db();
  const rows=await sql`
    select r.id,r.phase,rt.turn_seat,p.seat_number,
      h.card_ids as own_cards,
      (select count(*)::integer from public.angel_round_players other
       where other.round_id=r.id) as players
    from public.angel_rounds r
    join public.angel_round_players p on p.round_id=r.id
      and p.account_id=${accountId}::uuid
    join public.angel_round_runtime rt on rt.round_id=r.id
    join public.angel_round_private_hands h on h.round_id=r.id
      and h.account_id=${accountId}::uuid
    where r.room_id=${roomId}::uuid and r.phase='DEALT_PREVIEW'
      and r.settlement_status='PENDING'
    order by r.round_number desc limit 1
  `;
  const row=rows[0];
  if (!row) return null;
  const cards=row['own_cards'];
  if (!Array.isArray(cards) || !cards.every(c=>typeof c==="string"))
    throw new Error("PRIVATE_HAND_CORRUPT");
  return {roundId:String(row['id']),phase:"DEALT_PREVIEW" as const,
    mySeat:Number(row['seat_number']),turnSeat:Number(row['turn_seat']),
    myCards:cards as string[],
    playerCount:Number(row['players']),acceptsBets:false,
    realGameStarted:false};
}
