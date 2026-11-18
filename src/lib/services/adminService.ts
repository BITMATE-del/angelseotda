import { supabase } from "@/integrations/supabase/client";

/** 모든 운영 작업은 SECURITY DEFINER RPC를 통해서만 수행되며 admin_logs에 기록된다. */

export async function setUserStatus(userId: string, status: string, reason: string) {
  const { error } = await supabase.rpc("admin_set_user_status", {
    _user_id: userId,
    _status: status,
    _reason: reason,
  });
  if (error) throw error;
}

export async function setUserLevel(userId: string, level: number, reason: string) {
  const { error } = await supabase.rpc("admin_set_user_level", {
    _user_id: userId,
    _level: level,
    _reason: reason,
  });
  if (error) throw error;
}

export async function updateRoomType(input: {
  id: string;
  minPoints: number;
  baseBet: number;
  maxPlayers: number;
  active: boolean;
  allowSutda2: boolean;
  allowSutda3: boolean;
}) {
  const { error } = await supabase.rpc("admin_update_room_type", {
    _id: input.id,
    _min_points: input.minPoints,
    _base_bet: input.baseBet,
    _max_players: input.maxPlayers,
    _active: input.active,
    _allow_sutda2: input.allowSutda2,
    _allow_sutda3: input.allowSutda3,
  });
  if (error) throw error;
}

export async function updateCardAsset(input: {
  id: string;
  assetUrl: string;
  enabled: boolean;
  isGwang: boolean;
}) {
  const { error } = await supabase.rpc("admin_update_card_asset", {
    _id: input.id,
    _asset_url: input.assetUrl,
    _enabled: input.enabled,
    _is_gwang: input.isGwang,
  });
  if (error) throw error;
}

export async function updateAdminSetting(key: string, value: unknown) {
  const { error } = await supabase.rpc("admin_update_setting", {
    _key: key,
    _value: value as never,
  });
  if (error) throw error;
}

export async function handleReport(reportId: string, status: string, adminNote: string) {
  const { error } = await supabase.rpc("admin_handle_report", {
    _report_id: reportId,
    _status: status,
    _admin_note: adminNote,
  });
  if (error) throw error;
}

export async function setSeasonStatus(seasonId: string, status: string) {
  const { error } = await supabase.rpc("admin_set_season_status", {
    _season_id: seasonId,
    _status: status,
  });
  if (error) throw error;
}

export async function recalcSeasonRankings() {
  const { error } = await supabase.rpc("admin_recalc_season_rankings");
  if (error) throw error;
}

export async function grantItem(userId: string, itemId: string, reason: string) {
  const { error } = await supabase.rpc("admin_grant_item", {
    _user_id: userId,
    _item_id: itemId,
    _reason: reason,
  });
  if (error) throw error;
}

/* ── 운영 진단 (무결성 · 서버 상태 · 테스트 데이터 정리) ────────────────── */

export type ComponentStatus = "ONLINE" | "DEGRADED" | "OFFLINE";

export interface ServerStatusPart {
  status: ComponentStatus;
  latencyMs?: number;
  recentErrors?: number;
  tables?: number;
  users?: number;
}

export interface ServerStatus {
  checkedAt: string;
  database: ServerStatusPart;
  auth: ServerStatusPart;
  realtime: ServerStatusPart;
  gameRpc: ServerStatusPart;
  pointRpc: ServerStatusPart;
  chargeRpc: ServerStatusPart;
  withdrawalRpc: ServerStatusPart;
  recentErrorTotal: number;
  appMode: string;
  maintenance: boolean;
  gameLock: boolean;
  activeRounds: number;
}

export interface IntegrityReport {
  checkedAt: string;
  pointMismatch: Record<string, unknown>[];
  pointMismatchCount: number;
  negativeBalances: Record<string, unknown>[];
  negativeBalanceCount: number;
  potMismatch: Record<string, unknown>[];
  potMismatchCount: number;
  duplicateSettlement: Record<string, unknown>[];
  duplicateSettlementCount: number;
  cardMismatch: Record<string, unknown>[];
  cardMismatchCount: number;
  cardConfig: { gwang_codes: string[]; total_assets: number; valid: boolean };
  failedSettlements: Record<string, unknown>[];
  failedSettlementCount: number;
}

/** 서버 컴포넌트 상태 · 응답 속도 · 최근 15분 오류율 */
export async function fetchServerStatus() {
  const { data, error } = await supabase.rpc("admin_server_status");
  if (error) throw error;
  return data as unknown as ServerStatus;
}

/** 포인트 · POT · 카드 · 정산 무결성 검사 */
export async function fetchIntegrityReport() {
  const { data, error } = await supabase.rpc("admin_integrity_report");
  if (error) throw error;
  return data as unknown as IntegrityReport;
}

/** 운영 CRITICAL 경고 (미해결 OPEN 항목 + 선택 범위만 집계) */
export type CriticalLevel = "OK" | "WARN" | "CRITICAL" | "OFF";
export type MonitorScope = "OPERATION" | "TEST" | "ALL";

export interface CriticalAlert {
  code: string;
  level: CriticalLevel;
  count: number;
  detail: string;
}

export interface CriticalAlertReport {
  checkedAt: string;
  scope: MonitorScope;
  alerts: CriticalAlert[];
  historical: { resolved: number; ignoredTest: number; openTest: number };
  criticalCount: number;
}

export const CRITICAL_ALERT_LABEL: Record<string, string> = {
  POT_MISMATCH: "POT 합계 불일치",
  SETTLEMENT_PAYOUT_MISSING: "정산 지급 불일치",
  POINT_MISMATCH: "포인트 원장 이상",
  SETTLEMENT_FAILED: "정산 실패 라운드",
  ROUND_STUCK: "진행 정지 라운드",
  REALTIME_DISCONNECTED: "실시간 연결",
  USDT_WATCHER_OFFLINE: "USDT 자동충전 감시기",
  CRYPTO_CREDIT_ERROR: "자동충전 지급 오류",
};

export const MONITOR_SCOPE_LABEL: Record<MonitorScope, string> = {
  OPERATION: "운영",
  TEST: "테스트",
  ALL: "전체",
};

export async function fetchCriticalAlerts(scope: MonitorScope = "OPERATION") {
  const { data, error } = await supabase.rpc("admin_critical_alerts", { _scope: scope });
  if (error) throw error;
  return data as unknown as CriticalAlertReport;
}

/** 서비스 영역별 운영 준비 상태 (게임 코어 / 회원 / 관리자 / USDT / 출금 / 실시간 / 보안) */
export type ReadinessStatus = "READY" | "NOT_READY";

export interface ReadinessArea {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessReport {
  checkedAt: string;
  criticalCount: number;
  areas: ReadinessArea[];
}

export async function fetchServiceReadiness() {
  const { data, error } = await supabase.rpc("admin_service_readiness");
  if (error) throw error;
  return data as unknown as ReadinessReport;
}

/** 무결성 이력 (삭제 없이 상태만 관리: OPEN / RESOLVED / IGNORED_TEST) */
export type FindingStatus = "OPEN" | "RESOLVED" | "IGNORED_TEST";

export interface IntegrityFinding {
  id: string;
  code: string;
  scope: "OPERATION" | "TEST";
  subject_type: string;
  subject_id: string | null;
  subject_label: string | null;
  status: FindingStatus;
  detail: Record<string, unknown>;
  reason: string | null;
  occurred_at: string | null;
  updated_at: string;
}

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  OPEN: "미해결",
  RESOLVED: "해결",
  IGNORED_TEST: "테스트 이력",
};

export async function scanIntegrityFindings() {
  const { data, error } = await supabase.rpc("admin_scan_integrity_findings");
  if (error) throw error;
  return data as unknown as Record<string, number | string>;
}

export async function fetchIntegrityFindings(scope: MonitorScope = "OPERATION") {
  const { data, error } = await supabase.rpc("admin_list_integrity_findings", { _scope: scope });
  if (error) throw error;
  return (data ?? []) as unknown as IntegrityFinding[];
}

export async function setFindingStatus(
  findingId: string,
  status: FindingStatus,
  reason: string,
) {
  const { error } = await supabase.rpc("admin_set_finding_status", {
    _finding_id: findingId,
    _status: status,
    _reason: reason,
  });
  if (error) throw error;
}

/** 테스트 계정/테스트 방 기록만 삭제 (실사용자 데이터는 보존) */
export async function cleanupTestData(reason: string) {
  const { data, error } = await supabase.rpc("admin_cleanup_test_data", { _reason: reason });
  if (error) throw error;
  return data as unknown as Record<string, number | boolean | string>;
}


export const CHARGE_FLOW = ["REVIEWING", "APPROVED", "REJECTED"] as const;
export const WITHDRAW_FLOW = ["REVIEWING", "APPROVED", "PAID", "REJECTED"] as const;

export const USER_STATUS_LABEL: Record<string, string> = {
  active: "정상",
  suspended: "정지",
  chat_banned: "채팅금지",
};

export const TX_TYPE_LABEL: Record<string, string> = {
  charge_approved: "충전 승인",
  withdraw_requested: "출금 신청",
  withdraw_completed: "출금 지급",
  withdraw_rejected: "출금 반려",
  admin_add: "관리자 지급",
  admin_remove: "관리자 회수",
  game_win: "게임 승",
  game_loss: "게임 패",
  item_purchase: "아이템 구매",
};

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", { hour12: false });
}
