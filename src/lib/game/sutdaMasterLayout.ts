/**
 * ANGEL SUTDA 2 CARD — MASTER FOUNDATION (STEP 3).
 *
 * 이 파일은 "에셋 경로 + 마스터 좌표 기준"만 정의한다.
 * 실제 게임 화면 교체는 다음 단계에서 진행하며, 이 모듈은 좌표/에셋의 단일 기준점이다.
 *
 * 규칙:
 * - 모든 좌표는 1500×760 고정 캔버스 좌표계에서만 계산한다.
 * - 브라우저에서는 outer container 기준으로 stage 전체를 uniform scale 만 한다 (내부 재계산 금지).
 * - 카드 앞면/뒷면 에셋은 기존 화투 에셋을 그대로 사용한다 (이 팩의 카드 샘플은 사용 금지).
 * - MASTER_ASSET_SHEET 는 렌더링하지 않는다 (디자인·비율·색상 기준 전용).
 * - 게임 로직 / 베팅 / 카드 지급 / 쪼기 / 보안 / 정산 / 채팅 / 사운드와 무관하다.
 */

/** master_v1 에셋 루트 */
const ROOT = "/assets/sutda/master_v1";

/** 디자인 기준 시트 — 화면에 렌더링하지 않는다 (참조 전용) */
export const SUTDA_MASTER_SHEET = `${ROOT}/MASTER_ASSET_SHEET.png` as const;

/** master_v1 UI 에셋 경로 (카드 에셋 제외) */
export const SUTDA_MASTER_ASSETS = {
  tableBg: `${ROOT}/sutda_table_bg.png`,
  logo: `${ROOT}/sutda_logo.png`,
  potFrame: `${ROOT}/sutda_pot_frame.png`,
  seatSelf2: `${ROOT}/sutda_seat_self_2card.png`,
  seatOpponent2: `${ROOT}/sutda_seat_opponent_2card.png`,
  seatEmpty: `${ROOT}/sutda_seat_empty.png`,
  seatNumberBadges: `${ROOT}/sutda_seat_number_badges.png`,
  dealerBadge: `${ROOT}/sutda_dealer_badge.png`,
  turnBadge: `${ROOT}/sutda_turn_badge.png`,
  rankBadges: `${ROOT}/sutda_rank_badges.png`,
  stageProgress: `${ROOT}/sutda_stage_progress.png`,
  chatPanel: `${ROOT}/sutda_chat_panel.png`,
  chatTabs: `${ROOT}/sutda_chat_tabs.png`,
  foldWinChoice: `${ROOT}/sutda_foldwin_choice.png`,
  resultWin: `${ROOT}/sutda_result_win.png`,
  resultLose: `${ROOT}/sutda_result_lose.png`,
  resultRematch: `${ROOT}/sutda_result_rematch.png`,
  statusWaiting: `${ROOT}/sutda_status_waiting.png`,
  statusReady: `${ROOT}/sutda_status_ready.png`,
  statusPlaying: `${ROOT}/sutda_status_playing.png`,
  statusTurn: `${ROOT}/sutda_status_turn.png`,
  statusFold: `${ROOT}/sutda_status_fold.png`,
  statusAllin: `${ROOT}/sutda_status_allin.png`,
  statusDisconnected: `${ROOT}/sutda_status_disconnected.png`,
  btnCheck: `${ROOT}/sutda_btn_check.png`,
  btnCall: `${ROOT}/sutda_btn_call.png`,
  btnPing: `${ROOT}/sutda_btn_ping.png`,
  btnDdadang: `${ROOT}/sutda_btn_ddadang.png`,
  btnQuarter: `${ROOT}/sutda_btn_quarter.png`,
  btnHalf: `${ROOT}/sutda_btn_half.png`,
  btnAllin: `${ROOT}/sutda_btn_allin.png`,
  btnFold: `${ROOT}/sutda_btn_fold.png`,
  btnSound: `${ROOT}/sutda_btn_sound.png`,
  btnFullscreen: `${ROOT}/sutda_btn_fullscreen.png`,
  btnMode: `${ROOT}/sutda_btn_mode.png`,
  btnExit: `${ROOT}/sutda_btn_exit.png`,
  decoCircle: `${ROOT}/sutda_deco_circle.png`,
  decoFlower: `${ROOT}/sutda_deco_flower.png`,
  decoLine: `${ROOT}/sutda_deco_line.png`,
  decoCorner: `${ROOT}/sutda_deco_corner.png`,
} as const;

export interface MasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 고정 게임 캔버스 — 이 값 외의 기준 해상도는 사용하지 않는다 */
export const SUTDA_MASTER_STAGE = { width: 1500, height: 760 } as const;

/**
 * 좌석 rect — DB 좌석번호 그대로 사용 (presentation only).
 *
 *        [seat3]        [seat4]
 *  [seat2]      [POT]        [seat5]
 *                [seat1]
 */
export const SUTDA_MASTER_SEATS: Record<1 | 2 | 3 | 4 | 5, MasterRect> = {
  1: { x: 420, y: 500, width: 660, height: 220 },
  2: { x: 35, y: 285, width: 390, height: 175 },
  3: { x: 175, y: 70, width: 390, height: 175 },
  4: { x: 935, y: 70, width: 390, height: 175 },
  5: { x: 1075, y: 285, width: 390, height: 175 },
};

/** 중앙 POT wrapper — frame · coin · 금액 · sub text 를 모두 이 wrapper 안에서 관리한다 */
export const SUTDA_MASTER_POT: MasterRect = { x: 590, y: 275, width: 320, height: 190 };

export interface MasterHudZones {
  /** 프로필 1개만 렌더링 (equipped character → profile avatar → fallback) */
  avatar: MasterRect;
  /** 3줄 독립 구조 — 칭호|닉네임 / 티어 / 포인트 */
  info: MasterRect;
  /** 카드 고정 footprint — 1장이든 2장이든 동일 */
  cards: MasterRect;
  /** 하단 상태 표시 */
  status: MasterRect;
}

/** seat1(본인) HUD 내부 좌표 — seat wrapper 기준 상대 좌표 */
export const SUTDA_MASTER_SELF_ZONES: MasterHudZones = {
  avatar: { x: 45, y: 38, width: 112, height: 132 },
  info: { x: 175, y: 42, width: 210, height: 120 },
  cards: { x: 405, y: 28, width: 215, height: 150 },
  status: { x: 170, y: 170, width: 300, height: 30 },
};

/** 상대 좌석 HUD 내부 좌표 — seat wrapper 기준 상대 좌표 */
export const SUTDA_MASTER_OPPONENT_ZONES: MasterHudZones = {
  avatar: { x: 42, y: 42, width: 82, height: 96 },
  info: { x: 138, y: 40, width: 125, height: 105 },
  cards: { x: 270, y: 36, width: 105, height: 110 },
  status: { x: 135, y: 142, width: 155, height: 25 },
};

/** 빈 좌석은 상대 좌석과 동일 규격 */
export const SUTDA_MASTER_EMPTY_ZONES = SUTDA_MASTER_OPPONENT_ZONES;

/** 좌석 배지 anchor — 좌석번호 / dealer / turn 각 1회만 표시 (중복 금지) */
export const SUTDA_MASTER_BADGES = {
  /** 좌석번호 — wrapper 좌상단 경계 부근 */
  seatNumber: { x: -10, y: -12, width: 40, height: 40 },
  /** dealer(선) — 좌석번호 오른쪽 */
  dealer: { x: 34, y: -12, width: 40, height: 40 },
  /** 차례 — 상태줄과 겹치지 않는 별도 anchor (wrapper 우상단) */
  turn: { x: 0, y: -14, width: 64, height: 26, align: "right" as const },
} as const;

/** 상단 UI 좌표 — 좌측 로고/방정보, 우측 사운드·전체화면·게임모드·나가기 */
export const SUTDA_MASTER_TOPBAR = {
  logo: { x: 18, y: 10, width: 132, height: 44 },
  roomInfo: { x: 162, y: 14, width: 320, height: 40 },
  controls: { x: 1150, y: 12, width: 336, height: 40 },
  controlSize: { width: 76, height: 36 },
  controlGap: 10,
} as const;

/**
 * 프로필 렌더 소스 결정 — 항상 1개만 반환한다 (동시 2개 렌더링 금지).
 */
export function resolveMasterAvatarSource(
  equippedCharacterUrl?: string | null,
  profileAvatarUrl?: string | null,
): { src: string | null; kind: "character" | "avatar" | "fallback" } {
  if (equippedCharacterUrl) return { src: equippedCharacterUrl, kind: "character" };
  if (profileAvatarUrl) return { src: profileAvatarUrl, kind: "avatar" };
  return { src: null, kind: "fallback" };
}

/** avatar wrapper 공통 스타일 기준 (overflow hidden + cover + center top) */
export const SUTDA_MASTER_AVATAR_FIT = {
  wrapper: "overflow:hidden",
  objectFit: "cover" as const,
  objectPosition: "center top" as const,
} as const;

/** 좌석 rect 조회 */
export function masterSeatRect(seat: number): MasterRect | null {
  return SUTDA_MASTER_SEATS[seat as 1 | 2 | 3 | 4 | 5] ?? null;
}

/** 좌석 HUD 내부 zone 조회 */
export function masterHudZones(isMe: boolean): MasterHudZones {
  return isMe ? SUTDA_MASTER_SELF_ZONES : SUTDA_MASTER_OPPONENT_ZONES;
}

/* ============================================================
 * STEP 4 — 실제 화면 조립용 파생 명세 (이 파일이 유일한 좌표 기준이다)
 * ============================================================ */

/** 좌석 HUD 렌더 명세 — 위 zone 값에서만 파생한다 */
export interface MasterHudSpec {
  width: number;
  height: number;
  seatBadge: MasterRect;
  dealerBadge: MasterRect;
  avatar: MasterRect;
  /** info zone 3행 분리 — 칭호|닉네임 / 계급 / 포인트 */
  nameRow: MasterRect;
  rankRow: MasterRect;
  pointRow: MasterRect;
  status: MasterRect;
  cards: MasterRect;
  cardWidth: number;
  cardHeight: number;
  titleMaxWidth: number;
  nameFontSize: number;
  pointFontSize: number;
  statusFontSize: number;
}

/** seat1(본인) 렌더 명세 */
export const SUTDA_MASTER_SELF_HUD: MasterHudSpec = {
  width: SUTDA_MASTER_SEATS[1].width,
  height: SUTDA_MASTER_SEATS[1].height,
  seatBadge: SUTDA_MASTER_BADGES.seatNumber,
  dealerBadge: SUTDA_MASTER_BADGES.dealer,
  avatar: SUTDA_MASTER_SELF_ZONES.avatar,
  nameRow: { x: 178, y: 44, width: 205, height: 30 },
  rankRow: { x: 200, y: 78, width: 183, height: 28 },
  pointRow: { x: 200, y: 110, width: 183, height: 34 },
  status: SUTDA_MASTER_SELF_ZONES.status,
  cards: SUTDA_MASTER_SELF_ZONES.cards,
  cardWidth: 96,
  cardHeight: 144,
  titleMaxWidth: 72,
  nameFontSize: 15,
  pointFontSize: 22,
  statusFontSize: 13,
};

/** 상대 좌석 렌더 명세 */
export const SUTDA_MASTER_OPPONENT_HUD: MasterHudSpec = {
  width: SUTDA_MASTER_SEATS[2].width,
  height: SUTDA_MASTER_SEATS[2].height,
  seatBadge: SUTDA_MASTER_BADGES.seatNumber,
  dealerBadge: SUTDA_MASTER_BADGES.dealer,
  avatar: SUTDA_MASTER_OPPONENT_ZONES.avatar,
  nameRow: { x: 156, y: 42, width: 107, height: 22 },
  rankRow: { x: 158, y: 66, width: 105, height: 20 },
  pointRow: { x: 158, y: 88, width: 105, height: 22 },
  status: SUTDA_MASTER_OPPONENT_ZONES.status,
  cards: SUTDA_MASTER_OPPONENT_ZONES.cards,
  cardWidth: 50,
  cardHeight: 75,
  titleMaxWidth: 34,
  nameFontSize: 11,
  pointFontSize: 13,
  statusFontSize: 11,
};

/** 빈 좌석 명세 — 상대와 동일 규격 */
export const SUTDA_MASTER_EMPTY_HUD = SUTDA_MASTER_OPPONENT_HUD;

/** 좌석 렌더 명세 조회 */
export function masterHudSpec(isMe: boolean): MasterHudSpec {
  return isMe ? SUTDA_MASTER_SELF_HUD : SUTDA_MASTER_OPPONENT_HUD;
}

/**
 * 상대 좌석 시각 슬롯 — 좌 → 좌상 → 우상 → 우 (seat2/3/4/5 rect 그대로).
 * DB 좌석번호는 변경하지 않는다 (표시 좌표만 사용).
 */
export const SUTDA_MASTER_OPPONENT_SLOTS: readonly { x: number; y: number }[] = [
  { x: SUTDA_MASTER_SEATS[2].x, y: SUTDA_MASTER_SEATS[2].y },
  { x: SUTDA_MASTER_SEATS[3].x, y: SUTDA_MASTER_SEATS[3].y },
  { x: SUTDA_MASTER_SEATS[4].x, y: SUTDA_MASTER_SEATS[4].y },
  { x: SUTDA_MASTER_SEATS[5].x, y: SUTDA_MASTER_SEATS[5].y },
];

/** 본인 좌석 시각 슬롯 (하단 중앙) */
export const SUTDA_MASTER_SELF_SLOT = {
  x: SUTDA_MASTER_SEATS[1].x,
  y: SUTDA_MASTER_SEATS[1].y,
} as const;

/** 상태 표시용 master 배지 에셋 — 라벨이 에셋에 포함되어 있으므로 텍스트 중복 렌더 금지 */
export type MasterStatusKind =
  | "waiting"
  | "ready"
  | "playing"
  | "turn"
  | "fold"
  | "allin"
  | "disconnected";

export const SUTDA_MASTER_STATUS_ASSET: Record<MasterStatusKind, string> = {
  waiting: SUTDA_MASTER_ASSETS.statusWaiting,
  ready: SUTDA_MASTER_ASSETS.statusReady,
  playing: SUTDA_MASTER_ASSETS.statusPlaying,
  turn: SUTDA_MASTER_ASSETS.statusTurn,
  fold: SUTDA_MASTER_ASSETS.statusFold,
  allin: SUTDA_MASTER_ASSETS.statusAllin,
  disconnected: SUTDA_MASTER_ASSETS.statusDisconnected,
};

/** 상태 배지 에셋 원본 비율 (123×50) */
export const SUTDA_MASTER_STATUS_RATIO = 123 / 50;

/** z-index 계층 — 장식은 항상 아래, 조작 가능한 요소만 위 */
export const SUTDA_MASTER_Z = {
  background: 0,
  decoration: 1,
  pot: 2,
  seat: 3,
  badge: 4,
  overlayInfo: 5,
  fx: 8,
  interactive: 10,
} as const;

