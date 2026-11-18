/**
 * PHASE 4.1 — 도리 좌석 HUD 고정 레이아웃 명세 (프레젠테이션 전용).
 *
 * HUD 는 "CLEAN SHELL" 이미지(골드 프레임 + 코너 장식 + 배경 패널) 위에
 * 아래 좌표대로 값 레이어만 얹는다. 컴포넌트에서 임의 숫자를 쓰지 않는다.
 * 프로필 창은 좌석당 하나만 존재하고, AVATAR / INFO / CARDS 영역은 서로 침범하지 않는다.
 */
export interface DoriHudBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DoriHudSpec {
  width: number;
  height: number;
  /** shell 내부 content safe area — 모든 값 레이어는 이 안에만 배치된다 */
  safe: { left: number; right: number; top: number; bottom: number };
  avatar: DoriHudBox;
  info: DoriHudBox;
  cards: DoriHudBox;
  status: DoriHudBox;
  /** 좌석번호 배지 (좌상단) */
  seatBadge: DoriHudBox;
  /** 카드 1장 표시 폭 (겹침 계산 기준) */
  cardWidth: number;
  /** 칭호 최대 표시 폭 (초과 시 ellipsis · 닉네임 영역을 침범하지 않는다) */
  titleMaxWidth: number;
  /** "현재 최고패" 전용 한 줄 zone (표시 전용 · 본인 좌석에만 존재) */
  handPreview?: DoriHudBox;
}

export const DORI_HUD_LAYOUT: { opponent: DoriHudSpec; self: DoriHudSpec } = {
  opponent: {
    width: 440,
    height: 170,
    safe: { left: 48, right: 16, top: 24, bottom: 18 },
    avatar: { x: 58, y: 40, width: 82, height: 92 },
    info: { x: 154, y: 32, width: 118, height: 84 },
    cards: { x: 280, y: 46, width: 144, height: 84 },
    status: { x: 154, y: 120, width: 118, height: 20 },
    seatBadge: { x: 12, y: 12, width: 34, height: 34 },
    cardWidth: 44,
    titleMaxWidth: 54,
  },
  self: {
    width: 650,
    height: 265,
    safe: { left: 64, right: 28, top: 34, bottom: 24 },
    avatar: { x: 74, y: 44, width: 112, height: 122 },
    info: { x: 200, y: 42, width: 260, height: 80 },
    cards: { x: 200, y: 124, width: 418, height: 114 },
    status: { x: 74, y: 196, width: 118, height: 22 },
    seatBadge: { x: 16, y: 14, width: 40, height: 40 },
    cardWidth: 80,
    titleMaxWidth: 96,
    /** info(→460) 오른쪽 · cards(y124) 위 — 어떤 영역도 침범하지 않는 전용 한 줄 */
    handPreview: { x: 466, y: 82, width: 156, height: 28 },
  },

};


/** 빈 좌석은 상대 좌석과 동일 규격을 사용한다 */
export const DORI_HUD_EMPTY = DORI_HUD_LAYOUT.opponent;

/** 카드 겹침 step 계산 — 장수가 늘어도 CARDS 영역을 넘지 않는다 */
export function doriCardStep(count: number, areaWidth: number, cardWidth: number): number {
  if (count <= 1) return cardWidth;
  const max = cardWidth + 8;
  return Math.min(max, (areaWidth - cardWidth) / (count - 1));
}
