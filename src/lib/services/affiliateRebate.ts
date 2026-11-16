/**
 * 총판 리베이트 분배 계산 (서버 admin_process_charge / credit_crypto_charge 와 동일 공식).
 * 실제 지급/적립은 서버에서만 수행하며, 이 모듈은 검증·표시용 계산이다.
 */
import { REBATE_RATE_MAX, REBATE_RATE_MIN } from "./affiliateService";

export const CHARGE_FEE_RATE = 0.07;

export interface ChargeSplit {
  /** 회원 실충전 기준액 (93%) */
  memberAmount: number;
  /** 전체 레이크 (7%) */
  feeAmount: number;
  /** 총판 리베이트 */
  affiliateRebate: number;
  /** 회사 수익 = 레이크 - 총판 리베이트 */
  companyAmount: number;
  /** 거래에 snapshot 되는 적용 리베이트율 (%) */
  appliedRebateRate: number;
}

export function isValidRebateRate(rate: number) {
  return Number.isFinite(rate) && rate >= REBATE_RATE_MIN && rate <= REBATE_RATE_MAX;
}

/**
 * @param amount 승인 충전 금액
 * @param rebateRatePercent 총판 코드에 설정된 리베이트율(%). 총판이 없으면 null
 */
export function computeChargeSplit(
  amount: number,
  rebateRatePercent: number | null,
): ChargeSplit {
  const fee = Math.round(amount * CHARGE_FEE_RATE);
  const pct = rebateRatePercent === null ? 0 : rebateRatePercent;
  if (!isValidRebateRate(pct)) throw new Error("INVALID_AFFILIATE_REBATE_RATE");
  const rebate = Math.min(Math.round(amount * (pct / 100)), fee);
  return {
    memberAmount: amount - fee,
    feeAmount: fee,
    affiliateRebate: rebate,
    companyAmount: fee - rebate,
    appliedRebateRate: pct,
  };
}
