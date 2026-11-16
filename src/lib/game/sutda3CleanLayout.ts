/**
 * SUTDA 3 CARD — CLEAN SHELL LAYOUT (3장 섯다 좌표 단일 source of truth).
 *
 * 2장 섯다 디자인(색상 · 프레임 · 테이블 · POT · 채팅 · 액션바)을 그대로 사용하고,
 * 차이는 오직 "카드 2장 → 3장" 을 담기 위한 카드 영역/좌석 폭 확장뿐이다.
 * 2장 좌표 파일(sutda2CleanLayout.ts)은 수정하지 않는다.
 *
 * 게임 로직(카드 지급 · 베팅 · 최종 승부패 선택 · 족보 · 정산 · 보안)과 무관하다.
 *
 *        [3]              [4]
 *   [2]        [POT]           [5]
 *                [1]
 *            [BOTTOM BAR]
 */

import {
  BADGES,
  POT,
  PROGRESS,
  STAGE,
  TOPBAR,
  BOTTOM_BAR,
  type Box,
  type HudSpec,
  type SutdaCleanLayout,
} from "./sutda2CleanLayout";

/** 3장 전용 clean shell (2장 shell 과 동일 디자인 · 카드 영역만 가로로 확장) */
export const SUTDA3_SHELL = {
  self: "/assets/sutda/3card_v1/sutda_seat_self_3card_shell.png",
  opponent: "/assets/sutda/3card_v1/sutda_seat_opponent_3card_shell.png",
  empty: "/assets/sutda/3card_v1/sutda_seat_empty_3card_shell.png",
} as const;

/**
 * 상대 좌석 — 450×170 (2장 410 + 카드 1장 폭).
 * avatar/info/status 좌표는 2장과 동일하고 카드 zone 만 넓어진다.
 */
export const OPPONENT_HUD_3: HudSpec = {
  width: 450,
  height: 170,
  shell: SUTDA3_SHELL.opponent,
  avatarZone: { x: 22, y: 26, width: 72, height: 82 },
  infoZone: { x: 108, y: 22, width: 116, height: 88 },
  /** 카드 3장 = 50×3 + gap 7×2 = 164 → 174 zone (상하 10px 여유, overflow visible) */
  cardZone: { x: 232, y: 14, width: 174, height: 95 },
  statusZone: { x: 108, y: 114, width: 288, height: 22 },
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

/** 본인 좌석 — 720×225 (2장 630 + 카드 1장 폭) */
export const SELF_HUD_3: HudSpec = {
  width: 720,
  height: 225,
  shell: SUTDA3_SHELL.self,
  avatarZone: { x: 28, y: 30, width: 108, height: 124 },
  infoZone: { x: 154, y: 32, width: 165, height: 106 },
  /** 카드 3장 = 86×3 + gap 9×2 = 276 → 296 zone (미리보기 줄 확보를 위해 6px 위로) */
  cardZone: { x: 330, y: 16, width: 296, height: 144 },
  /** 카드 zone 바로 아래 한 줄 — 상태줄(x 154~330)과 x 범위가 겹치지 않는다 */
  handPreviewZone: { x: 330, y: 162, width: 296, height: 24 },
  statusZone: { x: 154, y: 178, width: 176, height: 24 },
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

/** 빈 좌석 — 상대 좌석과 동일 규격, 카드 zone 미렌더 */
export const EMPTY_HUD_3: HudSpec = {
  ...OPPONENT_HUD_3,
  shell: SUTDA3_SHELL.empty,
  infoZone: { x: 108, y: 22, width: 288, height: 88 },
};

/** 상대 좌석 시각 슬롯 — 좌중단 → 좌상단 → 우상단 → 우중단 (450 폭 기준 stage 내부) */
export const OPPONENT_SLOTS_3: readonly { x: number; y: number }[] = [
  { x: 20, y: 330 },
  { x: 170, y: 80 },
  { x: 880, y: 80 },
  { x: 1030, y: 330 },
];

/** 본인 좌석 — 하단 중앙 (720 폭) */
export const SELF_SLOT_3 = { x: 390, y: 740 } as const;

/** 3장 섯다 CLEAN LAYOUT bundle — 2장과 동일 stage/POT/progress/bottom bar */
export const SUTDA3_LAYOUT: SutdaCleanLayout = {
  stage: STAGE,
  topbar: TOPBAR,
  progress: PROGRESS,
  pot: POT,
  bottomBar: BOTTOM_BAR,
  badges: BADGES,
  opponentSlots: OPPONENT_SLOTS_3,
  selfSlot: SELF_SLOT_3,
  self: SELF_HUD_3,
  opponent: OPPONENT_HUD_3,
  empty: EMPTY_HUD_3,
  cardSlots: 3,
};

export type { Box, HudSpec };
