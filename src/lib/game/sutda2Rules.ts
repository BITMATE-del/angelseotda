/**
 * 2장 섯다 족보 판정. UI와 완전히 분리된 순수 모듈.
 * 추후 Node.js 게임 서버에서 동일 모듈을 재사용한다.
 */
import { cardsOfMonth, getCard, monthLead, type Month } from "./cardDeck";
import { isSpecialPair } from "./specialCards";

export type HandCategory =
  | "kwangttaeng"
  | "ttaeng"
  | "special"
  | "gusa"
  | "amhaeng"
  | "ttaengjabi"
  | "kkeut";

export interface Hand {
  code: string;
  name: string;
  category: HandCategory;
  /** 높을수록 강한 패 */
  score: number;
}

interface RankRow {
  code: string;
  name: string;
  category: HandCategory;
  score: number;
  cards: [Month, Month];
}

/** 족보표 (강한 순서대로) */
export const SUTDA2_TABLE: RankRow[] = [
  { code: "kwang38", name: "38광땡", category: "kwangttaeng", score: 1000, cards: [3, 8] },
  { code: "kwang18", name: "18광땡", category: "kwangttaeng", score: 990, cards: [1, 8] },
  { code: "kwang13", name: "13광땡", category: "kwangttaeng", score: 980, cards: [1, 3] },
  { code: "ttaeng10", name: "장땡", category: "ttaeng", score: 910, cards: [10, 10] },
  { code: "ttaeng9", name: "9땡", category: "ttaeng", score: 909, cards: [9, 9] },
  { code: "ttaeng8", name: "8땡", category: "ttaeng", score: 908, cards: [8, 8] },
  { code: "ttaeng7", name: "7땡", category: "ttaeng", score: 907, cards: [7, 7] },
  { code: "ttaeng6", name: "6땡", category: "ttaeng", score: 906, cards: [6, 6] },
  { code: "ttaeng5", name: "5땡", category: "ttaeng", score: 905, cards: [5, 5] },
  { code: "ttaeng4", name: "4땡", category: "ttaeng", score: 904, cards: [4, 4] },
  { code: "ttaeng3", name: "3땡", category: "ttaeng", score: 903, cards: [3, 3] },
  { code: "ttaeng2", name: "2땡", category: "ttaeng", score: 902, cards: [2, 2] },
  { code: "ttaeng1", name: "1땡", category: "ttaeng", score: 901, cards: [1, 1] },
  { code: "ali", name: "알리", category: "special", score: 806, cards: [1, 2] },
  { code: "doksa", name: "독사", category: "special", score: 805, cards: [1, 4] },
  { code: "gupping", name: "구삥", category: "special", score: 804, cards: [1, 9] },
  { code: "jangping", name: "장삥", category: "special", score: 803, cards: [1, 10] },
  { code: "jangsa", name: "장사", category: "special", score: 802, cards: [4, 10] },
  { code: "seryuk", name: "세륙", category: "special", score: 801, cards: [4, 6] },
];

const KKEUT_NAMES: Record<number, string> = {
  9: "갑오",
  8: "8끗",
  7: "7끗",
  6: "6끗",
  5: "5끗",
  4: "4끗",
  3: "3끗",
  2: "2끗",
  1: "1끗",
  0: "망통",
};

function pairMatches(a: Month, b: Month, target: [Month, Month]) {
  return (a === target[0] && b === target[1]) || (a === target[1] && b === target[0]);
}

/** 2장 섯다 족보 판정 */
export function evaluateSutda2(cardIds: readonly string[]): Hand {
  if (cardIds.length !== 2) throw new Error("2장 섯다는 카드 2장이 필요합니다.");
  const first = getCard(cardIds[0]!);
  const second = getCard(cardIds[1]!);
  const a = first.month;
  const b = second.month;

  // 광땡은 두 카드 모두 isGwang: true 인 실제 광 카드일 때만 성립
  if (first.isGwang && second.isGwang) {
    const kwang = SUTDA2_TABLE.filter((r) => r.category === "kwangttaeng").find((r) =>
      pairMatches(a, b, r.cards),
    );
    if (kwang) return toHand(kwang);
  }


  if (a === b) {
    const ttaeng = SUTDA2_TABLE.find((r) => r.category === "ttaeng" && r.cards[0] === a);
    if (ttaeng) return toHand(ttaeng);
  }

  // 암행어사 / 땡잡이 — 지정 카드 조합(variant)만 인정 (서버 evaluate_sutda_hand 와 동일 순서)
  const id1 = first.id;
  const id2 = second.id;
  if (isSpecialPair(id1, id2, "amhaeng")) {
    return { code: "amhaeng", name: "암행어사", category: "amhaeng", score: 101 };
  }
  if (isSpecialPair(id1, id2, "ttaengjabi")) {
    return { code: "ttaengjabi", name: "땡잡이", category: "ttaengjabi", score: 100 };
  }

  // 구사(4월+9월). 더 구체적인 멍텅구리구사를 먼저 판정한다.
  if ((a === 4 && b === 9) || (a === 9 && b === 4)) {
    if (isSpecialPair(id1, id2, "gusa_meongteong")) {
      return { code: "gusa_meongteong", name: "멍텅구리구사", category: "gusa", score: 850 };
    }
    return { code: "gusa", name: "구사", category: "gusa", score: 850 };
  }

  const special = SUTDA2_TABLE.filter((r) => r.category === "special").find((r) =>
    pairMatches(a, b, r.cards),
  );
  if (special) return toHand(special);

  const value = (a + b) % 10;
  return {
    code: `kkeut${value}`,
    name: KKEUT_NAMES[value] ?? `${value}끗`,
    category: "kkeut",
    score: 100 + value,
  };
}

function toHand(row: RankRow): Hand {
  return { code: row.code, name: row.name, category: row.category, score: row.score };
}

/**
 * 특수 상성(암행어사 / 땡잡이 / 구사)을 반영한 비교용 점수.
 * 서버 public.apply_contextual_rules 와 동일한 값을 그대로 미러링한다 (기본 점수 ×10 스케일).
 *  - 암행어사: 상대에 18광땡·13광땡이 있으면 9955 (38광땡 10000 에는 패배), 없으면 1010
 *  - 땡잡이: 상대에 1~9땡이 있으면 9095 (장땡 9100 에는 패배), 없으면 1000
 *  - 구사/멍텅구리구사: 재경기 조건 미달이면 3끗(1030)
 */
export function contextualScores(hands: readonly Hand[]): number[] {
  const codes = hands.map((h) => h.code);
  const bestOtherNonGusa = (self: number) =>
    hands.reduce(
      (best, h, i) =>
        i === self || h.category === "gusa" ? best : Math.max(best, h.score),
      0,
    );

  return hands.map((h, i) => {
    if (h.code === "amhaeng") {
      const target = codes.some((c, j) => j !== i && (c === "kwang18" || c === "kwang13"));
      return target ? 9955 : 1010;
    }
    if (h.code === "ttaengjabi") {
      const target = codes.some((c, j) => j !== i && /^ttaeng[1-9]$/.test(c));
      return target ? 9095 : 1000;
    }
    if (h.category === "gusa") {
      const other = bestOtherNonGusa(i);
      const qualifies = h.code === "gusa_meongteong" ? other <= 909 : other <= 806;
      if (!qualifies) return 1030;
    }
    return h.score * 10;
  });
}

/**
 * 여러 패를 비교하여 승자 index 배열(무승부 시 복수)을 반환.
 * 단순 점수 비교가 아니라 특수 상성(contextualScores)을 적용한다.
 */
export function compareHands(hands: readonly Hand[]): number[] {
  const scores = contextualScores(hands);
  const best = Math.max(...scores);
  return scores.reduce<number[]>((acc, s, i) => (s === best ? [...acc, i] : acc), []);
}

/** 족보표 패널용 대표 카드 이미지 (실제 화투 에셋) */
export function tableRowCards(row: RankRow): [string, string] {
  const [first, second] = row.cards;
  if (row.category === "kwangttaeng") {
    return [monthLead(first).assetUrl, monthLead(second).assetUrl];
  }
  if (row.category === "ttaeng") {
    const pair = cardsOfMonth(first);
    return [pair[0]!.assetUrl, (pair[1] ?? pair[0]!).assetUrl];
  }
  const a = cardsOfMonth(first).find((c) => !c.isGwang) ?? monthLead(first);
  const b = cardsOfMonth(second).find((c) => !c.isGwang) ?? monthLead(second);
  return [a.assetUrl, b.assetUrl];
}

