import { describe, expect, it } from "vitest";
import { computeChargeSplit, isValidRebateRate } from "./affiliateRebate";

describe("총판 코드별 리베이트율", () => {
  it("A. 기본 2% — 회원 93,000 / 총판 2,000 / 회사 5,000", () => {
    const s = computeChargeSplit(100_000, 2);
    expect(s.memberAmount).toBe(93_000);
    expect(s.affiliateRebate).toBe(2_000);
    expect(s.companyAmount).toBe(5_000);
    expect(s.appliedRebateRate).toBe(2);
  });

  it("B. 3% — 총판 3,000 / 회사 4,000", () => {
    const s = computeChargeSplit(100_000, 3);
    expect(s.memberAmount).toBe(93_000);
    expect(s.affiliateRebate).toBe(3_000);
    expect(s.companyAmount).toBe(4_000);
  });

  it("C. 1.5% — 총판 1,500 / 회사 5,500", () => {
    const s = computeChargeSplit(100_000, 1.5);
    expect(s.affiliateRebate).toBe(1_500);
    expect(s.companyAmount).toBe(5_500);
  });

  it("D. 0% — 총판 0 / 회사 7,000 (추천관계는 유지)", () => {
    const s = computeChargeSplit(100_000, 0);
    expect(s.affiliateRebate).toBe(0);
    expect(s.companyAmount).toBe(7_000);
  });

  it("E. 율 변경은 신규 거래에만 적용되고 과거 snapshot은 보존", () => {
    const first = computeChargeSplit(100_000, 2);
    const second = computeChargeSplit(100_000, 3);
    expect(first.affiliateRebate).toBe(2_000);
    expect(first.appliedRebateRate).toBe(2);
    expect(second.affiliateRebate).toBe(3_000);
    expect(second.appliedRebateRate).toBe(3);
  });

  it("F. 7% 초과는 거부", () => {
    expect(isValidRebateRate(7)).toBe(true);
    expect(isValidRebateRate(7.01)).toBe(false);
    expect(isValidRebateRate(-1)).toBe(false);
    expect(() => computeChargeSplit(100_000, 7.5)).toThrow("INVALID_AFFILIATE_REBATE_RATE");
  });

  it("G. 총판 없는 일반회원 — 총판 0 / 회사 7%", () => {
    const s = computeChargeSplit(100_000, null);
    expect(s.memberAmount).toBe(93_000);
    expect(s.affiliateRebate).toBe(0);
    expect(s.companyAmount).toBe(7_000);
  });

  it("소수점 0.01% 단위 지원", () => {
    expect(computeChargeSplit(100_000, 2.35).affiliateRebate).toBe(2_350);
    expect(computeChargeSplit(100_000, 0.5).affiliateRebate).toBe(500);
  });

  it("리베이트는 전체 레이크(7%)를 초과하지 않는다", () => {
    const s = computeChargeSplit(100_000, 7);
    expect(s.affiliateRebate).toBe(7_000);
    expect(s.companyAmount).toBe(0);
  });
});
