/**
 * 3장 섯다 족보 판정. 2장 규칙과 완전히 분리된 모듈이므로
 * 규칙 변경 시 이 파일만 수정하면 된다.
 *
 * 기본 규칙(ANGEL SUTDA 하우스 룰):
 *  - 3장 중 가장 강한 2장 조합을 자신의 족보로 사용한다.
 *  - 같은 월 3장(삼땡)은 모든 광땡보다 강하다.
 */
import { getCard } from "./cardDeck";
import { evaluateSutda2, type Hand } from "./sutda2Rules";

export interface Sutda3Hand extends Hand {
  /** 실제로 사용된 2장 */
  usedCards: string[];
}

export function evaluateSutda3(cardIds: readonly string[]): Sutda3Hand {
  if (cardIds.length !== 3) throw new Error("3장 섯다는 카드 3장이 필요합니다.");
  const cards = cardIds.map((id) => getCard(id));
  const months = cards.map((c) => c.month);

  if (months[0] === months[1] && months[1] === months[2]) {
    return {
      code: `samttaeng${months[0]}`,
      name: `${months[0]}삼땡`,
      category: "ttaeng",
      score: 1100 + (months[0] ?? 0),
      usedCards: [...cardIds],
    };
  }

  const combos: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  let best: Sutda3Hand | null = null;
  for (const [i, j] of combos) {
    const pair = [cardIds[i]!, cardIds[j]!];
    const hand = evaluateSutda2(pair);
    if (!best || hand.score > best.score) best = { ...hand, usedCards: pair };
  }
  return best!;
}

export const SUTDA3_ACTIONS = ["die", "call", "ping", "ttadang", "half", "jjol"] as const;
export type Sutda3Action = (typeof SUTDA3_ACTIONS)[number];

/** 3장 중 2장 조합 3가지 + 각 조합의 족보 (최종 승부패 선택 UI 용도) */
export interface ComboOption {
  cards: [string, string];
  hand: Hand;
}

export function comboOptions(cardIds: readonly string[]): ComboOption[] {
  if (cardIds.length !== 3) return [];
  const pairs: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  return pairs.map(([i, j]) => {
    const cards: [string, string] = [cardIds[i]!, cardIds[j]!];
    return { cards, hand: evaluateSutda2(cards) };
  });
}

/** 최고 족보 조합 (봇 및 '자동 선택' 옵션용) */
export function bestCombo(cardIds: readonly string[]): [string, string] | null {
  const options = comboOptions(cardIds);
  if (options.length === 0) return null;
  // 구사는 재경기 대상이므로 자동 선택에서 후순위로 둔다 (서버 sutda_best_pair와 동일 정책).
  const rank = (o: ComboOption) => o.hand.score - (o.hand.category === "gusa" ? 10_000 : 0);
  return options.reduce((a, b) => (rank(b) > rank(a) ? b : a)).cards;
}
