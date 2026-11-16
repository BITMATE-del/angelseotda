/**
 * serverGameService — 서버 권한(Server-Authoritative) 게임 클라이언트.
 *
 * 카드 셔플·배분·족보 판정·베팅·정산은 전부 DB RPC에서만 수행한다.
 * 클라이언트는 (1) 행동 전송 (2) 서버 상태 조회 역할만 담당하며
 * 어떤 승패/포인트 계산도 하지 않는다.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EnginePlayerState, EngineState } from "@/lib/game/engine";
import type { BetAction, GameMode } from "@/lib/game/types";
import { rematchReasonLabel, type RematchReason } from "@/lib/game/gusaRematch";

export interface EquippedAsset {
  itemId: string;
  name: string;
  assetUrl: string | null;
}

export interface ServerSeat {
  userId: string;
  seat: number;
  nickname: string;
  level: number;
  rank: string | null;
  avatarUrl: string | null;
  points: number;
  initialPoints: number | null;
  finalPoints: number | null;
  folded: boolean;
  status: string;
  connection: string;
  acted: boolean;
  totalBet: number;
  /** 재경기로 이월된 투자액 (사이드팟 자격 계산에 사용) */
  carryBet?: number;
  /** 올인 여부 */
  isAllIn?: boolean;
  resultType: "WIN" | "LOSE" | "DRAW" | "REMATCH" | null;
  isMe: boolean;
  cardCount: number;
  cards: string[];
  handCode: string | null;
  handName: string | null;
  selectedCards: string[] | null;
  character: EquippedAsset | null;
  title: EquippedAsset | null;
  /** 나가기 예약 여부 (현재 판 종료 후 퇴장) */
  leavePending?: boolean;
  /**
   * 3장 섯다 공개패 (상대에게도 보이는 유일한 카드).
   * 서버는 대상자 전원의 선택이 끝난 뒤에만 상대 좌석의 값을 내려준다 (공개 전에는 null).
   */
  openCard?: string | null;
  /** 공개패 선택을 마쳤는지 (identity 없이 상태만) */
  openCardSelected?: boolean;
}

/** 서버가 계산한 MAIN/SIDE POT 레이어 */
export interface SidePot {
  level: number;
  amount: number;
  eligible: string[];
}

export interface ServerAction {
  /** 서버 game_actions.id — 사운드 중복 재생 방지(dedupe) 기준 */
  id?: string;
  actionId?: string;
  userId: string;
  type: string;
  amount: number;
  stage: number;
  at: string;
}

/**
 * 서버가 계산한 행동 + 금액.
 * amount / additionalAmount = "이 버튼을 누르면 내 잔액에서 실제 추가 차감되는 금액"
 * totalTarget = 이 액션 후 내 이번 스테이지 누적 베팅액 (표시용이 아니라 검증용)
 */
export interface ServerActionOption {
  action: BetAction;
  amount: number;
  additionalAmount?: number;
  totalTarget?: number;
  enabled?: boolean;
}

export type ServerPhase =
  | "DEALING"
  | "BETTING"
  | "OPEN_CARD_SELECTION"
  | "FIRST_BETTING"
  | "LAST_CARD_DEALT"
  | "SQUEEZING"
  | "HAND_SELECTION"
  | "FINAL_BETTING"
  | "FINAL_HAND_SUBMIT"
  | "SHOWDOWN"
  | "SETTLING"
  | "ROUND_RESULT"
  | "FINISHED";

export interface ServerRoundState {
  roundId: string;
  roomId: string;
  /** 사용자 표시용 방 고유번호 (#100238) */
  roomNumber: number;
  mode: GameMode;
  status: string;
  phase: ServerPhase;
  stage: number;
  pot: number;
  baseBet: number;
  currentBet: number;
  turnUserId: string | null;
  turnDeadline: string | null;
  winnerId: string | null;
  /** 이 판의 선(先) 좌석번호 — 서버 game_rounds.dealer_seat */
  dealerSeat?: number | null;
  settlementStatus: string;
  roundNumber: number;
  seats: ServerSeat[];
  actions: ServerAction[];
  availableActions: ServerActionOption[];
  cardIntegrityOk: boolean;
  /** 재경기 확정 여부 (무승부 또는 구사) */
  rematch: boolean;
  /** 재경기 사유 */
  rematchReason: RematchReason | null;
  /** 이 라운드 자체가 재경기(강제 2장)인지 */
  isRematchRound: boolean;
  /** 방의 원래 게임 방식 (재경기 종료 후 복귀) */
  roomMode: GameMode;
  /** 서버가 계산한 MAIN/SIDE POT */
  pots: SidePot[];
  /** MAIN+SIDE POT 합계 (서버 계산) */
  potSum?: number;
  /** 합계 == POT 검증 결과 (false면 서버 pot 계산 오류) */
  potSumOk?: boolean;
  /** 이번 판 내 총 투자액 (서버 total_bet) */
  myContribution?: number;
  /** 내가 지금 추가로 맞춰야 하는 금액 (서버 계산) */
  myOwed?: number;
  /** 현재 단계에서 각 생존자가 보유해야 하는 카드 수 */
  expectedCardCount?: number;
  /** 이 판에 이월되어 들어온 POT */
  carryIn: number;
  /** 다음 판으로 이월되는 POT */
  carryPot: number;
  /** 내 카드 수 (서버 기준) */
  myCardCount?: number;
  /** FOLD WIN 공개 선택 상태 */
  foldWinChoice?: "PENDING" | "REVEALED" | "HIDDEN" | null;
  /** FOLD WIN 공개 선택 마감 시각 */
  foldWinDeadline?: string | null;
  /** 내가 FOLD WIN 승자인지 */
  iAmFoldWinner?: boolean;
  /** 서버 현재시각 — 클라이언트 타이머의 시계 보정 기준 */
  serverNow?: string | null;
  /** 3장 섯다 공개패가 공개 상태인지 (대상자 전원 선택 완료) */
  openCardRevealed?: boolean;
  /** 아직 공개패를 선택하지 않은 대상 인원 수 (서버 기준 · identity 없음) */
  openCardPending?: number;
}

/** 게임방 좌석 (라운드 시작 전에도 상대 플레이어가 보이도록) */
export interface RoomSeat {
  userId: string;
  seat: number;
  nickname: string;
  rank: string | null;
  points: number;
  avatarUrl: string | null;
  isSpectator: boolean;
  connection: string;
  seatStatus: string;
  isMe: boolean;
  character: EquippedAsset | null;
  title: EquippedAsset | null;
  leavePending: boolean;
  /** 준비(READY) 상태 — 서버(game_room_players.is_ready) 값 */
  isReady?: boolean;
  /** 연결 끊김 상태에서 놓친 실제 action turn 수 (3회 → 라운드 종료 후 퇴장) */
  missedTurns?: number;
}



export interface RoomTableState {
  roomId: string;
  roomNumber: number;
  title: string;
  status: string;
  mode: GameMode;
  baseBet: number;
  maxPlayers: number;
  carryPot: number;
  /** 첫 판 시작에 전원 READY가 필요한지 (서버 판단) */
  readyRequired?: boolean;
  /** 진행 중인 라운드 존재 여부 */
  activeRound?: boolean;
  seats: RoomSeat[];
}

/** 준비 상태 토글 — 서버가 좌석/진행 상태를 검증한다 */
export async function setRoomReady(
  roomId: string,
  ready: boolean,
): Promise<{ seated: number; ready: number; allReady: boolean }> {
  const { data, error } = await supabase.rpc("set_room_ready", {
    _room_id: roomId,
    _ready: ready,
  });
  if (error) throw error;
  return data as unknown as { seated: number; ready: number; allReady: boolean };
}

/** 방의 모든 착석/관전 플레이어 조회 — 본인 필터링 없음 */
export async function fetchRoomTableState(roomId: string): Promise<RoomTableState | null> {
  const { data, error } = await supabase.rpc("room_table_state", { _room_id: roomId });
  if (error) throw error;
  return (data as unknown as RoomTableState | null) ?? null;
}

/** 라운드 정산 후 잔액 부족(오링) 회원 자동 퇴장 — 판정/제거는 100% 서버가 수행한다 */
export interface MinBalanceExitResult {
  minPoints: number | null;
  removed: { userId: string; points: number; nickname: string | null }[];
  skipped?: string;
}
export async function enforceRoomMinBalance(roomId: string): Promise<MinBalanceExitResult> {
  const { data, error } = await supabase.rpc("enforce_room_min_balance", { _room_id: roomId });
  if (error) throw error;
  const raw = (data ?? {}) as { minPoints?: number | null; removed?: unknown; skipped?: string };
  return {
    minPoints: raw.minPoints ?? null,
    removed: Array.isArray(raw.removed)
      ? (raw.removed as MinBalanceExitResult["removed"])
      : [],
    ...(raw.skipped ? { skipped: raw.skipped } : {}),
  };
}




/** 나가기 요청 — 진행 중이면 예약(LEAVE_PENDING), 아니면 즉시 퇴장(LEFT) */
export async function requestLeaveRoom(roomId: string): Promise<"LEFT" | "LEAVE_PENDING"> {
  const { data, error } = await supabase.rpc("request_leave_room", { _room_id: roomId });
  if (error) throw error;
  return (data as "LEFT" | "LEAVE_PENDING") ?? "LEFT";
}

/** 나가기 예약 취소 */
export async function cancelLeaveRoom(roomId: string) {
  const { error } = await supabase.rpc("cancel_leave_room", { _room_id: roomId });
  if (error) throw error;
}

/** 새 판 시작 — 셔플/배분/기본 베팅 차감은 모두 서버에서 처리된다. */
export async function startServerRound(roomId: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_game_round", { _room_id: roomId });
  if (error) throw error;
  return data as string;
}

/**
 * 진행 정지 감시 — 서버가 phase/카드수/deadline을 재검증하고 안전한 경우에만 다음 단계로 진행한다.
 * 카드 정합성 오류나 ROUND_PAUSED 상태에서는 서버가 강제 진행하지 않는다.
 */
export async function advanceRoundState(roundId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("advance_round_state", { _round_id: roundId });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** 진행 중(또는 최근) 라운드 id */
export async function fetchCurrentRoundId(roomId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("game_rounds")
    .select("id, status, started_at")
    .eq("room_id", roomId)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.id ?? null;
}

/** 서버 상태 조회 — 상대 카드는 서버에서 마스킹되어 내려온다. */
export async function fetchRoundState(roundId: string): Promise<ServerRoundState | null> {
  const { data, error } = await supabase.rpc("get_round_state", { _round_id: roundId });
  if (error) throw error;
  return (data as unknown as ServerRoundState | null) ?? null;
}

/** 내 카드 슬롯 — card_order(서버 배분 순서)를 그대로 유지한다 */
export interface MyCardSlot {
  code: string;
  /** 서버 game_cards.card_order (1부터). 마지막 카드 식별의 유일한 기준 */
  order: number;
}

/**
 * 내 카드만 조회 (마지막 카드는 서버가 허용한 단계 이후에만 내려온다).
 * card_order 순서를 그대로 유지하므로 "마지막에 받은 카드"를 CSS 순서가 아니라 서버 값으로 식별한다.
 */
export async function fetchMyCardSlots(roundId: string): Promise<MyCardSlot[]> {
  const { data, error } = await supabase.rpc("get_my_cards", { _round_id: roundId });
  if (error) throw error;
  return ((data ?? []) as { card_code: string; card_order: number }[])
    .map((r) => ({ code: r.card_code, order: Number(r.card_order ?? 0) }))
    .sort((a, b) => a.order - b.order);
}

/** 내 카드 코드 목록 (배분 순서 유지) */
export async function fetchMyCards(roundId: string): Promise<string[]> {
  return (await fetchMyCardSlots(roundId)).map((c) => c.code);
}

export interface RoundSnapshot {
  server: ServerRoundState;
  slots: MyCardSlot[];
}

/**
 * 라운드 상태 + 내 카드 슬롯을 네트워크 왕복 1회로 조회한다.
 *
 * 서버 래퍼(get_round_snapshot)는 기존 get_round_state / get_my_cards 를 그대로 호출만 하며
 * 마스킹·권한 규칙은 동일하다. 래퍼 호출이 실패하면 기존 2회 조회 경로로 자동 폴백한다.
 */
export async function fetchRoundSnapshot(roundId: string): Promise<RoundSnapshot | null> {
  const { data, error } = await supabase.rpc("get_round_snapshot", { _round_id: roundId });
  if (!error) {
    const raw = data as unknown as {
      state?: ServerRoundState | null;
      myCards?: { card_code: string; card_order: number }[] | null;
    } | null;
    if (!raw?.state) return null;
    const slots = (raw.myCards ?? [])
      .map((r) => ({ code: r.card_code, order: Number(r.card_order ?? 0) }))
      .sort((a, b) => a.order - b.order);
    return { server: raw.state, slots };
  }
  // 폴백: 기존 경로 (서버 래퍼 미배포/권한 오류 시에도 게임 진행이 멈추지 않도록)
  const [server, slots] = await Promise.all([
    fetchRoundState(roundId),
    fetchMyCardSlots(roundId).catch(() => [] as MyCardSlot[]),
  ]);
  if (!server) return null;
  return { server, slots };
}

/** 베팅 행동 전송 — 금액 계산·차례 검증·중복 차단은 서버가 수행한다. */
export async function sendBetAction(
  roundId: string,
  action: BetAction,
  actionId: string = crypto.randomUUID(),
) {
  const { data, error } = await supabase.rpc("place_bet_action", {
    _round_id: roundId,
    _action_id: actionId,
    _action_type: action,
  });
  if (error) throw error;
  return data;
}

/** 3장 섯다 최종 승부패 확정 */
export async function sendFinalHand(roundId: string, cards: [string, string]) {
  const { error } = await supabase.rpc("select_final_hand", {
    _round_id: roundId,
    _card1: cards[0],
    _card2: cards[1],
  });
  if (error) throw error;
}

/** 3장 섯다 공개패 선택 (상대에게 보여줄 1장) */
export async function selectOpenCard(roundId: string, card: string) {
  const { error } = await supabase.rpc("select_open_card", {
    _round_id: roundId,
    _card: card,
  });
  if (error) throw error;
}

/** FOLD WIN 승자의 패 공개 여부 선택 */
export async function setFoldWinReveal(roundId: string, reveal: boolean) {
  const { data, error } = await supabase.rpc("set_fold_win_reveal", {
    _round_id: roundId,
    _reveal: reveal,
  });
  if (error) throw error;
  return data as string;
}

/**
 * 선택 시간이 지난 FOLD WIN 공개 선택을 서버 기준으로 마감한다(항상 비공개).
 * 클라이언트에서 모달만 닫고 서버가 PENDING 으로 남지 않게 하는 것이 목적이다.
 */
export async function resolveFoldWinReveal(roundId: string) {
  const { data, error } = await supabase.rpc("resolve_fold_win_reveal", {
    _round_id: roundId,
  });
  if (error) throw error;
  return ((data ?? {}) as { choice?: string | null }).choice ?? null;
}

/**
 * 라운드 결과 조회 (읽기 전용).
 * 승자·지급액·손익·잔액·공개 패는 서버가 확정한 값이며 클라이언트는 표시만 한다.
 * 다이한 플레이어의 패와 족보는 어떤 경우에도 내려오지 않는다.
 */
export interface SutdaResultPlayer {
  userId: string;
  seat: number;
  nickname: string;
  isMe: boolean;
  folded: boolean;
  resultType: "WIN" | "LOSE" | "DRAW" | "REMATCH" | null;
  net: number;
  finalPoints: number | null;
  totalBet: number;
  payout: number;
  revealed: boolean;
  cards: string[];
  handLabel: string | null;
  stillSeated: boolean;
}

export interface SutdaRoundResult {
  ready: boolean;
  roundId: string;
  roundNumber: number;
  mode: GameMode;
  pot: number;
  settlementStatus: string;
  rematch: boolean;
  rematchReason: RematchReason | null;
  carryPot: number;
  showdown: boolean;
  foldWin: boolean;
  revealMode: "SHOWDOWN" | "REVEALED" | "HIDDEN" | null;
  revealChoice: string | null;
  canChooseReveal: boolean;
  pots: SidePot[];
  payouts: { userId: string; nickname: string; amount: number }[];
  players: SutdaResultPlayer[];
}

export async function fetchSutdaRoundResult(roundId: string): Promise<SutdaRoundResult | null> {
  const { data, error } = await supabase.rpc("sutda_round_result", { _round_id: roundId });
  if (error) throw error;
  const result = (data as unknown as SutdaRoundResult | null) ?? null;
  return result?.ready ? result : null;
}



/** 턴 시간 초과 강제 처리 (서버가 시간을 다시 검증한다) */
export async function enforceTurnTimeout(roundId: string) {
  const { error } = await supabase.rpc("enforce_turn_timeout", { _round_id: roundId });
  if (error && !/찾을 수 없|not found/.test(error.message)) throw error;
}

/**
 * 2장 섯다: 두 번째 패 확인 완료. 모든 생존자가 확인하면 서버가 최종 베팅으로 전환한다.
 *
 * 멱등(idempotent) 처리:
 * 같은 라운드에서 두 번 이상 호출되어도(더블클릭·재시도·realtime 중복) 라운드가 깨지지 않는다.
 * 이미 확인 완료되었거나 서버 phase 가 이동한 경우는 정상 거부(EXPECTED_REJECTION)로 분류하고
 * 오류를 던지지 않는다.
 */
const SQUEEZE_EXPECTED_REJECTIONS = new Set([
  "INVALID_PHASE_TRANSITION",
  "ALREADY_PEELED",
  "ROUND_PHASE_CHANGED",
  "STALE_ACTION",
]);

export interface SqueezeConfirmResult {
  ok: boolean;
  phase?: string;
  pending?: number;
  /** 정상 거부 (이미 완료 / phase 이동) — 시스템 오류가 아니다 */
  rejected?: string;
}

export async function confirmCardSqueeze(roundId: string): Promise<SqueezeConfirmResult> {
  const { data, error } = await supabase.rpc("confirm_card_squeeze", { _round_id: roundId });
  if (error) throw error;
  const result = (data ?? {}) as { ok?: boolean; error?: string; phase?: string; pending?: number };
  if (result.error) {
    if (SQUEEZE_EXPECTED_REJECTIONS.has(result.error)) {
      return { ok: false, rejected: result.error };
    }
    throw new Error(result.error);
  }
  return {
    ok: result.ok !== false,
    ...(result.phase ? { phase: result.phase } : {}),
    ...(result.pending !== undefined ? { pending: Number(result.pending) } : {}),
  };
}

const PHASE_MAP: Record<ServerPhase, EngineState["phase"]> = {
  DEALING: "betting",
  BETTING: "betting",
  OPEN_CARD_SELECTION: "betting",
  FIRST_BETTING: "betting",
  // 3번째 카드 지급 후에는 쪼기와 최종 베팅이 함께 진행된다
  LAST_CARD_DEALT: "final-betting",
  SQUEEZING: "final-betting",
  FINAL_BETTING: "final-betting",
  // 최종 승부패 2장 제출 단계 (최종 베팅 종료 후에만 열린다)
  HAND_SELECTION: "hand-select",
  FINAL_HAND_SUBMIT: "hand-select",
  SHOWDOWN: "showdown",
  SETTLING: "showdown",
  ROUND_RESULT: "showdown",
  FINISHED: "showdown",
};

/**
 * 서버 상태 → 기존 UI(EngineState) 형태로 매핑한다.
 * UI는 서버가 허용한 정보만 사용하며, 어떤 계산도 추가하지 않는다.
 */
export function toEngineState(server: ServerRoundState, myCards: string[]): EngineState {
  const stageBets = new Map<string, number>();
  for (const a of server.actions) {
    if (a.stage !== server.stage) continue;
    stageBets.set(a.userId, (stageBets.get(a.userId) ?? 0) + Number(a.amount ?? 0));
  }
  const lastActions = new Map<string, BetAction>();
  for (const a of server.actions) {
    if (a.type === "ante") continue;
    lastActions.set(a.userId, a.type as BetAction);
  }

  const players: EnginePlayerState[] = server.seats.map((s) => ({
    userId: s.userId,
    seat: s.seat,
    nickname: s.nickname,
    level: s.level,
    rank: s.rank ?? null,
    title: s.title?.name ?? null,
    characterUrl: s.character?.assetUrl ?? null,
    points: Number(s.points ?? 0),
    initialPoints: s.initialPoints === null ? null : Number(s.initialPoints),
    finalPoints: s.finalPoints === null || s.finalPoints === undefined ? null : Number(s.finalPoints),
    totalBet: Number(s.totalBet ?? 0),
    connection: s.connection,
    avatarUrl: s.avatarUrl,
    cards: s.isMe && myCards.length > 0 ? myCards : (s.cards ?? []),
    bet: stageBets.get(s.userId) ?? 0,
    folded: s.folded,
    acted: s.acted,
    lastAction: lastActions.get(s.userId) ?? null,
    hand: s.handCode
      ? { code: s.handCode, name: s.handName ?? s.handCode, category: "kkeut", score: 0 }
      : null,
    allIn: !!s.isAllIn,
    result:
      s.resultType === "LOSE"
        ? "lose"
        : s.resultType === "WIN" || s.resultType === "DRAW"
          ? "win"
          : null,
    selectedCards: s.selectedCards ?? null,
  }));


  const winners = server.seats
    .filter((s) => s.resultType === "WIN" || s.resultType === "DRAW")
    .map((s) => s.userId);

  const turnSeat = server.turnUserId
    ? (server.seats.find((s) => s.userId === server.turnUserId)?.seat ?? null)
    : null;

  return {
    roundId: server.roundId,
    mode: server.mode,
    baseBet: Number(server.baseBet ?? 0),
    pot: Number(server.pot ?? 0),
    currentBet: Number(server.currentBet ?? 0),
    phase: PHASE_MAP[server.phase] ?? (server.status === "finished" ? "showdown" : "betting"),
    stage: server.stage >= 2 ? 2 : 1,
    turnSeat,
    // 선(先)은 서버 dealer_seat 가 유일한 기준이다 (좌석 정렬로 추정하지 않는다)
    dealerSeat: Number(server.dealerSeat ?? server.seats[0]?.seat ?? 1),
    players,
    log: buildLog(server),
    winners,
  };
}

function buildLog(server: ServerRoundState): string[] {
  const name = (id: string) => server.seats.find((s) => s.userId === id)?.nickname ?? "플레이어";
  const label: Record<string, string> = {
    ante: "기본 베팅",
    call: "콜",
    ping: "삥",
    ttadang: "따당",
    half: "하프",
    quarter: "쿼터",
    check: "체크",
    die: "다이",
    jjol: "쫄",
    all_in: "올인",
  };
  const lines = server.actions.map(
    (a) =>
      `${name(a.userId)}님 ${label[a.type] ?? a.type}` +
      (Number(a.amount) > 0 ? ` ${Number(a.amount).toLocaleString("ko-KR")}P` : ""),
  );
  if (server.settlementStatus === "REMATCH") {
    lines.push(
      server.rematchReason === "GUSA" || server.rematchReason === "GUSA_MEONGTEONG"
        ? `${rematchReasonLabel(server.rematchReason)} 발생 · 판돈을 이월하고 2장 재경기를 진행합니다.`
        : "무승부 · 판돈을 이월하고 동점자끼리 2장 재경기를 진행합니다.",
    );
  }
  if (server.phase === "FINAL_BETTING" && server.mode === "sutda3" && server.stage >= 2)
    lines.push("마지막 패 지급 · 패를 확인하고 최종 베팅을 진행하세요.");
  if (server.phase === "HAND_SELECTION" || server.phase === "FINAL_HAND_SUBMIT")
    lines.push("최종 베팅 종료 · 승부할 2장을 선택하세요.");
  if (server.status === "finished") {
    const winners = server.seats.filter((s) => s.resultType === "WIN" || s.resultType === "DRAW");
    if (winners.length > 0) {
      lines.push(
        `승자: ${winners.map((w) => w.nickname).join(", ")} (${winners[0]?.handName ?? "-"}) · POT ${Number(
          server.pot,
        ).toLocaleString("ko-KR")}P`,
      );
    }
  }
  return lines.slice(-40);
}

/**
 * 서버가 허용한 행동 + 금액.
 * 금액 계산은 100% 서버(get_round_state.availableActions) 값을 사용한다.
 */
export function serverActionOptions(server: ServerRoundState | null): ServerActionOption[] {
  if (!server || !Array.isArray(server.availableActions)) return [];
  return server.availableActions
    .filter((o) => o.enabled !== false)
    .map((o) => {
      // 서버가 additionalAmount(실제 추가 차감액)를 내려주면 그 값을 사용한다.
      const additional = Number(o.additionalAmount ?? o.amount ?? 0);
      return {
        action: o.action,
        amount: additional,
        additionalAmount: additional,
        totalTarget: Number(o.totalTarget ?? additional),
        enabled: true,
      };
    });
}


/** 서버가 계산한 MAIN/SIDE POT 레이어 */
export function sidePots(server: ServerRoundState | null): SidePot[] {
  if (!server || !Array.isArray(server.pots)) return [];
  return server.pots.map((p) => ({
    level: Number(p.level ?? 0),
    amount: Number(p.amount ?? 0),
    eligible: Array.isArray(p.eligible) ? p.eligible : [],
  }));
}
