/**
 * UX POLISH 1 — 도리 게임방 레이어(z-index) 중앙 명세.
 *
 * 클릭 가능한 레이어와 순수 장식 레이어를 분리한다.
 * 장식/애니메이션/particle/결과 레이어는 항상 pointer-events: none 이고,
 * 상단 컨트롤과 액션바는 항상 pointer-events: auto 다.
 */
export const DORI_Z = {
  TABLE_BACKGROUND: 0,
  DECORATIONS: 5,
  SEATS: 20,
  POT: 25,
  CARDS: 30,
  GAME_EFFECTS: 40,
  ACTION_BAR: 60,
  TOP_CONTROLS: 80,
  RESULT_BACKDROP: 90,
  RESULT_PANEL: 100,
} as const;

/** pointer-events 를 절대 받지 않는(장식) 레이어 */
export const DORI_DECORATIVE_LAYERS = [
  "TABLE_BACKGROUND",
  "DECORATIONS",
  "GAME_EFFECTS",
  "RESULT_BACKDROP",
  "RESULT_PANEL",
] as const;

/** 항상 클릭 가능해야 하는 레이어 */
export const DORI_INTERACTIVE_LAYERS = ["SEATS", "ACTION_BAR", "TOP_CONTROLS"] as const;

export function doriLayerIsDecorative(layer: keyof typeof DORI_Z): boolean {
  return (DORI_DECORATIVE_LAYERS as readonly string[]).includes(layer);
}
