import { describe, expect, it } from "vitest";
import { effectiveScores, gusaRematchRequired, type GusaEntry } from "./gusaRematch";

const gusa: GusaEntry = { code: "gusa", score: 850 };
const meong: GusaEntry = { code: "gusa_meongteong", score: 850 };
const ttaeng10: GusaEntry = { code: "ttaeng10", score: 910 };
const ttaeng9: GusaEntry = { code: "ttaeng9", score: 909 };
const ali: GusaEntry = { code: "ali", score: 806 };
const gapo: GusaEntry = { code: "kkeut9", score: 109 };
const kwang38: GusaEntry = { code: "kwang38", score: 1000 };
const kwang18: GusaEntry = { code: "kwang18", score: 990 };
const kwang13: GusaEntry = { code: "kwang13", score: 980 };

const winnerIndex = (hands: GusaEntry[]) => {
  const eff = effectiveScores(hands);
  return eff.indexOf(Math.max(...eff));
};

describe("구사 재경기 조건 (bugfix regression)", () => {
  it("구사 vs 장땡 → 재경기 없음, 장땡 승리", () => {
    const hands = [gusa, ttaeng10];
    expect(gusaRematchRequired(hands)).toBe(false);
    expect(winnerIndex(hands)).toBe(1);
  });

  it("구사 vs 9땡 → 재경기 없음, 9땡 승리", () => {
    const hands = [gusa, ttaeng9];
    expect(gusaRematchRequired(hands)).toBe(false);
    expect(winnerIndex(hands)).toBe(1);
  });

  it("구사 vs 알리 → 재경기", () => {
    expect(gusaRematchRequired([gusa, ali])).toBe(true);
  });

  it("구사 vs 갑오 → 재경기", () => {
    expect(gusaRematchRequired([gusa, gapo])).toBe(true);
  });

  it("멍구사 vs 9땡 → 재경기", () => {
    expect(gusaRematchRequired([meong, ttaeng9])).toBe(true);
  });

  it("멍구사 vs 장땡 → 재경기 없음, 장땡 승리", () => {
    const hands = [meong, ttaeng10];
    expect(gusaRematchRequired(hands)).toBe(false);
    expect(winnerIndex(hands)).toBe(1);
  });

  it("광땡(38/18/13) 존재 시 구사·멍구사 재경기 없음", () => {
    for (const kwang of [kwang38, kwang18, kwang13]) {
      expect(gusaRematchRequired([gusa, kwang])).toBe(false);
      expect(gusaRematchRequired([meong, kwang])).toBe(false);
      expect(winnerIndex([gusa, kwang])).toBe(1);
    }
  });

  it("구사끼리만 남으면 재경기", () => {
    expect(gusaRematchRequired([gusa, gusa])).toBe(true);
  });
});
