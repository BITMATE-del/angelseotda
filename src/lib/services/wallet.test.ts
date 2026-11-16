import { describe, expect, it } from "vitest";
import { calcChargeBreakdown, calcUsdtPayout, calcWithdrawBreakdown, isValidUsdtAddress, normalizeUsdtAddress } from "./walletService";

const FEE = 0.07;
const AFFILIATE = 0.02;
const RATE = 1; // 1원 = 1P

describe("충전 수수료 (7% — 충전에만 적용)", () => {
  it("100,000원: 사용자 93,000원 기준 / 수수료 7,000원", () => {
    const b = calcChargeBreakdown(100000, RATE, FEE);
    expect(b.fee).toBe(7000);
    expect(b.base).toBe(93000);
    expect(b.points).toBe(93000);
  });

  it("총판 회원 분배: 총판 2,000 + 운영 5,000 + 사용자 93,000 = 100,000 (정수, 오차 없음)", () => {
    const amount = 100000;
    const b = calcChargeBreakdown(amount, RATE, FEE);
    const affiliate = Math.round(amount * AFFILIATE);
    const company = b.fee - affiliate;
    expect(affiliate).toBe(2000);
    expect(company).toBe(5000);
    expect(b.base + affiliate + company).toBe(amount);
  });

  it("일반 회원: 운영 수수료 7% 전액, 총판 0", () => {
    const amount = 100000;
    const b = calcChargeBreakdown(amount, RATE, FEE);
    const affiliate = 0;
    expect(b.fee - affiliate).toBe(7000);
    expect(b.base + b.fee).toBe(amount);
  });

  it("임의 금액에서도 합계가 원금과 정확히 일치", () => {
    for (const amount of [10000, 33333, 57777, 1234567, 5000000]) {
      const b = calcChargeBreakdown(amount, RATE, FEE);
      const affiliate = Math.round(amount * AFFILIATE);
      expect(b.base + affiliate + (b.fee - affiliate)).toBe(amount);
      expect(Number.isInteger(b.fee)).toBe(true);
      expect(Number.isInteger(b.points)).toBe(true);
    }
  });
});

describe("출금 수수료 (0% — 충전 로직 재사용 금지)", () => {
  it("100,000P 출금 신청 → 100,000P 지급 기준", () => {
    const w = calcWithdrawBreakdown(100000, RATE);
    expect(w.payoutPoints).toBe(100000);
    expect(w.payoutWon).toBe(100000);
  });

  it("어떤 금액에서도 7%가 차감되지 않는다", () => {
    for (const p of [10000, 30000, 100000, 999999]) {
      const w = calcWithdrawBreakdown(p, RATE);
      expect(w.payoutPoints).toBe(p);
      expect(w.payoutPoints).not.toBe(Math.round(p * 0.93));
    }
  });
});

describe("USDT 출금 주소 검증 (TRC20)", () => {
  it("정상 TRC20 주소는 통과", () => {
    expect(isValidUsdtAddress("TTLBdjooKRinMZZ4x9KG8bYhJxCGe1MPBr")).toBe(true);
  });

  it("앞뒤/중간 공백은 제거 후 판정·복사된다", () => {
    expect(normalizeUsdtAddress("  TTLBdjooKRinMZZ4x9KG8bYh JxCGe1MPBr \n")).toBe(
      "TTLBdjooKRinMZZ4x9KG8bYhJxCGe1MPBr",
    );
    expect(isValidUsdtAddress(" TTLBdjooKRinMZZ4x9KG8bYhJxCGe1MPBr ")).toBe(true);
  });

  it("잘못된 형식은 거부 (T 미시작 / 길이 불일치 / 이더리움 주소 / 빈 값)", () => {
    expect(isValidUsdtAddress("XTLBdjooKRinMZZ4x9KG8bYhJxCGe1MPBr")).toBe(false);
    expect(isValidUsdtAddress("TTLBdjooKRinMZZ4x9KG8bYhJxCGe1MPB")).toBe(false);
    expect(isValidUsdtAddress("0x2170Ed0880ac9A755fd29B2688956BD959F933F8")).toBe(false);
    expect(isValidUsdtAddress("")).toBe(false);
  });

  it("예상 수령 USDT = 원화 환산액 / 환율, 환율 없으면 null", () => {
    expect(calcUsdtPayout(1_363_900, 1, 1363.9)).toBeCloseTo(1000, 6);
    expect(calcUsdtPayout(100000, 1, null)).toBeNull();
  });
});
