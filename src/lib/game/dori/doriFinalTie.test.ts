/**
 * DORI FINAL TIE COMPARATOR FIX 회귀 테스트.
 *
 * 규칙: 1차 남은 2장 승부패 족보 → 2차(족보가 완전히 동일할 때만) 짓기 합계 30 > 20 > 10.
 * 서버 public.dori_settle_round 의 effective_rank 계산과 동일한 미러를 검증한다.
 */
import { describe, expect, it } from "vitest";
import {
  DORI_HWANG,
  doriEffectiveRanks,
  doriWinners,
  evaluateDoriPairCards,
  type DoriFinalHand,
} from "./doriRules";

/** 승부패 2장 + 짓기 합계 */
function p(c1: string, c2: string, makeTotal: number): DoriFinalHand {
  return { ...evaluateDoriPairCards(c1, c2), makeTotal };
}

const GAPO = ["04-b", "05-a"] as const; // 갑오
const GGUT2 = ["02-b", "10-b"] as const; // 두끗
const GGUT8 = ["03-normal", "05-b"] as const; // 8끗
const SERYUK = ["04-b", "06-a"] as const; // 세륙
const DDAENG6 = ["06-a", "06-b"] as const; // 6땡

function gapo(total: number) {
  return p(GAPO[0], GAPO[1], total);
}
function ggut2(total: number) {
  return p(GGUT2[0], GGUT2[1], total);
}

describe("도리 최종 비교 — 족보 우선 · 동일 족보만 짓기 합계", () => {
  it("fixture 족보 라벨 확인", () => {
    expect(gapo(10).code).toBe("GGUT_9");
    expect(ggut2(10).code).toBe("GGUT_2");
    expect(p(GGUT8[0], GGUT8[1], 10).code).toBe("GGUT_8");
    expect(p(SERYUK[0], SERYUK[1], 10).code).toBe("SERYUK");
    expect(p(DDAENG6[0], DDAENG6[1], 10).code).toBe("DDAENG_6");
  });

  it("CASE A — 10 갑오 vs 20 갑오 → 20 승, 재경기 0", () => {
    expect(doriWinners([gapo(10), gapo(20)])).toEqual([1]);
  });

  it("CASE B — 20 갑오 vs 30 갑오 → 30 승", () => {
    expect(doriWinners([gapo(20), gapo(30)])).toEqual([1]);
  });

  it("CASE C — 10 갑오 vs 10 갑오 → 동점(재경기 후보 2명)", () => {
    expect(doriWinners([gapo(10), gapo(10)])).toEqual([0, 1]);
  });

  it("CASE D — 10 두끗 vs 20 두끗 → 20 승", () => {
    expect(doriWinners([ggut2(10), ggut2(20)])).toEqual([1]);
  });

  it("CASE E — 30 두끗 vs 10 갑오 → 갑오 승 (짓기 합계가 족보를 뒤집지 못함)", () => {
    expect(doriWinners([ggut2(30), gapo(10)])).toEqual([1]);
    const [a, b] = doriEffectiveRanks([ggut2(30), gapo(10)]);
    expect(a!).toBeLessThan(b!);
  });

  it("CASE E2 — 30 8끗 vs 10 세륙 → 세륙 승", () => {
    expect(doriWinners([p(GGUT8[0], GGUT8[1], 30), p(SERYUK[0], SERYUK[1], 10)])).toEqual([1]);
  });

  it("CASE F — 3인 10 갑오 / 20 갑오 / 30 두끗 → 20 갑오 단독 승", () => {
    expect(doriWinners([gapo(10), gapo(20), ggut2(30)])).toEqual([1]);
  });

  it("CASE G — 3인 20 갑오 / 20 갑오 / 30 두끗 → 갑오 2명만 동점 후보 (두끗 제외)", () => {
    expect(doriWinners([gapo(20), gapo(20), ggut2(30)])).toEqual([0, 1]);
  });

  it("CASE H — 4인 서로 다른 족보/짓기 → 최고 족보 단독 승", () => {
    const hands = [
      p(DDAENG6[0], DDAENG6[1], 10), // 6땡
      p(SERYUK[0], SERYUK[1], 30), // 세륙
      gapo(30),
      ggut2(20),
    ];
    expect(doriWinners(hands)).toEqual([0]);
  });

  it("CASE H2 — 4인 동일 족보 혼합 → 최고 make_total 단독 승", () => {
    expect(doriWinners([gapo(10), gapo(30), gapo(20), ggut2(30)])).toEqual([1]);
  });

  it("황은 짓기 합계가 없으므로 항상 최하위", () => {
    const ranks = doriEffectiveRanks([{ ...DORI_HWANG }, ggut2(10)]);
    expect(ranks[0]).toBe(0);
    expect(doriWinners([{ ...DORI_HWANG }, ggut2(10)])).toEqual([1]);
    expect(doriWinners([{ ...DORI_HWANG }, { ...DORI_HWANG }])).toEqual([0, 1]);
  });

  it("구사 특수 재경기 조건은 짓기 합계보다 우선한다", () => {
    // 구사(04-b + 09-b) vs 알리 — 조건 성립 → 동일 취급(재경기 판정은 서버 특수룰)
    const gusa = p("04-b", "09-b", 10);
    const ali = p("01-normal", "02-a", 30);
    expect(gusa.code).toBe("GUSA");
    expect(ali.code).toBe("ALI");
    // 조건 미달(장땡 상대) 구사는 3끗 처리 + 짓기 보너스만 반영
    expect(doriEffectiveRanks([p("04-b", "09-b", 20), p("10-a", "10-b", 10)])[0]).toBe(1032);
  });

  it("조건부 상성(땡잡이/암행어사)에도 짓기 합계 tie-break만 추가된다", () => {
    const tj = p("03-gwang", "07-a", 20);
    expect(tj.code).toBe("TTAENGJABI");
    expect(doriEffectiveRanks([tj, p(DDAENG6[0], DDAENG6[1], 30)])[0]).toBe(9097);
    const amh = p("04-a", "07-a", 10);
    expect(amh.code).toBe("AMHAENG");
    expect(doriEffectiveRanks([amh, p("01-gwang", "08-gwang", 10)])[0]).toBe(9956);
  });
});
