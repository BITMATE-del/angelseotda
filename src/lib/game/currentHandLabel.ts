/**
 * CURRENT HAND LABEL — "현재 최고패" 표시 문구 생성 (표시 전용 · 본인 화면 한정).
 *
 * 중요:
 *  - 게임 규칙 / 베팅 / 정산 / 승패 판정 / 카드 보안과 완전히 무관하다.
 *  - 본인이 이미 보유·확인 가능한 자기 카드만 입력으로 받는다 (상대 정보 입력 금지).
 *  - 최종 승패·족보 확정은 항상 서버값을 사용하며, 이 모듈 값은 어떤 요청에도 실리지 않는다.
 */
import { doriBestMake, evaluateDoriPairCards } from "./dori/doriRules";
import { evaluateSutda2 } from "./sutda2Rules";
import { evaluateSutda3 } from "./sutda3Rules";

export const HAND_LABEL_PREFIX = "현재 최고패";
export const HAND_LABEL_PENDING = "판정 대기";
export const HAND_LABEL_BEFORE_MAKE = "짓기 전";
export const HAND_LABEL_HWANG = "황";

/** 2장 섯다 — 2장을 모두 보유했을 때만 족보를 표시한다 */
export function sutda2CurrentHandLabel(cards: readonly string[]): string {
  if (cards.length < 2) return HAND_LABEL_PENDING;
  try {
    return evaluateSutda2([cards[0]!, cards[1]!]).name;
  } catch {
    return HAND_LABEL_PENDING;
  }
}

/**
 * 3장 섯다 — 최종 2장을 고르는 중이면 선택 상태를, 아니면 보유 3장 기준 최고 조합을 안내한다.
 */
export function sutda3CurrentHandLabel(
  cards: readonly string[],
  picked: readonly string[] = [],
  selecting = false,
): string {
  if (selecting) {
    if (picked.length === 0) return HAND_LABEL_PENDING;
    if (picked.length === 1) return "1장 더 선택하세요";
    try {
      return evaluateSutda2([picked[0]!, picked[1]!]).name;
    } catch {
      return HAND_LABEL_PENDING;
    }
  }
  if (cards.length === 2) return sutda2CurrentHandLabel(cards);
  if (cards.length !== 3) return HAND_LABEL_PENDING;
  try {
    return evaluateSutda3(cards).name;
  } catch {
    return HAND_LABEL_PENDING;
  }
}

/**
 * 도리짓고땡 — 5장 완성 전에는 "짓기 전", 5장이면 짓기 결과 기준 승부 2장 족보를 표시한다.
 * 짓기 확정(selected 3장) 이후에는 남은 2장 기준으로 표시한다.
 */
export function doriCurrentHandLabel(
  cards: readonly string[],
  selectedCards?: readonly string[] | null,
  remainingCards?: readonly string[] | null,
): string {
  if (selectedCards && selectedCards.length === 3) {
    const rest =
      remainingCards && remainingCards.length === 2
        ? remainingCards
        : cards.filter((c) => !selectedCards.includes(c));
    if (rest.length !== 2) return HAND_LABEL_PENDING;
    try {
      return evaluateDoriPairCards(rest[0]!, rest[1]!).label;
    } catch {
      return HAND_LABEL_PENDING;
    }
  }
  if (cards.length < 5) return HAND_LABEL_BEFORE_MAKE;
  try {
    const best = doriBestMake(cards);
    if (!best.made) return HAND_LABEL_HWANG;
    return best.hand.label;
  } catch {
    return HAND_LABEL_PENDING;
  }
}
