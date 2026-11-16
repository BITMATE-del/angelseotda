import { describe, expect, it } from "vitest";
import { contextualScores, evaluateSutda2 } from "./sutda2Rules";
import { resolveShowdown } from "./handEvaluator";
import { evaluateDoriPair, evaluateDoriPairCards } from "./dori/doriRules";
import { rematchReasonLabel, gusaRematchRequired } from "./gusaRematch";
import { SPECIAL_CARD_PAIRS, isSpecialPair } from "./specialCards";

describe("특수족보 — 지정 카드 조합만 인정 (서버 evaluate_sutda_hand 미러)", () => {
  it("암행어사는 04-a + 07-a 만", () => {
    expect(evaluateSutda2(["04-a", "07-a"]).code).toBe("amhaeng");
    expect(evaluateSutda2(["04-b", "07-a"]).code).not.toBe("amhaeng");
    expect(evaluateSutda2(["04-a", "07-b"]).code).not.toBe("amhaeng");
  });

  it("땡잡이는 03-gwang + 07-a 만", () => {
    const h = evaluateSutda2(["03-gwang", "07-a"]);
    expect(h.code).toBe("ttaengjabi");
    expect(h.name).toBe("땡잡이");
    expect(evaluateSutda2(["03-gwang", "07-b"]).code).not.toBe("ttaengjabi");
    expect(evaluateSutda2(["03-normal", "07-a"]).code).not.toBe("ttaengjabi");
  });

  it("멍텅구리구사(04-a+09-a)와 일반 구사를 코드·라벨로 구분", () => {
    const mung = evaluateSutda2(["04-a", "09-a"]);
    expect(mung.code).toBe("gusa_meongteong");
    expect(mung.name).toBe("멍텅구리구사");
    const gusa = evaluateSutda2(["04-b", "09-a"]);
    expect(gusa.code).toBe("gusa");
    expect(gusa.name).toBe("구사");
    expect(evaluateSutda2(["04-a", "09-b"]).code).toBe("gusa");
    expect(mung.category).toBe("gusa");
    expect(mung.score).toBe(gusa.score);
  });

  it("기존 정상 족보 순위는 그대로", () => {
    expect(evaluateSutda2(["03-gwang", "08-gwang"]).code).toBe("kwang38");
    expect(evaluateSutda2(["10-a", "10-b"]).name).toBe("장땡");
    expect(evaluateSutda2(["01-normal", "02-a"]).code).toBe("ali");
    expect(evaluateSutda2(["04-a", "06-a"]).code).toBe("seryuk");
  });

  it("재경기 조건은 구사 계열별로 다르다", () => {
    // 상대 최고가 9땡(909): 일반 구사는 재경기 불가, 멍텅구리구사는 재경기
    expect(gusaRematchRequired([{ code: "gusa", score: 850 }, { code: "ttaeng9", score: 909 }])).toBe(
      false,
    );
    expect(
      gusaRematchRequired([{ code: "gusa_meongteong", score: 850 }, { code: "ttaeng9", score: 909 }]),
    ).toBe(true);
    // 상대 최고가 알리(806) 이하면 둘 다 재경기
    expect(gusaRematchRequired([{ code: "gusa", score: 850 }, { code: "ali", score: 806 }])).toBe(true);
  });

  it("재경기 사유 라벨", () => {
    expect(rematchReasonLabel("GUSA")).toBe("구사");
    expect(rematchReasonLabel("GUSA_MEONGTEONG")).toBe("멍텅구리구사");
    expect(rematchReasonLabel("DRAW")).toBe("무승부");
    expect(rematchReasonLabel(null)).toBe("무승부");
  });
});

describe("도리짓고땡 특수족보 (서버 dori_special_hand 미러)", () => {
  it("땡잡이 / 구사 / 멍텅구리구사를 카드 identity로 판정", () => {
    expect(evaluateDoriPairCards("03-gwang", "07-a")).toMatchObject({
      code: "TTAENGJABI",
      label: "땡잡이",
      rank: 100,
    });
    expect(evaluateDoriPairCards("04-a", "09-a")).toMatchObject({
      code: "MUNG_GUSA",
      label: "멍텅구리구사",
      type: "GUSA",
    });
    expect(evaluateDoriPairCards("04-b", "09-b")).toMatchObject({ code: "GUSA", label: "구사" });
  });

  it("지정 조합이 아니면 기존 월 기반 족보를 유지", () => {
    expect(evaluateDoriPairCards("03-gwang", "07-b").code).toBe("GGUT_0");
    expect(evaluateDoriPairCards("05-a", "05-b")).toEqual(evaluateDoriPair(5, 5));
    expect(evaluateDoriPairCards("10-a", "10-b").label).toBe("장땡");
  });

  it("지정 카드 상수는 서버 기본값과 동일", () => {
    expect(SPECIAL_CARD_PAIRS.amhaeng).toEqual(["04-a", "07-a"]);
    expect(SPECIAL_CARD_PAIRS.ttaengjabi).toEqual(["03-gwang", "07-a"]);
    expect(SPECIAL_CARD_PAIRS.gusa_meongteong).toEqual(["04-a", "09-a"]);
    expect(isSpecialPair("09-a", "04-a", "gusa_meongteong")).toBe(true);
  });
});

describe("특수 상성 comparator (서버 apply_contextual_rules 미러)", () => {
  const winner = (a: string[], b: string[]) =>
    resolveShowdown("sutda2", [a, b]).winners;

  it("땡잡이는 1~9땡만 잡는다", () => {
    expect(winner(["03-gwang", "07-a"], ["05-a", "05-b"])).toEqual([0]);
    expect(winner(["03-gwang", "07-a"], ["09-a", "09-b"])).toEqual([0]);
    expect(winner(["01-gwang", "01-normal"], ["03-gwang", "07-a"])).toEqual([1]);
  });

  it("땡잡이는 장땡·광땡·일반 상위 족보를 잡지 못한다", () => {
    expect(winner(["03-gwang", "07-a"], ["10-a", "10-b"])).toEqual([1]);
    expect(winner(["03-gwang", "07-a"], ["03-gwang", "08-gwang"])).toEqual([1]);
    expect(winner(["03-gwang", "07-a"], ["01-normal", "02-a"])).toEqual([1]);
    expect(winner(["10-a", "10-b"], ["03-gwang", "07-a"])).toEqual([0]);
  });

  it("암행어사는 18·13광땡만 잡고 38광땡에는 진다", () => {
    expect(winner(["04-a", "07-a"], ["01-gwang", "08-gwang"])).toEqual([0]);
    expect(winner(["04-a", "07-a"], ["01-gwang", "03-gwang"])).toEqual([0]);
    expect(winner(["01-gwang", "03-gwang"], ["04-a", "07-a"])).toEqual([1]);
    expect(winner(["04-a", "07-a"], ["03-gwang", "08-gwang"])).toEqual([1]);
  });

  it("암행어사는 일반 족보 상대에서 1끗(101)으로만 취급된다", () => {
    expect(winner(["04-a", "07-a"], ["10-a", "10-b"])).toEqual([1]);
    expect(winner(["04-a", "07-a"], ["01-normal", "02-a"])).toEqual([1]);
    // 망통(100) 상대에게는 1끗이 이긴다
    expect(winner(["04-a", "07-a"], ["01-gwang", "09-b"])).toEqual([1]);
    expect(winner(["04-a", "07-a"], ["02-a", "08-normal"])).toEqual([0]);
  });

  it("구사 계열은 재경기 조건 미달 시 3끗으로 비교된다", () => {
    expect(winner(["04-b", "09-a"], ["10-a", "10-b"])).toEqual([1]);
    expect(winner(["04-a", "09-a"], ["10-a", "10-b"])).toEqual([1]);
    expect(contextualScores([evaluateSutda2(["04-b", "09-a"]), evaluateSutda2(["10-a", "10-b"])])).toEqual([
      1030, 9100,
    ]);
  });

  it("3장 섯다는 최종 제출 2장 기준으로 특수 상성이 적용된다", () => {
    expect(resolveShowdown("sutda2", [["03-gwang", "07-a"], ["06-a", "06-b"]]).hands[0]!.code).toBe(
      "ttaengjabi",
    );
  });
});
