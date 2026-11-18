/**
 * 섯다(2장 · 3장) 게임방 UI 이미지 에셋 경로.
 *
 * ANGEL GAME UI DESIGN SYSTEM 원칙:
 * 골드 프레임 · POT 액자 · 좌석 프레임 · 전통 문양은 실제 이미지 에셋으로만 표현한다.
 * 이 파일은 UI 그래픽 레이어 경로 상수만 담고, 게임 로직/규칙/정산과는 무관하다.
 */
export const SUTDA_UI = {
  tableBg: "/assets/sutda/sutda-table-bg.webp",
  logo: "/assets/sutda/sutda-logo.png",
  potFrame: "/assets/sutda/sutda-pot-frame.png",
  seatOpponent2: "/assets/sutda/sutda-seat-opponent-2card.png",
  seatOpponent3: "/assets/sutda/sutda-seat-opponent-3card.png",
  seatSelf2: "/assets/sutda/sutda-seat-self-2card.png",
  seatSelf3: "/assets/sutda/sutda-seat-self-3card.png",
  seatEmpty: "/assets/sutda/sutda-seat-empty.png",
  seatNumberBadge: "/assets/sutda/sutda-seat-number-badge.png",
  dealerBadge: "/assets/sutda/sutda-dealer-badge.png",
  buttonGold: "/assets/sutda/sutda-button-gold.png",
  buttonRed: "/assets/sutda/sutda-button-red.png",
} as const;

/** 카드 장수(2장/3장)에 맞는 좌석 프레임 — 상대 좌석 */
export function sutdaOpponentFrame(cardMode: 2 | 3) {
  return cardMode === 3 ? SUTDA_UI.seatOpponent3 : SUTDA_UI.seatOpponent2;
}

/** 카드 장수(2장/3장)에 맞는 좌석 프레임 — 내 좌석 */
export function sutdaSelfFrame(cardMode: 2 | 3) {
  return cardMode === 3 ? SUTDA_UI.seatSelf3 : SUTDA_UI.seatSelf2;
}
