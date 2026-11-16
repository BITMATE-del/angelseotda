/**
 * DORI SPECIAL HAND COMPLETE PATCH — 짓기 후 남은 승부패 2장 fixture 회귀 테스트.
 *
 * 남은 2장 판정은 검증 완료된 2장 섯다 evaluator(evaluateSutda2)를 그대로 재사용한다.
 * 짓기 3장은 족보 계산에 포함하지 않으며, 짓기 실패(황)는 특수족보 판정 대상이 아니다.
 */
import { describe, expect, it } from "vitest";
import {
  doriEffectiveRanks,
  doriWinners,
  evaluateDoriPairCards,
  validateDoriMake,
  doriBestMake,
} from "./doriRules";

interface Fixture {
  name: string;
  cards: string[];
  selected: string[];
  remaining: string[];
  code: string;
  label: string;
  makeTotal: number;
}

const FIXTURES: Fixture[] = [
  {
    name: "A. 세륙 (6월 + 4월)",
    cards: ["01-normal", "02-a", "07-a", "04-b", "06-a"],
    selected: ["01-normal", "02-a", "07-a"],
    remaining: ["04-b", "06-a"],
    code: "SERYUK",
    label: "세륙",
    makeTotal: 10,
  },
  {
    name: "B. 알리",
    cards: ["03-normal", "07-a", "10-b", "01-normal", "02-a"],
    selected: ["03-normal", "07-a", "10-b"],
    remaining: ["01-normal", "02-a"],
    code: "ALI",
    label: "알리",
    makeTotal: 20,
  },
  {
    name: "C. 독사",
    cards: ["02-a", "08-normal", "10-b", "01-normal", "04-b"],
    selected: ["02-a", "08-normal", "10-b"],
    remaining: ["01-normal", "04-b"],
    code: "DOKSA",
    label: "독사",
    makeTotal: 20,
  },
  {
    name: "D. 구삥",
    cards: ["02-a", "08-normal", "10-b", "01-normal", "09-b"],
    selected: ["02-a", "08-normal", "10-b"],
    remaining: ["01-normal", "09-b"],
    code: "GUPPING",
    label: "구삥",
    makeTotal: 20,
  },
  {
    name: "E. 장삥",
    cards: ["02-a", "08-normal", "10-a", "01-normal", "10-b"],
    selected: ["02-a", "08-normal", "10-a"],
    remaining: ["01-normal", "10-b"],
    code: "JANGPING",
    label: "장삥",
    makeTotal: 20,
  },
  {
    name: "F. 장사",
    cards: ["02-a", "08-normal", "10-a", "04-b", "10-b"],
    selected: ["02-a", "08-normal", "10-a"],
    remaining: ["04-b", "10-b"],
    code: "JANGSA",
    label: "장사",
    makeTotal: 20,
  },
  {
    name: "G. 갑오",
    cards: ["02-a", "08-normal", "10-a", "04-b", "05-a"],
    selected: ["02-a", "08-normal", "10-a"],
    remaining: ["04-b", "05-a"],
    code: "GGUT_9",
    label: "갑오",
    makeTotal: 20,
  },
  {
    name: "H. 망통",
    cards: ["01-normal", "03-normal", "06-a", "02-b", "08-normal"],
    selected: ["01-normal", "03-normal", "06-a"],
    remaining: ["02-b", "08-normal"],
    code: "GGUT_0",
    label: "망통",
    makeTotal: 10,
  },
  {
    name: "I. 땡잡이",
    cards: ["01-normal", "02-a", "07-b", "03-gwang", "07-a"],
    selected: ["01-normal", "02-a", "07-b"],
    remaining: ["03-gwang", "07-a"],
    code: "TTAENGJABI",
    label: "땡잡이",
    makeTotal: 10,
  },
  {
    name: "J. 암행어사",
    cards: ["01-normal", "02-a", "07-b", "04-a", "07-a"],
    selected: ["01-normal", "02-a", "07-b"],
    remaining: ["04-a", "07-a"],
    code: "AMHAENG",
    label: "암행어사",
    makeTotal: 10,
  },
  {
    name: "K. 구사",
    cards: ["01-normal", "02-a", "07-a", "04-b", "09-b"],
    selected: ["01-normal", "02-a", "07-a"],
    remaining: ["04-b", "09-b"],
    code: "GUSA",
    label: "구사",
    makeTotal: 10,
  },
  {
    name: "L. 멍텅구리구사",
    cards: ["01-normal", "02-a", "07-a", "04-a", "09-a"],
    selected: ["01-normal", "02-a", "07-a"],
    remaining: ["04-a", "09-a"],
    code: "MUNG_GUSA",
    label: "멍텅구리구사",
    makeTotal: 10,
  },
];

describe("도리 짓기 후 남은 2장 — 섯다 특수족보 fixture", () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const v = validateDoriMake(f.cards, f.selected);
      expect(v.ok).toBe(true);
      expect(v.makeTotal).toBe(f.makeTotal);
      expect(v.remaining).toEqual(f.remaining);
      expect(v.hand!.code).toBe(f.code);
      expect(v.hand!.label).toBe(f.label);
      // 짓기 3장은 족보 계산에 포함되지 않는다 — 남은 2장 단독 판정과 동일
      expect(evaluateDoriPairCards(f.remaining[0]!, f.remaining[1]!)).toEqual(v.hand);
    });
  }

  it("광땡 / 땡도 남은 2장으로 판정된다", () => {
    expect(evaluateDoriPairCards("03-gwang", "08-gwang").label).toBe("38광땡");
    expect(evaluateDoriPairCards("01-gwang", "08-gwang").label).toBe("18광땡");
    expect(evaluateDoriPairCards("01-gwang", "03-gwang").label).toBe("13광땡");
    expect(evaluateDoriPairCards("10-a", "10-b").code).toBe("DDAENG_10");
    expect(evaluateDoriPairCards("05-a", "05-b").code).toBe("DDAENG_5");
  });

  it("황 precedence — 짓기 실패면 남은 2장 모양과 무관하게 황", () => {
    // 어떤 3장도 10/20/30 을 만들 수 없는 5장
    const r = doriBestMake(["09-a", "10-a", "09-b", "04-a", "03-gwang"]);
    expect(r.made).toBe(false);
    expect(r.hand.code).toBe("HWANG");
    expect(r.hand.rank).toBe(0);
  });
});

describe("도리 comparator — 섯다 조건부 상성 재사용", () => {
  const h = (a: string, b: string) => evaluateDoriPairCards(a, b);

  it("특수족보는 일반 끗보다 강하다 (세륙 > 6끗)", () => {
    const ranks = doriEffectiveRanks([h("04-b", "06-a"), h("02-b", "04-b")]);
    expect(ranks[0]!).toBeGreaterThan(ranks[1]!);
  });

  it("3인 — 세륙 / 일반 끗 / 5땡 → 땡 승리", () => {
    const hands = [h("04-b", "06-a"), h("02-b", "04-b"), h("05-a", "05-b")];
    expect(doriWinners(hands)).toEqual([2]);
  });

  it("4인 — 알리 / 갑오 / 땡잡이 / 6땡 → 땡잡이가 6땡을 잡는다", () => {
    const hands = [h("01-normal", "02-a"), h("04-b", "05-a"), h("03-gwang", "07-a"), h("06-a", "06-b")];
    expect(doriWinners(hands)).toEqual([2]);
  });

  it("땡잡이는 잡을 땡이 없으면 망통급", () => {
    const hands = [h("03-gwang", "07-a"), h("01-normal", "02-a")];
    expect(doriWinners(hands)).toEqual([1]);
  });

  it("암행어사는 18/13광땡만 잡고 38광땡에는 진다", () => {
    expect(doriWinners([h("04-a", "07-a"), h("01-gwang", "08-gwang")])).toEqual([0]);
    expect(doriWinners([h("04-a", "07-a"), h("03-gwang", "08-gwang")])).toEqual([1]);
  });

  it("구사 / 멍텅구리구사 — 재경기 조건 미달이면 3끗", () => {
    // 상대 장땡(910) → 구사·멍구사 모두 조건 미달
    expect(doriEffectiveRanks([h("04-b", "09-b"), h("10-a", "10-b")])[0]).toBe(1030);
    expect(doriEffectiveRanks([h("04-a", "09-a"), h("10-a", "10-b")])[0]).toBe(1030);
    // 상대 알리(806) → 구사 조건 성립(서버가 재경기 처리), 멍구사도 성립
    expect(doriEffectiveRanks([h("04-b", "09-b"), h("01-normal", "02-a")])[0]).toBe(8500);
  });

  it("황은 항상 최하위", () => {
    const hwang = doriBestMake(["09-a", "10-a", "09-b", "04-a", "03-gwang"]).hand;
    const ranks = doriEffectiveRanks([hwang, h("02-b", "08-normal")]);
    expect(ranks[0]!).toBeLessThan(ranks[1]!);
  });
});
