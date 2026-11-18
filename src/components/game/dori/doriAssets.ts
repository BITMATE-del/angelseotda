/**
 * 도리짓고땡 게임방 UI 그래픽 에셋 경로 (프레젠테이션 레이어 전용).
 * CSS로 프레임/문양을 다시 그리지 않고 실제 이미지 에셋만 사용한다.
 *
 * 주의: pot-frame.png 는 금화 더미가 포함된 일체형 에셋이므로
 * pot-coins.png 를 함께 겹치지 않는다 (중복 금화 금지).
 */
export const DORI_UI = {
  tableBg: "/assets/game/game-table-bg.webp",
  potFrame: "/assets/game/pot-frame.png",
  /**
   * 좌석 CLEAN SHELL — 프레임/코너 장식/배경 패널만 있는 에셋.
   * 프로필 박스·좌석번호·닉네임·카드슬롯은 이미지에 굽지 않고 HTML overlay 로 얹는다.
   */
  seatSelf: "/assets/game/dori/seat-self-shell.png",
  seatOpponent: "/assets/game/dori/seat-opponent-shell.png",
  seatEmpty: "/assets/game/dori/seat-empty-shell.png",
  seatBadge: "/assets/game/seat-number-badge.png",
  dealerBadge: "/assets/game/dealer-badge.png",
  buttonGold: "/assets/game/button-gold.png",
  buttonRed: "/assets/game/button-red.png",
  logo: "/assets/game/dori-logo.png",
  stamp: "/assets/game/red-stamp.png",
} as const;

/**
 * 좌석 프레임 표시 크기 — DORI_HUD_LAYOUT 과 동일 규격.
 * 내 좌석이 상대 좌석보다 확실히 크다.
 */
export const DORI_SEAT_BOX = {
  self: { width: 650, height: 265 },
  opponent: { width: 440, height: 170 },
  empty: { width: 440, height: 170 },
} as const;


/**
 * 프레임 이미지에 이미 그려진 "좌석번호 원형"과 "프로필 박스" 위치(비율).
 * 값 레이어는 이 좌표 위에만 얹고, 새 박스/테두리를 그리지 않는다.
 */
export const DORI_FRAME_SPOT = {
  self: {
    badge: { cx: 0.069, cy: 0.167, size: 52 },
    portrait: { left: 0.165, top: 0.15, width: 0.165, height: 0.35 },
  },
  opponent: {
    badge: { cx: 0.094, cy: 0.196, size: 44 },
    portrait: { left: 0.217, top: 0.18, width: 0.198, height: 0.62 },
  },
} as const;
