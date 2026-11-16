import { supabase } from "@/integrations/supabase/client";

/** 총판 대시보드 요약 — 서버 RPC(affiliate_overview)가 권한을 검증한다 */
export interface AffiliateTotals {
  members: number;
  membersWeek: number;
  commissionTotal: number;
  commissionCount: number;
  baseTotal: number;
  pending: number;
  settled: number;
  day1: number;
  day7: number;
  day30: number;
}

export interface AffiliateMemberRow {
  userId: string;
  username: string | null;
  nickname: string | null;
  level: number | null;
  rank: string | null;
  points: number | null;
  status: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
  chargeAmount: number;
  chargeCount: number;
  commissionAmount: number;
  commissionPending: number;
  lastChargeAt: string | null;
}

export interface AffiliateCommissionRow {
  id: string;
  createdAt: string;
  memberUserId: string;
  username: string | null;
  nickname: string | null;
  baseAmount: number;
  rate: number;
  amount: number;
  status: string;
  settledAt: string | null;
}

export interface AffiliateActivityRow {
  at: string;
  type: "JOIN" | "COMMISSION";
  nickname: string;
  username: string | null;
  amount: number;
  baseAmount?: number;
  status?: string;
}

export interface AffiliateInfo {
  id: string;
  userId: string;
  code: string;
  status: string;
  memo: string | null;
  createdAt: string;
  /** 현재 설정된 리베이트율 (퍼센트) */
  rebateRate: number | null;
  nickname: string | null;
  username: string | null;
}

export interface AffiliateOverview {
  affiliate: AffiliateInfo | null;
  totals?: AffiliateTotals;
  members?: AffiliateMemberRow[];
  commissions?: AffiliateCommissionRow[];
  activity?: AffiliateActivityRow[];
}

export const EMPTY_TOTALS: AffiliateTotals = {
  members: 0,
  membersWeek: 0,
  commissionTotal: 0,
  commissionCount: 0,
  baseTotal: 0,
  pending: 0,
  settled: 0,
  day1: 0,
  day7: 0,
  day30: 0,
};

/** 총판 본인(_affiliateId 생략) 또는 관리자(특정 총판) 대시보드 조회 */
export async function fetchAffiliateOverview(
  affiliateId?: string | null,
): Promise<AffiliateOverview> {
  const { data, error } = await supabase.rpc("affiliate_overview", {
    ...(affiliateId ? { _affiliate_id: affiliateId } : {}),
  });
  if (error) throw error;
  return (data ?? { affiliate: null }) as unknown as AffiliateOverview;
}

export interface AdminAffiliateRow {
  id: string;
  userId: string;
  code: string;
  status: string;
  memo: string | null;
  createdAt: string;
  /** 현재 설정된 리베이트율 (퍼센트) */
  rebateRate: number | null;
  username: string | null;
  nickname: string | null;
  members: number;
  membersWeek: number;
  baseTotal: number;
  commissionTotal: number;
  pending: number;
  settled: number;
  day7: number;
  lastCommissionAt: string | null;
}

/** 관리자 총판 목록 (서버에서 관리자 권한 검증) */
export async function fetchAdminAffiliates(): Promise<AdminAffiliateRow[]> {
  const { data, error } = await supabase.rpc("admin_list_affiliates");
  if (error) throw error;
  return (data ?? []) as unknown as AdminAffiliateRow[];
}

/** 총판 리베이트율 정책 상수 — 서버(0~7%)와 동일 기준 */
export const REBATE_RATE_MIN = 0;
export const REBATE_RATE_MAX = 7;
export const REBATE_RATE_DEFAULT = 2;

export function formatRebateRate(rate: number | null | undefined) {
  return `${Number(rate ?? REBATE_RATE_DEFAULT).toFixed(2)}%`;
}

/**
 * 총판 코드별 리베이트율 변경 (관리자/최고관리자 전용, 서버에서 권한·범위 재검증).
 * 변경은 이후 승인되는 신규 충전에만 적용되며 과거 내역은 소급 변경되지 않는다.
 */
export async function setAffiliateRebateRate(input: {
  affiliateId: string;
  rate: number;
  reason: string;
}) {
  if (!Number.isFinite(input.rate) || input.rate < REBATE_RATE_MIN || input.rate > REBATE_RATE_MAX) {
    throw new Error(`리베이트율은 ${REBATE_RATE_MIN}% ~ ${REBATE_RATE_MAX}% 사이만 가능합니다.`);
  }
  const { error } = await supabase.rpc("admin_set_affiliate_rebate_rate", {
    _affiliate_id: input.affiliateId,
    _rate: Math.round(input.rate * 100) / 100,
    _reason: input.reason,
  });
  if (error) throw error;
}

/** 추천 링크 — 가입 페이지에 총판 코드를 붙인다 */
export function referralLink(code: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/auth?code=${encodeURIComponent(code)}`;
}
