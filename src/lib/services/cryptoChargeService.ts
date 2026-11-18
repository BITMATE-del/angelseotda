import { supabase } from "@/integrations/supabase/client";

export const CRYPTO_STATUS_LABEL: Record<string, string> = {
  PENDING: "입금 대기",
  MATCHED: "입금 확인 중",
  CONFIRMING: "블록 승인 대기",
  CREDITING: "지급 처리 중",
  REVIEW: "미매칭 확인중",
  CREDITED: "충전 완료",
  EXPIRED: "시간 만료",
  CANCELLED: "취소",
  ERROR: "오류",
};

/** 관리자 화면 전용 입금 감지 상태 라벨 */
export const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  DETECTED: "감지",
  MATCHED: "자동확인중",
  CREDITED: "지급완료",
  UNMATCHED: "미매칭",
  EXPIRED_MATCH: "만료 후 입금",
  DUPLICATE: "중복",
  CANCELLED: "취소",
};


export interface CryptoChargeRequestRow {
  id: string;
  user_id: string;
  requested_krw: number;
  rate_krw_per_usdt: number;
  expected_usdt: number;
  wallet_address: string;
  status: string;
  txid: string | null;
  credited_points: number | null;
  expires_at: string;
  created_at: string;
  credited_at: string | null;
}

export async function fetchMyCryptoRequests(userId: string) {
  const { data, error } = await supabase
    .from("crypto_charge_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as unknown as CryptoChargeRequestRow[];
}

export async function cancelMyCryptoRequest(id: string) {
  const { data, error } = await supabase.rpc("cancel_my_crypto_charge", { _id: id });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; code?: string };
  if (!res.ok) throw new Error("이미 처리 중인 신청은 취소할 수 없습니다.");
}

/* ---------- 관리자 ---------- */

export interface CryptoOverview {
  enabled: boolean;
  deposit_address: string | null;
  usdt_contract: string | null;
  required_confirmations: string | null;
  ttl_minutes: string | null;
  min_krw: string | null;
  max_krw: string | null;
  sheet_id: string | null;
  sheet_gid: string | null;
  rate_cell: string | null;
  rate_cache: string | null;
  rate_cached_at: string | null;
  rate_error: string | null;
  watcher_last_run: string | null;
  watcher_last_cursor: string | null;
  watcher_last_error: string | null;
  pending: number;
  confirming: number;
  credited_today: number;
  credited_today_krw: number;
  unmatched: number;
  test_mode?: boolean;
  address_ok?: boolean;
  contract_ok?: boolean;
  watcher_last_started_at?: string | null;
  watcher_last_completed_at?: string | null;
  watcher_last_success_at?: string | null;
  watcher_last_error_at?: string | null;
  watcher_lock_status?: string | null;
  watcher_fail_streak?: number;
  watcher_duration_ms?: number;
  watcher_detected_count?: number;
  watcher_matched_count?: number;
  watcher_credited_count?: number;
}

export interface CryptoPreflight extends CryptoOverview {
  tron_ok: boolean;
  tron_block: number | null;
  tron_error: string | null;
  cron_secret_present: boolean;
  trongrid_key_configured: boolean;
  trongrid_auth_ok: boolean;
  trongrid_latency_ms: number | null;
  trongrid_error_kind: string | null;
  trongrid_error_status: number | null;
  trongrid_address_query_ok: boolean;
  scheduler_job_name: string | null;
  scheduler_schedule: string | null;
  scheduler_active: boolean;
  scheduler_runs_total: number;
  scheduler_runs_succeeded: number;
  scheduler_last_run_at: string | null;
  scheduler_last_status: string | null;
  watcher_health: "ONLINE" | "DEGRADED" | "OFFLINE";
  watcher_age_ms: number | null;
}

export interface CryptoFeedRow {
  at: string;
  kind: string;
  amount_usdt: number | null;
  txid: string | null;
  nickname: string | null;
  krw: number | null;
  points: number | null;
}

export async function fetchCryptoFeed(limit = 40) {
  const { data, error } = await supabase.rpc("admin_crypto_feed", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as unknown as CryptoFeedRow[];
}

/** 입금주소 마스킹 — 화면에는 전체 주소를 노출하지 않는다. */
export function maskAddress(addr?: string | null) {
  if (!addr) return "미설정";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export async function fetchCryptoOverview() {
  const { data, error } = await supabase.rpc("admin_crypto_overview");
  if (error) throw error;
  return data as unknown as CryptoOverview;
}

export async function updateCryptoSettings(patch: Record<string, unknown>, reason: string) {
  const { data, error } = await supabase.rpc("admin_update_crypto_settings", {
    _patch: patch as never,
    _reason: reason,
  });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; code?: string; missing?: string[] };
  if (res.ok === false) {
    if (res.code === "PREFLIGHT_FAILED") {
      throw new Error(`운영 준비 미완료: ${(res.missing ?? []).join(", ")}`);
    }
    throw new Error("설정 저장에 실패했습니다.");
  }
}

export async function fetchCryptoRequests(status?: string) {
  let q = supabase
    .from("crypto_charge_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CryptoChargeRequestRow[];
}

export interface ChainDepositRow {
  id: string;
  txid: string;
  from_address: string | null;
  to_address: string;
  amount_usdt: number;
  confirmations: number;
  confirmed: boolean;
  status: string;
  charge_request_id: string | null;
  detected_at: string;
  note: string | null;
}

export async function fetchChainDeposits(status?: string) {
  let q = supabase
    .from("chain_deposits")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as ChainDepositRow[];
}

/* ---------- 미매칭 입금 수동 처리 (관리자) ---------- */

export interface UnmatchedDepositRow {
  deposit_id: string;
  txid: string;
  from_address: string | null;
  to_address: string;
  actual_usdt: number;
  confirmations: number;
  confirmed: boolean;
  deposit_status: string;
  detected_at: string;
  note: string | null;
  request_id: string | null;
  user_id: string | null;
  nickname: string | null;
  username: string | null;
  requested_krw: number | null;
  requested_usdt: number | null;
  rate_krw_per_usdt: number | null;
  request_status: string | null;
  requested_at: string | null;
  expires_at: string | null;
  manual_action: string | null;
  manual_reason: string | null;
  diff_usdt: number | null;
  settle_krw: number | null;
  fee_rate: number;
  est_fee: number | null;
  est_points: number | null;
}

/** 관리자 미매칭/수동처리 대상 입금 목록 (status: UNMATCHED | CREDITED | CANCELLED | ALL …) */
export async function fetchUnmatchedDeposits(status = "UNMATCHED", limit = 100) {
  const { data, error } = await supabase.rpc("admin_list_crypto_unmatched", {
    _status: status,
    _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as unknown as UnmatchedDepositRow[];
}

const MANUAL_ERROR_LABEL: Record<string, string> = {
  ALREADY_CREDITED: "이미 지급이 완료된 건입니다.",
  DEPOSIT_CANCELLED: "이미 취소된 입금입니다.",
  DEPOSIT_DUPLICATE: "중복 처리된 입금입니다.",
  REQUEST_CANCELLED: "이미 취소된 신청입니다.",
  ALREADY_CANCELLED: "이미 취소된 신청입니다.",
  NOT_CONFIRMED: "블록 승인이 완료되지 않아 승인할 수 없습니다.",
  DUPLICATE_TXID: "동일 TXID가 이미 지급되었습니다.",
  RATE_MISSING: "적용 환율 정보가 없어 승인할 수 없습니다.",
  INVALID_STATUS: "현재 상태에서는 승인할 수 없습니다.",
  INVALID_AMOUNT: "지급 기준 금액을 계산할 수 없습니다.",
  USER_REQUIRED: "지급할 회원을 먼저 선택해 주세요.",
  USER_NOT_FOUND: "선택한 회원을 찾을 수 없습니다.",
  REQUEST_LINKED: "이미 충전 신청이 연결된 입금입니다. 목록을 새로고침해 주세요.",
};

function assertManualOk(data: unknown) {
  const res = (data ?? {}) as { ok?: boolean; code?: string };
  if (res.ok) return res;
  throw new Error(MANUAL_ERROR_LABEL[res.code ?? ""] ?? "처리할 수 없는 요청입니다.");
}

/** 수동 승인 — 실제 확인된 입금 수량 기준으로 기존 자동충전 지급 경로를 그대로 사용한다. */
export async function manualCreditDeposit(input: {
  depositId: string;
  requestId: string;
  reason: string;
}) {
  const { data, error } = await supabase.rpc("admin_manual_credit_crypto_deposit", {
    _deposit_id: input.depositId,
    _request_id: input.requestId,
    _reason: input.reason,
  });
  if (error) throw error;
  return assertManualOk(data) as { ok: boolean; points?: number; settle_krw?: number };
}

export interface AdminMemberRow {
  id: string;
  username: string | null;
  nickname: string | null;
  game_points: number | null;
  status: string | null;
}

/** 관리자 회원 검색 (아이디/닉네임/회원ID) — 서버에서 관리자 권한 검증 */
export async function searchMembers(q: string, limit = 20) {
  const { data, error } = await supabase.rpc("admin_search_members", { _q: q, _limit: limit });
  if (error) throw error;
  return (data ?? []) as unknown as AdminMemberRow[];
}

/**
 * 연결된 충전 신청이 없는 실제 입금을 관리자가 회원에게 연결해 수동 승인.
 * 지급 기준은 실제 감지된 입금 수량이며 계산·원장 기록은 기존 자동충전 경로를 재사용한다.
 */
export async function manualCreditOrphanDeposit(input: {
  depositId: string;
  userId: string;
  reason: string;
}) {
  const { data, error } = await supabase.rpc("admin_manual_credit_orphan_deposit", {
    _deposit_id: input.depositId,
    _user_id: input.userId,
    _reason: input.reason,
  });
  if (error) throw error;
  return assertManualOk(data) as { ok: boolean; points?: number; settle_krw?: number };
}

/** 수동 취소 — 포인트 지급 없음. 실제 코인 반환은 별도 수동 처리 영역이다. */
export async function cancelDepositManually(input: {
  depositId: string | null;
  requestId: string | null;
  reason: string;
}) {
  const { data, error } = await supabase.rpc("admin_cancel_crypto_deposit", {
    _deposit_id: input.depositId as unknown as string,
    _request_id: input.requestId as unknown as string,
    _reason: input.reason,
  });

  if (error) throw error;
  return assertManualOk(data);
}


/** 관리자 포인트 지급/회수 (방향·사유·중복방지 키 기반) */
export async function adjustPointsV2(input: {
  userId: string;
  direction: "ADD" | "REMOVE";
  amount: number;
  reason: string;
  requestId?: string;
}) {
  const { data, error } = await supabase.rpc("admin_adjust_points_v2", {
    _user_id: input.userId,
    _direction: input.direction,
    _amount: input.amount,
    _reason: input.reason,
    _request_id: input.requestId ?? crypto.randomUUID(),
  });
  if (error) throw error;
  const result = data as unknown as {
    ok: boolean;
    code?: string;
    message?: string;
    balance_after?: number;
  };
  // 서버가 실패 코드를 반환하면 성공으로 처리하지 않는다.
  if (!result?.ok) throw new Error(result?.message ?? result?.code ?? "포인트 처리가 거부되었습니다.");
  return result;
}
