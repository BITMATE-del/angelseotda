/**
 * doriAdminService — 도리짓고땡 관리자 모니터링 전용 조회 래퍼.
 *
 * 기존 섯다 관리자 서비스는 절대 수정하지 않는다.
 * 관리자에게도 hidden card / deck / card_code / month_value 는 노출하지 않으며,
 * 서버 RPC(dori_admin_*) 응답 자체에 카드 정보가 포함되지 않는다(장수만 제공).
 */
import { supabase } from "@/integrations/supabase/client";

export interface DoriAdminRoomRow {
  roomId: string;
  roomNumber: number;
  title: string;
  roomType: string;
  status: string;
  ante: number;
  isPrivate: boolean;
  carryPot: number;
  seated: number;
  maxPlayers: number;
  createdAt: string;
  closedAt: string | null;
  updatedAt: string | null;
  roundId: string | null;
  roundNumber: number | null;
  phase: string | null;
  roundStatus: string | null;
  settlementStatus: string | null;
  dealerSeat: number | null;
  currentTurnUserId: string | null;
  currentTurnSeat: number | null;
  pot: number;
  raiseCount: number | null;
  lastActionAt: string | null;
  leavePendingCount: number;
  disconnectedCount: number;
  stale: boolean;
}

export interface DoriAdminSeat {
  seat: number;
  userId: string;
  nickname: string | null;
  points: number;
  isReady: boolean;
  leavePending: boolean;
  connectionStatus: string;
  lastSeenAt: string | null;
  missedTurnCount: number | null;
  inRound: boolean;
  folded: boolean;
  isAllIn: boolean;
  acted: boolean;
  roundBet: number;
  contribution: number;
  makeStatus: string | null;
  resultType: string | null;
  cardCount: number;
}

export interface DoriAdminAction {
  id: string;
  roundNumber: number;
  seat: number | null;
  nickname: string | null;
  action: string;
  amount: number;
  bettingRound: number | null;
  at: string;
}

export interface DoriAdminDetail {
  room: {
    roomId: string;
    roomNumber: number;
    title: string;
    roomType: string;
    status: string;
    ante: number;
    minPoints: number;
    isPrivate: boolean;
    carryPot: number;
    maxPlayers: number;
    lastDealerSeat: number | null;
    createdAt: string;
    closedAt: string | null;
    closeReason: string | null;
  };
  round: {
    roundId: string;
    roundNumber: number;
    status: string;
    phase: string;
    settlementStatus: string;
    dealerSeat: number | null;
    pot: number;
    carryPot: number;
    currentBet: number;
    raiseCount: number;
    ante: number;
    currentTurnUserId: string | null;
    turnDeadlineAt: string | null;
    lastActivityAt: string | null;
    winnerId: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  seats: DoriAdminSeat[];
  actions: DoriAdminAction[];
}

export type DoriAdminCloseResult =
  | { ok: true; result: "CLOSED" | "ALREADY_CLOSED"; seated?: number }
  | { ok: false; result: "ROUND_IN_PROGRESS"; openRounds: number }
  | { ok: false; result: "PLAYERS_SEATED"; seated: number };

export async function fetchDoriAdminRooms(includeClosed = false): Promise<DoriAdminRoomRow[]> {
  const { data, error } = await supabase.rpc("dori_admin_list_rooms", {
    _include_closed: includeClosed,
  });
  if (error) throw error;
  return (data ?? []) as unknown as DoriAdminRoomRow[];
}

export async function fetchDoriAdminDetail(roomId: string): Promise<DoriAdminDetail> {
  const { data, error } = await supabase.rpc("dori_admin_room_detail", { _room_id: roomId });
  if (error) throw error;
  return data as unknown as DoriAdminDetail;
}

export async function closeDoriRoomAsAdmin(roomId: string): Promise<DoriAdminCloseResult> {
  const { data, error } = await supabase.rpc("dori_admin_safe_close", { _room_id: roomId });
  if (error) throw error;
  return data as unknown as DoriAdminCloseResult;
}

/** 안전 종료 가능 여부 — 착석자 또는 미정산 라운드가 있으면 제한한다. */
export function doriRoomCloseBlockReason(row: DoriAdminRoomRow): string | null {
  const openRound =
    row.roundId && (row.roundStatus === "PLAYING" || row.settlementStatus === "PENDING");
  if (openRound) return "진행 중/미정산 라운드가 있어 종료할 수 없습니다.";
  if (row.seated > 0) return "착석한 플레이어가 있어 종료할 수 없습니다.";
  if (row.status === "CLOSED") return "이미 종료된 방입니다.";
  return null;
}

/** 비정상(stale) 방 판정 — 진행 중인데 5분 이상 액션이 없거나 전원 미접속. */
export function isDoriRoomStale(row: DoriAdminRoomRow): boolean {
  if (row.stale) return true;
  return row.seated > 0 && row.disconnectedCount >= row.seated;
}

export type DoriAdminAbortResult =
  | { ok: true; result: "ABORTED"; refunded: number; players: number }
  | { ok: true; result: "NO_OPEN_ROUND" }
  | { ok: false; result: "ROUND_ACTIVE"; idleSeconds: number };

/**
 * 참가자가 모두 이탈해 자동 처리가 돌지 않는 중단 판을 정리한다.
 * 기여금은 전액 환급되며(포인트 총량 보존) 라운드는 ABORTED 로 종료된다.
 */
export async function abortDoriStuckRound(roomId: string): Promise<DoriAdminAbortResult> {
  const { data, error } = await supabase.rpc("dori_admin_abort_round", { _room_id: roomId });
  if (error) throw error;
  return data as unknown as DoriAdminAbortResult;
}

/** 중단 판 정리 버튼 노출 조건 — 진행/미정산 라운드가 있고 5분 이상 액션이 없을 때. */
export function canAbortDoriRound(row: DoriAdminRoomRow): boolean {
  const openRound =
    !!row.roundId && (row.roundStatus === "PLAYING" || row.settlementStatus === "PENDING");
  if (!openRound) return false;
  if (row.stale) return true;
  if (!row.lastActionAt) return false;
  return Date.now() - new Date(row.lastActionAt).getTime() > 5 * 60 * 1000;
}
