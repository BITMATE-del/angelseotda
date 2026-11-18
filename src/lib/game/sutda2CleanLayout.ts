/**
 * SUTDA 2 CARD — CLEAN SHELL LAYOUT (단일 좌표 기준).
 *
 * 이 파일이 2장 섯다 게임방 프레젠테이션 좌표의 유일한 source of truth 다.
 * 컴포넌트에는 magic number 를 두지 않고 여기 값만 사용한다.
 *
 * HUD 내부는 absolute 좌표를 쓰지 않는다.
 * [AVATAR][INFO][CARDS] 3-column grid + 하단 상태바 1줄 구조이며,
 * 좌석번호 · 선 · 차례 배지만 HUD 외부 anchor 로 남는다.
 *
 * 게임 로직(카드 지급 · 베팅 · 쪼기 · 족보 · 정산 · 보안)과 무관하다.
 *
 * 좌석 시각 배치 (DB 좌석번호는 변경하지 않는다):
 *
 *        [3]              [4]
 *   [2]        [POT]           [5]
 *                [1]
 *            [BOTTOM BAR]
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * CLEAN SHELL 에셋 (master_v2 · 투명 여백 제거판).
 * 프레임 테두리가 HUD box 경계와 정확히 일치하므로, HUD padding 안의 내용은
 * 항상 프레임 내부에 놓인다 (상태바가 프레임 밖으로 내려가지 않는다).
 */
export const SUTDA2_SHELL = {
  self: "/assets/sutda/master_v2/sutda_seat_self_shell_trim.png",
  opponent: "/assets/sutda/master_v2/sutda_seat_opponent_shell_trim.png",
  empty: "/assets/sutda/master_v2/sutda_seat_empty_shell_trim.png",
} as const;

/**
 * 게임 STAGE — table · seats · POT · progress · bottom bar 를 모두 포함한다.
 * 실제 game viewport(가로: 화면 − 채팅 320 − 여백, 세로: 화면 − 여백) 비율보다
 * 세로로 긴 1500×1120 을 사용해 stage 하단 검은 여백이 남지 않게 한다.
 */
export const STAGE = { width: 1500, height: 1120 } as const;

/** 상단 UI */
export const TOPBAR = {
  logo: { x: 14, y: 6, width: 124, height: 42 },
  roomInfo: { x: 148, y: 12, width: 340, height: 30 },
  /** 우측 컨트롤 — right/top 기준 */
  controls: { right: 14, top: 8, height: 36 },
} as const;

/** 진행 단계 — POT 위, POT 와 겹치지 않는다 */
export const PROGRESS: Box = { x: 570, y: 418, width: 360, height: 34 };

/** 중앙 POT wrapper — 좌석과 독립, 테이블 중앙 고정 */
export const POT: Box = { x: 570, y: 464, width: 360, height: 170 };

/**
 * 하단 READY / ACTION 공용 슬롯 — STAGE 하단 anchor 고정.
 * height 는 실제 액션바(2줄 버튼 + padding) 를 담을 수 있는 값이며,
 * bar 하단(1090) 과 stage 바닥(1120) 사이 30px 는 고정 bottom safe area 다.
 */
export const BOTTOM_BAR: Box = { x: 330, y: 1010, width: 840, height: 80 };

/** self HUD 하단 ~ action bar 상단 사이 최소 여백 (구조 검증 기준) */
export const SELF_BAR_GAP = 45;
/** action bar 하단 ~ stage 바닥 고정 안전영역 */
export const STAGE_BOTTOM_SAFE = 30;


/**
 * 좌석 배지 anchor — HUD 프레임 바깥쪽 좌상단 (HUD 외부 anchor 허용 대상).
 * 배지 box 는 avatar safe zone 시작점보다 위/왼쪽에서 끝나야 한다.
 */
export const BADGES = {
  seatNumber: { x: -14, y: -14, width: 34, height: 34 },
  dealer: { x: 24, y: -14, width: 34, height: 34 },
  /** 차례 배지 — HUD 상단 중앙 offset (상태바와 겹치지 않는다) */
  turnTop: -13,
} as const;

export interface HudSpec {
  width: number;
  height: number;
  shell: string;
  /** AVATAR / INFO / CARD safe zone — HUD box 기준 절대 좌표 (유일한 내부 배치 기준) */
  avatarZone: Box;
  infoZone: Box;
  cardZone: Box;
  /** 하단 상태줄 zone — avatar/card zone 아래, 침범 금지 */
  statusZone: Box;
  /**
   * 카드 바로 아래 "현재 족보" 미리보기 zone (표시 전용 · 3장 본인 좌석에만 존재).
   * 지정하지 않으면 미리보기를 렌더하지 않는다 (2장 섯다 레이아웃 무변경).
   */
  handPreviewZone?: Box;
  cardWidth: number;
  cardHeight: number;
  /** 카드 사이 간격 */
  cardGap: number;
  /** card zone 내부 정렬 */
  cardAlign: "center" | "end";
  /** HwatuCard size key */
  cardSize: "sutda2self" | "sutda2opp";
  titleMaxWidth: number;
  nameFontSize: number;
  rankSize: "sm" | "md";
  pointFontSize: number;
  statusFontSize: number;
  infoRowGap: number;
}

/**
 * 상대 좌석 — 410×170.
 * padding: left/right 18, top/bottom 16 기준으로 3구역을 배치한다.
 * card zone 우측 끝 346 → 프레임 우측 장식까지 64px 여백 (최소 14~18 요구 충족).
 */
export const OPPONENT_HUD: HudSpec = {
  width: 410,
  height: 170,
  shell: SUTDA2_SHELL.opponent,
  avatarZone: { x: 22, y: 26, width: 72, height: 82 },
  infoZone: { x: 108, y: 22, width: 116, height: 88 },
  /** 카드 실제 렌더 50×75 → 상하 10px 여유 확보 (overflow visible) */
  cardZone: { x: 232, y: 14, width: 124, height: 95 },
  statusZone: { x: 108, y: 114, width: 238, height: 22 },
  cardWidth: 50,
  cardHeight: 75,
  cardGap: 7,
  cardAlign: "center",
  cardSize: "sutda2opp",
  titleMaxWidth: 56,
  nameFontSize: 12,
  rankSize: "sm",
  pointFontSize: 14,
  statusFontSize: 11,
  infoRowGap: 5,
};

/**
 * 본인 좌석 — 630×225.
 * padding: left/right 22, top/bottom 18. card zone 우측 끝 510 → 우측 여백 120px.
 */
export const SELF_HUD: HudSpec = {
  width: 630,
  height: 225,
  shell: SUTDA2_SHELL.self,
  avatarZone: { x: 28, y: 30, width: 108, height: 124 },
  infoZone: { x: 154, y: 32, width: 165, height: 106 },
  /** 카드 실제 렌더 86×129 → 상하 여유 확보 (overflow visible) */
  cardZone: { x: 330, y: 14, width: 200, height: 138 },
  /** 카드 바로 아래 "현재 최고패" 전용 한 줄 (상태줄과 y 분리) */
  handPreviewZone: { x: 330, y: 154, width: 200, height: 22 },
  statusZone: { x: 154, y: 178, width: 376, height: 24 },

  cardWidth: 86,
  cardHeight: 129,
  cardGap: 9,
  cardAlign: "center",
  cardSize: "sutda2self",
  titleMaxWidth: 84,
  nameFontSize: 16,
  rankSize: "md",
  pointFontSize: 22,
  statusFontSize: 13,
  infoRowGap: 6,
};

/** 빈 좌석 — 상대 좌석과 동일 규격, 별도 shell (카드 zone 미렌더) */
export const EMPTY_HUD: HudSpec = {
  ...OPPONENT_HUD,
  shell: SUTDA2_SHELL.empty,
  /** 카드가 없으므로 info zone 을 card zone 까지 넓게 쓴다 */
  infoZone: { x: 108, y: 22, width: 238, height: 88 },
};

/** 상대 좌석 시각 슬롯 — 좌중단 → 좌상단 → 우상단 → 우중단 */
export const OPPONENT_SLOTS: readonly { x: number; y: number }[] = [
  { x: 30, y: 330 },
  { x: 180, y: 80 },
  { x: 910, y: 80 },
  { x: 1060, y: 330 },
];

/**
 * 본인 좌석 — 하단 중앙.
 * y 는 action bar(1010) 기준으로 역산한다: 740 + 225 = 965 → bar 상단까지 45px 여백.
 */
export const SELF_SLOT = { x: 435, y: 740 } as const;


/** z-index 계층 (장식은 pointer-events:none) */
export const Z = {
  background: 0,
  seatShell: 10,
  avatar: 20,
  info: 25,
  cards: 30,
  badges: 35,
  pot: 40,
  effects: 50,
  bottomBar: 60,
  topControls: 70,
  result: 90,
} as const;

/** 좌석 렌더 규격 조회 */
export function hudSpec(isMe: boolean): HudSpec {
  return isMe ? SELF_HUD : OPPONENT_HUD;
}

/** safe zone → inline style (HUD box 기준 absolute) */
export function zoneStyle(zone: Box, zIndex: number): React.CSSProperties {
  return {
    position: "absolute",
    left: zone.x,
    top: zone.y,
    width: zone.width,
    height: zone.height,
    zIndex,
  };
}

/**
 * CLEAN LAYOUT BUNDLE — 게임판 컴포넌트가 사용하는 좌표 묶음.
 * 2장/3장은 같은 컴포넌트를 쓰고 이 bundle 만 교체한다 (디자인 동일 · 카드 영역만 다름).
 */
export interface SutdaCleanLayout {
  stage: { width: number; height: number };
  topbar: typeof TOPBAR;
  progress: Box;
  pot: Box;
  bottomBar: Box;
  badges: typeof BADGES;
  opponentSlots: readonly { x: number; y: number }[];
  selfSlot: { x: number; y: number };
  self: HudSpec;
  opponent: HudSpec;
  empty: HudSpec;
  /** 좌석당 예약 카드 슬롯 수 (0장~N장 동일 footprint) */
  cardSlots: number;
}

export const SUTDA2_LAYOUT: SutdaCleanLayout = {
  stage: STAGE,
  topbar: TOPBAR,
  progress: PROGRESS,
  pot: POT,
  bottomBar: BOTTOM_BAR,
  badges: BADGES,
  opponentSlots: OPPONENT_SLOTS,
  selfSlot: SELF_SLOT,
  self: SELF_HUD,
  opponent: OPPONENT_HUD,
  empty: EMPTY_HUD,
  cardSlots: 2,
};


