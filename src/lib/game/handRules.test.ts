import { describe, expect, it } from "vitest";
import { evaluateSutda2, compareHands } from "./sutda2Rules";
import { evaluateSutda3, comboOptions, bestCombo } from "./sutda3Rules";
import { RANK_ORDER, rankIndex } from "./rankConfig";
import { SUTDA_CARDS, GWANG_IDS } from "@/data/sutdaCards";

const name = (ids: string[]) => evaluateSutda2(ids).name;

describe("카드 데이터", () => {
  it("총 20장, 1~10월 각 2장", () => {
    expect(SUTDA_CARDS).toHaveLength(20);
    for (let m = 1; m <= 10; m++) {
      expect(SUTDA_CARDS.filter((c) => c.month === m)).toHaveLength(2);
    }
  });

  it("광 카드는 정확히 3장 (01-gwang, 03-gwang, 08-gwang)", () => {
    const gwang = SUTDA_CARDS.filter((c) => c.isGwang).map((c) => c.id);
    expect(gwang.sort()).toEqual([...GWANG_IDS].sort());
  });
});

describe("광땡 판정 (isGwang 데이터 기준)", () => {
  it("03-gwang + 08-gwang → 38광땡", () => {
    expect(name(["03-gwang", "08-gwang"])).toBe("38광땡");
  });
  it("01-gwang + 08-gwang → 18광땡", () => {
    expect(name(["01-gwang", "08-gwang"])).toBe("18광땡");
  });
  it("01-gwang + 03-gwang → 13광땡", () => {
    expect(name(["01-gwang", "03-gwang"])).toBe("13광땡");
  });
  it("03-normal + 08-gwang → 광땡 아님", () => {
    expect(evaluateSutda2(["03-normal", "08-gwang"]).category).not.toBe("kwangttaeng");
  });
  it("03-gwang + 08-normal → 광땡 아님", () => {
    expect(evaluateSutda2(["03-gwang", "08-normal"]).category).not.toBe("kwangttaeng");
  });
  it("01-normal + 03-gwang → 광땡 아님", () => {
    expect(evaluateSutda2(["01-normal", "03-gwang"]).category).not.toBe("kwangttaeng");
  });
});

describe("땡", () => {
  const pairs: [string, string, string][] = [
    ["10-a", "10-b", "장땡"],
    ["09-a", "09-b", "9땡"],
    ["08-gwang", "08-normal", "8땡"],
    ["07-a", "07-b", "7땡"],
    ["06-a", "06-b", "6땡"],
    ["05-a", "05-b", "5땡"],
    ["04-a", "04-b", "4땡"],
    ["03-gwang", "03-normal", "3땡"],
    ["02-a", "02-b", "2땡"],
    ["01-gwang", "01-normal", "1땡"],
  ];
  it.each(pairs)("%s + %s → %s", (a: string, b: string, expected: string) => {
    expect(name([a, b])).toBe(expected);
  });
});

describe("특수 족보", () => {
  it("01 + 02 → 알리", () => expect(name(["01-normal", "02-a"])).toBe("알리"));
  it("01 + 04 → 독사", () => expect(name(["01-normal", "04-a"])).toBe("독사"));
  it("01 + 09 → 구삥", () => expect(name(["01-normal", "09-a"])).toBe("구삥"));
  it("01 + 10 → 장삥", () => expect(name(["01-normal", "10-a"])).toBe("장삥"));
  it("10 + 04 → 장사", () => expect(name(["10-a", "04-a"])).toBe("장사"));
  it("06 + 04 → 세륙", () => expect(name(["06-a", "04-a"])).toBe("세륙"));
});

describe("끗 / 갑오 / 망통", () => {
  it("04 + 05 → 갑오", () => expect(name(["04-a", "05-a"])).toBe("갑오"));
  it("03-normal + 05 → 8끗", () => expect(name(["03-normal", "05-a"])).toBe("8끗"));
  it("02 + 05 → 7끗", () => expect(name(["02-a", "05-a"])).toBe("7끗"));
  it("02 + 04 → 6끗", () => expect(name(["02-a", "04-a"])).toBe("6끗"));
  it("02 + 03-normal → 5끗", () => expect(name(["02-a", "03-normal"])).toBe("5끗"));
  it("09 + 05 → 4끗", () => expect(name(["09-a", "05-a"])).toBe("4끗"));
  it("10 + 03-normal → 3끗", () => expect(name(["10-a", "03-normal"])).toBe("3끗"));
  it("10 + 02 → 2끗", () => expect(name(["10-a", "02-a"])).toBe("2끗"));
  it("06 + 05 → 1끗", () => expect(name(["06-a", "05-a"])).toBe("1끗"));
  it("06 + 04-b? 10 + 10? 망통 = 합 0", () =>
    expect(name(["07-a", "03-normal"])).toBe("망통"));
});

describe("우선순위 · 동점", () => {
  it("38광땡 > 장땡 > 알리 > 갑오 > 망통", () => {
    const scores = [
      evaluateSutda2(["03-gwang", "08-gwang"]).score,
      evaluateSutda2(["10-a", "10-b"]).score,
      evaluateSutda2(["01-normal", "02-a"]).score,
      evaluateSutda2(["04-a", "05-a"]).score,
      evaluateSutda2(["07-a", "03-normal"]).score,
    ];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("RANK_ORDER 인덱스가 실제 점수 순서와 일치", () => {
    const codes = ["kwang38", "ttaeng10", "ali", "kkeut9", "kkeut0"];
    const idx = codes.map((c) => rankIndex(c));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(RANK_ORDER).toHaveLength(29);
  });

  it("동일 족보는 무승부(승자 복수)", () => {
    const a = evaluateSutda2(["04-a", "05-a"]);
    const b = evaluateSutda2(["04-b", "05-b"]);
    expect(compareHands([a, b])).toEqual([0, 1]);
  });
});

describe("3장 섯다", () => {
  it("3장 중 최고 2장 조합을 사용", () => {
    const hand = evaluateSutda3(["03-gwang", "08-gwang", "05-a"]);
    expect(hand.name).toBe("38광땡");
    expect(hand.usedCards.sort()).toEqual(["03-gwang", "08-gwang"]);
  });

  it("조합 선택지는 3가지", () => {
    const options = comboOptions(["01-gwang", "03-gwang", "10-a"]);
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.hand.name)).toContain("13광땡");
  });

  it("bestCombo는 최고 족보 조합", () => {
    expect(bestCombo(["01-gwang", "03-gwang", "10-a"])?.sort()).toEqual([
      "01-gwang",
      "03-gwang",
    ]);
  });

  it("삼땡은 광땡보다 강하다", () => {
    const sam = evaluateSutda3(["08-gwang", "08-normal", "08-gwang"]);
    expect(sam.score).toBeGreaterThan(evaluateSutda2(["03-gwang", "08-gwang"]).score);
  });
});
