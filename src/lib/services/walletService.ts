import { supabase } from "@/integrations/supabase/client";

export interface AppSettings {
  points_per_won: number;
  charge_min_amount: number;
  charge_max_amount: number;
  withdraw_min_points: number;
  withdraw_max_points: number;
  withdraw_daily_limit_points: number;
  charge_enabled: boolean;
  withdraw_enabled: boolean;
  charge_notice: string;
  withdraw_notice: string;
  /** 충전에만 적용되는 수수료율 (출금에는 절대 적용하지 않음) */
  charge_fee_rate: number;
  /** 충전 수수료 중 총판에게 배분되는 비율 */
  affiliate_commission_rate: number;
}

const DEFAULTS: AppSettings = {
  points_per_won: 1,
  charge_min_amount: 10000,
  charge_max_amount: 5000000,
  withdraw_min_points: 10000,
  withdraw_max_points: 5000000,
  withdraw_daily_limit_points: 10000000,
  charge_enabled: true,
  withdraw_enabled: true,
  charge_notice: "",
  withdraw_notice: "",
  charge_fee_rate: 0.07,
  affiliate_commission_rate: 0.02,
};

/** 충전 수수료 계산 — 충전 전용. 출금 계산에 재사용 금지. */
export function calcChargeBreakdown(amount: number, rate: number, feeRate: number) {
  const fee = Math.round(amount * feeRate);
  const base = amount - fee;
  return { fee, base, points: Math.floor(base * rate) };
}

/** 출금 계산 — 수수료 없음. 신청 포인트가 곧 지급 기준 포인트. */
export function calcWithdrawBreakdown(points: number, rate: number) {
  return { payoutPoints: points, payoutWon: rate > 0 ? points / rate : 0 };
}

/* ── USDT 출금 (출금은 USDT(TRC20) 전용) ──────────────────────────── */

/** 프로젝트가 사용하는 유일한 출금 네트워크 */
export const WITHDRAW_NETWORK = "TRC20";
export const WITHDRAW_ASSET = "USDT";
/** 출금 수수료 0% (충전 수수료와 절대 공유하지 않는다) */
export const WITHDRAW_FEE_RATE = 0;

/** Tron(TRC20) 주소 형식 — 서버(is_valid_tron_address)와 동일 규칙 */
const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** 입력 주소 정규화 — 공백/개행 제거 (부분 복사·붙여넣기 사고 방지) */
export function normalizeUsdtAddress(address: string) {
  return address.replace(/\s+/g, "");
}

export function isValidUsdtAddress(address: string) {
  return TRON_ADDRESS_RE.test(normalizeUsdtAddress(address));
}

/** 예상 수령 USDT — 원화 환산액 / (원/USDT) */
export function calcUsdtPayout(points: number, pointsPerWon: number, krwPerUsdt: number | null) {
  const won = pointsPerWon > 0 ? points / pointsPerWon : 0;
  if (!krwPerUsdt || krwPerUsdt <= 0) return null;
  return won / krwPerUsdt;
}

export function formatUsdt(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return "-";
  return `${amount.toLocaleString("ko-KR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} USDT`;
}


export async function fetchSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from("app_settings").select("key, value");
  if (error) throw error;
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const row of data ?? []) out[row.key] = row.value;
  return out as unknown as AppSettings;
}

export async function updateSetting(key: string, value: unknown) {
  const { error } = await supabase
    .from("app_settings")
    .update({ value: value as never, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) throw error;
}

/**
 * 충전 신청 (즉시 지급 없음, 관리자 승인 필요).
 * 예상 지급 포인트/면제권 예약은 서버 RPC가 계산·검증한다.
 */
export async function requestCharge(input: {
  userId: string;
  amount: number;
  rate: number;
  feeRate: number;
  depositorName: string;
  note?: string;
  useRakeFreeTicket?: boolean;
}) {
  const { error } = await supabase.rpc("request_charge_with_ticket", {
    _amount: input.amount,
    _depositor_name: input.depositorName,
    _use_ticket: !!input.useRakeFreeTicket,
    ...(input.note ? { _note: input.note } : {}),
  });
  if (error) throw error;
}

/** 대기 중인 내 충전 신청 취소 (면제권 예약 자동 반환) */
export async function cancelChargeRequest(requestId: string) {
  const { error } = await supabase.rpc("cancel_my_charge_request", { _request_id: requestId });
  if (error) throw error;
}


/**
 * USDT(TRC20) 출금 신청 — 포인트 잠금과 주소 검증/스냅샷은 서버 RPC 전용.
 * 신청 당시 주소는 서버가 payout_details 에 snapshot 으로 저장한다.
 */
export async function requestUsdtWithdrawal(input: {
  points: number;
  address: string;
  saveAsDefault?: boolean;
  note?: string;
}) {
  const address = normalizeUsdtAddress(input.address);
  if (!isValidUsdtAddress(address)) throw new Error("USDT(TRC20) 주소 형식을 확인해 주세요.");
  const { error } = await supabase.rpc("request_withdrawal", {
    _points: input.points,
    _method: "usdt_trc20",
    _details: {
      address,
      network: WITHDRAW_NETWORK,
      asset: WITHDRAW_ASSET,
      save_default: !!input.saveAsDefault,
    },
    ...(input.note ? { _note: input.note } : {}),
  });
  if (error) throw error;
}

export async function processCharge(requestId: string, status: string, adminNote?: string) {
  const { error } = await supabase.rpc("admin_process_charge", {
    _request_id: requestId,
    _status: status,
    ...(adminNote ? { _admin_note: adminNote } : {}),
  });
  if (error) throw error;
}

export async function processWithdrawal(requestId: string, status: string, adminNote?: string) {
  const { error } = await supabase.rpc("admin_process_withdrawal", {
    _request_id: requestId,
    _status: status,
    ...(adminNote ? { _admin_note: adminNote } : {}),
  });
  if (error) throw error;
}

export async function adjustPoints(userId: string, amount: number, memo?: string) {
  const { error } = await supabase.rpc("admin_adjust_points", {
    _user_id: userId,
    _amount: amount,
    ...(memo ? { _memo: memo } : {}),
  });
  if (error) throw error;
}

export async function fetchTransactions(userId: string, limit = 30) {
  const { data, error } = await supabase
    .from("point_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export const WITHDRAW_STATUS_LABEL: Record<string, string> = {
  REQUESTED: "신청",
  REVIEWING: "확인중",
  APPROVED: "승인",
  PAID: "지급완료",
  REJECTED: "반려",
  CANCELLED: "취소",
};

export function pointsToWon(points: number, pointsPerWon: number) {
  return pointsPerWon > 0 ? points / pointsPerWon : 0;
}

export function formatPoints(points: number | null | undefined) {
  return `${(points ?? 0).toLocaleString("ko-KR")} P`;
}

export function formatWon(won: number) {
  return `${Math.floor(won).toLocaleString("ko-KR")}원`;
}

/* ── 관리자 출금 목록 (USDT 주소 포함, 서버에서 권한 검증) ────────── */

export interface AdminWithdrawalRow {
  id: string;
  user_id: string;
  nickname: string | null;
  username: string | null;
  requested_at: string;
  processed_at: string | null;
  requested_points: number;
  payout_amount: number;
  conversion_rate: number;
  payout_method: string;
  address: string | null;
  network: string | null;
  krw_per_usdt: number | null;
  expected_usdt: number | null;
  status: string;
  user_note: string | null;
  admin_note: string | null;
}

export async function fetchAdminWithdrawals(limit = 100): Promise<AdminWithdrawalRow[]> {
  const { data, error } = await supabase.rpc("admin_list_withdrawals", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminWithdrawalRow[];
}
