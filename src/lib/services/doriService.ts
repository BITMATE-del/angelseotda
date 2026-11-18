/**
 * doriService — 도리짓고땡(DORI_JITGO_DDAENG) 전용 서버 RPC 래퍼.
 *
 * 기존 섯다 서비스(serverGameService / gameService)는 절대 수정하지 않는다.
 * 셔플·배분·짓기 검증·족보·정산은 전부 dori_* DB RPC에서만 수행하며,
 * 이 파일은 (1) 행동 전송 (2) 서버 상태 조회만 담당한다.
 */
import { supabase } from "@/integrations/supabase/client";
import { DORI_GRADES, doriGrade, type DoriRoomGrade } from "@/lib/game/dori/doriRooms";
import {
  DORI_BET_ACTIONS,
  resolveDoriBet,
  type DoriBetAction,
} from "@/lib/game/dori/doriRules";

export type DoriPhase =
  | "DEALING"
  | "BETTING_1"
  | "BETTING_2"
  | "MAKE_SELECTION"
  | "BETTING_FINAL"
  | "SHOWDOWN"
  | "FINISHED";

/** 베팅이 가능한 단계 (3장 · 4장 · 최종) */
export const DORI_BETTING_PHASES: DoriPhase[] = ["BETTING_1", "BETTING_2", "BETTING_FINAL"];

export function isDoriBettingPhase(phase: DoriPhase | null | undefined): boolean {
  return !!phase && DORI_BETTING_PHASES.includes(phase);
}

/** 단계별로 지급이 끝난 카드 장수 (서버 dori_visible_cards 와 동일) */
export function doriVisibleCardCount(phase: DoriPhase | null | undefined): number {
  if (!phase || phase === "DEALING") return 0;
  if (phase === "BETTING_1") return 3;
  if (phase === "BETTING_2") return 4;
  return 5;
}

export interface DoriRoomSummary {
  id: string;
  room_number: number;
  title: string;
  room_type: string;
  ante: number;
  min_points: number;
  status: string;
  is_private: boolean;
  seated: number;
  max_players: number;
  phase: DoriPhase | null;
}

export interface DoriSeatState {
  seat: number;
  userId: string;
  nickname: string;
  rank: string | null;
  level: number;
  avatarUrl: string | null;
  /** 장착 캐릭터 이미지 (없으면 기본 캐릭터로 대체) */
  characterUrl?: string | null;
  /** 장착 칭호 (없으면 "칭호없음") */
  title?: string | null;
  points: number;
  isMe: boolean;
  isReady: boolean;
  leavePending: boolean;
  connection: string;
  /** 미접속 상태에서 요구된 자기 액션을 놓친 횟수 (서버 판정, 0~3) */
  absenceMisses?: number;
  /** 3회 확정 — 현재 판 종료 후 자동 퇴장 */
  longAbsence?: boolean;
  inRound: boolean;
  folded: boolean;
  isAllIn: boolean;
  acted: boolean;
  roundBet: number;
  contribution: number;
  /** 상대는 쇼다운 전까지 PENDING / SUBMITTED 만 내려온다 (MADE·HWANG 은 본인 또는 쇼다운) */
  makeStatus: "PENDING" | "SUBMITTED" | "MADE" | "HWANG" | null;
  resultType: "WIN" | "LOSE" | "FOLD" | "REMATCH" | null;
  cardCount: number;
  handLabel: string | null;
  handRank: number | null;
  makeTotal: number | null;
  selectedCards: string[] | null;
  remainingCards: string[] | null;
  /** 서버가 공개를 허용한 좌석만 true (쇼다운 생존자 / 폴드승 공개 선택) */
  revealed?: boolean;
  /** 공개된 5장 원본 (서버가 허용한 경우에만 내려온다) */
  cards?: string[] | null;
  isHwang?: boolean;
}

export interface DoriRoundInfo {
  roundId: string;
  roundNumber: number;
  status: string;
  phase: DoriPhase;
  dealerSeat: number | null;
  pot: number;
  currentBet: number;
  raiseCount: number;
  ante: number;
  turnUserId: string | null;
  turnDeadline: string | null;
  winnerId: string | null;
  settlementStatus: string;
  /** 재경기 사유 (동점 · 구사 성립 · 멍텅구리구사 성립) — 서버 확정값 */
  rematchReason?: string | null;
  /** SHOWDOWN | REVEAL | HIDDEN — 서버가 결정한 패 공개 정책 */
  revealMode?: "SHOWDOWN" | "REVEAL" | "HIDDEN" | null;
  /** 폴드승 공개 선택 상태 */
  revealChoice?: "PENDING" | "REVEAL" | "HIDE" | null;
  /** 내가 폴드승 승자이고 아직 공개 여부를 고르지 않았을 때만 true */
  canChooseReveal?: boolean;
}

export interface DoriMakeOption {
  selected: string[];
  remaining: string[];
  make_total: number;
  hand: { type: string; value: number; rank: number; label: string; code: string };
}

export interface DoriRoomState {
  room: {
    id: string;
    roomNumber: number;
    title: string;
    roomType?: string | null;
    ante: number;
    minPoints: number;
    status: string;
    maxPlayers: number;
    isPrivate: boolean;
    carryPot: number;
    readyRequired: boolean;
    lastDealerSeat: number | null;
  };
  round: DoriRoundInfo | null;
  seats: DoriSeatState[];
  myCards: string[];
  makeOptions: DoriMakeOption[];
  actions: { id: string; userId: string; type: string; amount: number; bettingRound: number; at: string }[];
  /** 서버가 계산한 액션 버튼 (금액·가능여부의 유일한 근거) */
  actionOptions?: DoriActionOption[] | null;
}

/* ---------------------------- 방 ---------------------------- */

export async function listDoriRooms(): Promise<DoriRoomSummary[]> {
  const { data, error } = await supabase.rpc("dori_list_rooms");
  if (error) throw error;
  return (data ?? []) as DoriRoomSummary[];
}

export interface DoriActiveRoom {
  roomId: string;
  roomNumber: number;
  title: string;
  ante: number;
  seat: number;
  status: string;
  leavePending: boolean;
}

/** 내가 아직 좌석을 가지고 있는 도리 방 (없으면 null) — 로비의 "게임으로 돌아가기"용 */
export async function fetchMyDoriRoom(): Promise<DoriActiveRoom | null> {
  const { data, error } = await supabase.rpc("dori_my_active_room");
  if (error) throw error;
  return (data as unknown as DoriActiveRoom | null) ?? null;
}

/**
 * 도리 방 생성. Ante(기본 베팅)와 최소 입장 포인트는 등급으로만 결정되며
 * 서버(dori_create_room)가 등급 프리셋으로 강제한다. 클라이언트 금액은 신뢰하지 않는다.
 */
export async function createDoriRoom(input: {
  title: string;
  grade: DoriRoomGrade;
  isPrivate?: boolean;
  password?: string | null;
}): Promise<string> {
  const preset = doriGrade(input.grade) ?? DORI_GRADES[1]!;
  const { data, error } = await supabase.rpc("dori_create_room", {
    _title: input.title,
    _room_type: preset.id,
    _ante: preset.ante,
    _min_points: preset.minPoints,
    _is_private: input.isPrivate ?? false,
    ...(input.password ? { _password: input.password } : {}),
  });
  if (error) throw error;
  return data as string;
}

export async function joinDoriSeat(roomId: string, seat: number, password?: string | null) {
  const { data, error } = await supabase.rpc("dori_join_seat", {
    _room_id: roomId,
    _seat: seat,
    ...(password ? { _password: password } : {}),
  });
  if (error) throw error;
  return data as number;
}

export async function setDoriReady(roomId: string, ready: boolean) {
  const { error } = await supabase.rpc("dori_set_ready", { _room_id: roomId, _ready: ready });
  if (error) throw error;
}

export async function leaveDoriRoom(roomId: string) {
  const { data, error } = await supabase.rpc("dori_leave_room", { _room_id: roomId });
  if (error) throw error;
  return data as string;
}

export async function doriHeartbeat(roomId: string) {
  await supabase.rpc("dori_heartbeat", { _room_id: roomId });
}

/** 접속 상태 갱신 + 턴 타임아웃 자동 처리 (도리 전용). 실패해도 화면 진행을 막지 않는다. */
export async function doriTick(roomId: string) {
  const { data, error } = await supabase.rpc("dori_tick", { _room_id: roomId });
  if (error) throw error;
  return data as unknown as { ok: boolean; autoActions: number };
}

export async function startDoriRound(roomId: string) {
  const { data, error } = await supabase.rpc("dori_start_round", { _room_id: roomId });
  if (error) throw error;
  return data as string;
}

export async function fetchDoriRoomState(roomId: string): Promise<DoriRoomState> {
  const { data, error } = await supabase.rpc("dori_room_state", { _room_id: roomId });
  if (error) throw error;
  return data as unknown as DoriRoomState;
}

/**
 * 베팅 전송. 금액은 서버(bet_additional_amount)가 다시 계산하므로 보내지 않는다.
 */
export async function placeDoriBet(roomId: string, action: DoriBetAction) {
  const { error } = await supabase.rpc("dori_place_bet", {
    _room_id: roomId,
    _action: action,
    _amount: 0,
  });
  if (error) throw error;
}

export async function submitDoriMake(roomId: string, selected: string[]) {
  const { error } = await supabase.rpc("dori_submit_make", {
    _room_id: roomId,
    _selected: selected,
  });
  if (error) throw error;
}

/** 폴드승(올다이) 승자의 패 공개 여부 선택 — 승자 본인만 1회 */
export async function chooseDoriReveal(roundId: string, reveal: boolean) {
  const { error } = await supabase.rpc("dori_reveal_choice", {
    _round_id: roundId,
    _reveal: reveal,
  });
  if (error) throw error;
}

/* --------------------- 액션 버튼 (서버 금액 기준) --------------------- */

export interface DoriActionOption {
  action: DoriBetAction;
  /** 이 버튼을 누르면 실제로 추가 차감되는 금액 (= POT 증가량) */
  amount: number;
  enabled: boolean;
  reason?: string | undefined;
}

const ACTION_REASON: Partial<Record<DoriBetAction, string>> = {
  check: "이미 베팅이 시작되었습니다.",
  call: "받을 베팅이 없습니다.",
  all_in: "보유 포인트가 없습니다.",
};

/**
 * 액션 버튼 목록. 서버(dori_action_options)가 내려준 값을 그대로 사용하고,
 * 아직 서버 값이 없는 순간에만 동일 공식(doriRules)으로 표시값을 미러링한다.
 * 실제 검증/차감은 항상 서버(dori_place_bet)가 수행한다.
 */
export function doriActionOptions(state: DoriRoomState, myUserId: string): DoriActionOption[] {
  const round = state.round;
  const me = state.seats.find((s) => s.userId === myUserId);
  if (!round || !me || !me.inRound) return [];
  if (!isDoriBettingPhase(round.phase)) return [];

  const fromServer = state.actionOptions;
  if (fromServer && fromServer.length > 0) {
    const byAction = new Map(fromServer.map((o) => [o.action, o] as const));
    return DORI_BET_ACTIONS.map(
      (action) =>
        byAction.get(action) ?? {
          action,
          amount: 0,
          enabled: false,
          reason: ACTION_REASON[action],
        },
    );
  }

  const ctx = {
    pot: round.pot,
    currentBet: round.currentBet,
    myBet: me.roundBet,
    baseBet: round.ante,
    balance: me.points,
  };

  return DORI_BET_ACTIONS.map((action) => {
    const r = resolveDoriBet(action, ctx);
    return {
      action,
      amount: r.additionalAmount ?? 0,
      enabled: r.ok,
      reason: r.ok ? undefined : ACTION_REASON[action],
    };
  });
}

/* --------------------- 도리 전용 채팅 --------------------- */

export interface DoriChatMessage {
  id: string;
  userId: string | null;
  nickname: string | null;
  message: string;
  kind: string;
  createdAt: string;
}

/** 방 채팅 조회 (최근 120건, 오래된 순) */
export async function fetchDoriChat(roomId: string): Promise<DoriChatMessage[]> {
  const { data, error } = await supabase
    .from("dori_chat_messages")
    .select("id, user_id, nickname, message, kind, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      nickname: r.nickname,
      message: r.message,
      kind: r.kind,
      createdAt: r.created_at,
    }))
    .reverse();
}

export async function sendDoriChat(roomId: string, userId: string, nickname: string, message: string) {
  const { error } = await supabase.from("dori_chat_messages").insert({
    room_id: roomId,
    user_id: userId,
    nickname,
    message: message.slice(0, 200),
    kind: "chat",
  });
  if (error) throw error;
}

/* ---------------------- 라운드 결과 (PHASE 4, 읽기 전용) ---------------------- */

export interface DoriResultPlayer {
  userId: string;
  nickname: string;
  seat: number;
  resultType: "WIN" | "LOSE" | "FOLD" | "REMATCH" | null;
  folded: boolean;
  /** 다이/미공개 폴드승은 서버가 null 로 내려준다 (족보 강제 공개 금지) */
  handLabel: string | null;
  /** 서버 확정 족보 코드 (TTAENGJABI / GUSA / MUNG_GUSA / DDAENG_x ...) */
  handCode?: string | null;
  contribution: number;
  payout: number;
  net: number;
  finalPoints: number | null;
  stillSeated: boolean;
  /** 서버가 공개를 허용한 경우에만 true */
  revealed?: boolean;
  cards?: string[] | null;
  selectedCards?: string[] | null;
  remainingCards?: string[] | null;
  makeTotal?: number | null;
  isHwang?: boolean;
}

export interface DoriRoundResult {
  ready: boolean;
  roundId?: string;
  roundNumber?: number;
  settlementStatus?: string;
  pot?: number;
  winnerId?: string | null;
  /** 재경기 사유 (서버 확정 문구) */
  rematchReason?: string | null;
  showdown?: boolean;
  players?: DoriResultPlayer[];
  payouts?: { ordinal: number; userId: string; nickname: string; amount: number }[];
  actions?: { userId: string; type: string; amount: number; bettingRound: number; at: string }[];
  /** SHOWDOWN | REVEAL | HIDDEN */
  revealMode?: "SHOWDOWN" | "REVEAL" | "HIDDEN" | null;
  revealChoice?: "PENDING" | "REVEAL" | "HIDE" | null;
  /** 내가 폴드승 승자이고 아직 공개 여부를 고르지 않았을 때만 true */
  canChooseReveal?: boolean;
}

/** 서버가 확정한 라운드 결과 (지급액·손익·족보). 클라이언트에서 재계산하지 않는다. */
export async function fetchDoriRoundResult(roundId: string): Promise<DoriRoundResult> {
  const { data, error } = await supabase.rpc("dori_round_result", { _round_id: roundId });
  if (error) throw error;
  return (data as unknown as DoriRoundResult) ?? { ready: false };
}

/** 최근 판 게임기록 (서버 공개 정책이 적용된 결과만 내려온다) */
export async function fetchDoriRoundHistory(
  roomId: string,
  limit = 10,
): Promise<DoriRoundResult[]> {
  const { data, error } = await supabase.rpc("dori_round_history", {
    _room_id: roomId,
    _limit: limit,
  });
  if (error) throw error;
  return (data as unknown as DoriRoundResult[]) ?? [];
}
