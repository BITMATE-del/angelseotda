/**
 * SUTDA 2 CARD — PHASE 1 고정 레이아웃 명세 (프레젠테이션 전용).
 *
 * 실제 이미지 에셋(좌석 프레임 · 배경 · POT 액자) 위에 값 레이어만 좌표대로 얹는다.
 * 좌표는 좌석 프레임 에셋에 이미 그려진 슬롯(프로필 창 · 3줄 정보바 · 카드 2칸 · 하단 상태바)에 맞춘다.
 * 이 파일은 UI 좌표 상수만 담고, 카드 지급/베팅/정산/보안 로직과 무관하다.
 *
 * 좌석 시각 배치 (DB 좌석번호는 변경하지 않는다 — presentation only):
 *
 *         seat3        seat4
 *   seat2                    seat5
 *                seat1
 */
export interface SutdaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SutdaHudSpec {
  width: number;
  height: number;
  /** 좌석번호 배지 (좌상단 원형 슬롯) */
  seatBadge: SutdaBox;
  /** 프로필 창 (에셋 내부 실루엣 슬롯) */
  avatar: SutdaBox;
  /** 1줄 — 칭호 | 닉네임 */
  nameRow: SutdaBox;
  /** 2줄 — 계급 */
  rankRow: SutdaBox;
  /** 3줄 — 보유 포인트 (독립 row) */
  pointRow: SutdaBox;
  /** 하단 상태바 */
  status: SutdaBox;
  /** 카드 2장 전용 고정 영역 — 1장/2장 모두 동일 footprint */
  cards: SutdaBox;
  /** 카드 1장 표시 폭 (겹침 step 계산 기준) */
  cardWidth: number;
  /** 카드 1장 표시 높이 */
  cardHeight: number;
  /** 칭호 최대 표시 폭 (초과 시 ellipsis — 닉네임 영역을 침범하지 않는다) */
  titleMaxWidth: number;
  /** 기본 글자 크기 */
  nameFontSize: number;
  pointFontSize: number;
  statusFontSize: number;
}

/** 게임판 고정 캔버스 (uniform scale 로만 축소된다) */
export const SUTDA2_BOARD_WIDTH = 1500;
export const SUTDA2_BOARD_HEIGHT = 760;

export const SUTDA2_HUD: { opponent: SutdaHudSpec; self: SutdaHudSpec } = {
  /** 에셋 원본 1774×887 → 420×210 */
  opponent: {
    width: 420,
    height: 210,
    seatBadge: { x: 14, y: 24, width: 40, height: 40 },
    avatar: { x: 68, y: 58, width: 62, height: 80 },
    nameRow: { x: 160, y: 58, width: 96, height: 20 },
    rankRow: { x: 160, y: 86, width: 96, height: 20 },
    pointRow: { x: 174, y: 112, width: 82, height: 22 },
    status: { x: 124, y: 149, width: 186, height: 20 },
    cards: { x: 258, y: 54, width: 120, height: 90 },
    cardWidth: 50,
    cardHeight: 75,
    titleMaxWidth: 34,
    nameFontSize: 11,
    pointFontSize: 13,
    statusFontSize: 11,
  },
  /** 에셋 원본 1942×809 → 660×275 */
  self: {
    width: 660,
    height: 275,
    seatBadge: { x: 32, y: 20, width: 48, height: 48 },
    avatar: { x: 56, y: 66, width: 84, height: 104 },
    nameRow: { x: 158, y: 78, width: 172, height: 26 },
    rankRow: { x: 188, y: 120, width: 142, height: 26 },
    pointRow: { x: 190, y: 158, width: 140, height: 30 },
    status: { x: 234, y: 230, width: 194, height: 24 },
    cards: { x: 344, y: 58, width: 212, height: 150 },
    cardWidth: 96,
    cardHeight: 144,
    titleMaxWidth: 70,
    nameFontSize: 15,
    pointFontSize: 22,
    statusFontSize: 13,
  },
};

/** 빈 좌석은 상대 좌석과 동일 규격 */
export const SUTDA2_HUD_EMPTY = SUTDA2_HUD.opponent;

/**
 * SUTDA 3 CARD — 3장 전용 좌석 규격.
 *
 * 2장 좌석과 동일한 십자 배치·동일한 POT 좌표를 사용하고,
 * "카드 영역만" 3장 기준으로 확장한다. 카드 슬롯은 1/2/3장 상태 모두
 * 같은 footprint 를 예약하므로 세 번째 패 지급으로 좌표가 이동하지 않는다.
 */
export const SUTDA3_HUD: { opponent: SutdaHudSpec; self: SutdaHudSpec } = {
  /** 에셋 원본 1983×793 → 470×188 */
  opponent: {
    width: 470,
    height: 188,
    seatBadge: { x: 20, y: 20, width: 45, height: 45 },
    avatar: { x: 62, y: 54, width: 58, height: 64 },
    nameRow: { x: 145, y: 76, width: 78, height: 20 },
    rankRow: { x: 132, y: 99, width: 84, height: 19 },
    pointRow: { x: 136, y: 121, width: 82, height: 21 },
    status: { x: 130, y: 146, width: 190, height: 18 },
    cards: { x: 229, y: 49, width: 207, height: 92 },
    cardWidth: 50,
    cardHeight: 75,
    titleMaxWidth: 30,
    nameFontSize: 11,
    pointFontSize: 13,
    statusFontSize: 11,
  },
  /** 에셋 원본 2022×778 → 700×269 */
  self: {
    width: 700,
    height: 269,
    seatBadge: { x: 30, y: 20, width: 52, height: 52 },
    avatar: { x: 94, y: 64, width: 86, height: 92 },
    nameRow: { x: 190, y: 72, width: 120, height: 26 },
    rankRow: { x: 196, y: 108, width: 88, height: 26 },
    pointRow: { x: 196, y: 145, width: 150, height: 28 },
    status: { x: 230, y: 192, width: 280, height: 26 },
    cards: { x: 376, y: 54, width: 300, height: 126 },
    cardWidth: 80,
    cardHeight: 112,
    titleMaxWidth: 52,
    nameFontSize: 15,
    pointFontSize: 22,
    statusFontSize: 13,
  },
};

/**
 * 시각 좌석 위치 — index 0..3 이 십자 구조의 상대 좌석 자리다.
 * (좌 → 좌상 → 우상 → 우 순서로 채운다)
 */
export const SUTDA2_SEAT_SLOTS: readonly { x: number; y: number }[] = [
  { x: 6, y: 236 }, // 좌측 중단
  { x: 150, y: 6 }, // 좌상단
  { x: 930, y: 6 }, // 우상단
  { x: 1074, y: 236 }, // 우측 중단
];

/** 3장 좌석 슬롯 — 2장과 같은 십자 배치, 넓어진 HUD 폭만 반영 */
export const SUTDA3_SEAT_SLOTS: readonly { x: number; y: number }[] = [
  { x: 6, y: 236 }, // 좌측 중단
  { x: 120, y: 6 }, // 좌상단
  { x: 910, y: 6 }, // 우상단
  { x: 1024, y: 236 }, // 우측 중단
];

/** 본인(하단 중앙) 좌석 위치 */
export const SUTDA2_SELF_SLOT = { x: 420, y: 474 };

/** 3장 본인 좌석 (하단 중앙 · 동일 y) */
export const SUTDA3_SELF_SLOT = { x: 400, y: 474 };

/** 중앙 POT — 좌석 사이 중앙 (좌석/카드와 겹치지 않는다) */
export const SUTDA2_POT_BOX: SutdaBox = { x: 590, y: 220, width: 320, height: 190 };

/** 카드 장수(2장/3장)에 맞는 좌석 규격 */
export function sutdaHudSpec(cardMode: 2 | 3, isMe: boolean): SutdaHudSpec {
  const set = cardMode === 3 ? SUTDA3_HUD : SUTDA2_HUD;
  return isMe ? set.self : set.opponent;
}

/** 카드 장수에 맞는 상대 좌석 슬롯 좌표 */
export function sutdaSeatSlots(cardMode: 2 | 3): readonly { x: number; y: number }[] {
  return cardMode === 3 ? SUTDA3_SEAT_SLOTS : SUTDA2_SEAT_SLOTS;
}

/** 카드 장수에 맞는 본인 좌석 좌표 */
export function sutdaSelfSlot(cardMode: 2 | 3): { x: number; y: number } {
  return cardMode === 3 ? SUTDA3_SELF_SLOT : SUTDA2_SELF_SLOT;
}

/** 카드 겹침 step — 장수가 늘어도 CARDS 영역을 넘지 않는다 */
export function sutdaCardStep(count: number, areaWidth: number, cardWidth: number): number {
  if (count <= 1) return cardWidth;
  const max = cardWidth + 8;
  return Math.min(max, (areaWidth - cardWidth) / (count - 1));
}
