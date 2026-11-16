import { supabase } from "@/integrations/supabase/client";

/**
 * 관리자 메인 대시보드 · 최근 활동 · 통합 검색 서비스.
 * 집계는 모두 SECURITY DEFINER RPC(admin 검증)에서 수행하며 클라이언트는 표시만 한다.
 */

export interface DashboardOps {
  gameCoreVersion: string | null;
  gameSecurityVersion: string | null;
  appMode: string | null;
  maintenance: boolean;
  gameLock: boolean;
  testDriverEnabled: boolean;
  cryptoEnabled: boolean;
  watcherLastSuccessAt: string | null;
  watcherLockStatus: string | null;
  watcherFailStreak: number;
  recentGameErrors: number;
  openFindings: number;
  stuckRounds: number;
}

export interface DashboardOverview {
  checkedAt: string;
  members: number;
  onlineNow: number;
  inGameNow: number;
  activeRooms: number;
  playingRooms: number;
  newSignupsToday: number;
  usdtChargeToday: number;
  usdtChargeTodayCount: number;
  withdrawRequestedToday: number;
  withdrawPaidToday: number;
  pendingWithdrawCount: number;
  pendingChargeCount: number;
  circulatingPoints: number;
  lockedPoints: number;
  affiliateUnsettled: number;
  affiliateUnsettledCount: number;
  roundsToday: number;
  ops: DashboardOps;
}

export async function fetchDashboardOverview() {
  const { data, error } = await supabase.rpc("admin_dashboard_overview");
  if (error) throw error;
  return data as unknown as DashboardOverview;
}

export interface ActivityRow {
  at: string;
  kind: string;
  who: string | null;
  detail: string | null;
  result: string | null;
}

export const ACTIVITY_LABEL: Record<string, string> = {
  SIGNUP: "회원가입",
  USDT_CHARGE: "USDT 충전",
  WITHDRAW: "출금",
  ADJUST_POINTS: "포인트 조정",
  ADMIN_ADJUST_POINTS: "포인트 조정",
  SET_AFFILIATE: "총판 지정/해제",
  SET_COMMISSION_STATUS: "커미션 정산",
  AUTO_ROOM_KICK: "자동 퇴장",
  BALANCE_INSUFFICIENT: "최소 입장금 미달",
  FORCE_DELETE: "방 강제 삭제",
  SAFE_CLOSE: "방 안전 종료",
  SUSPEND_USER: "회원 정지",
  CHAT_BAN_USER: "채팅 금지",
  ITEM_CREATE: "상품 등록",
  ITEM_UPDATE: "상품 수정",
  PAY_WEEKLY_REWARDS: "주간 상금 지급",
};

export function activityLabel(kind: string) {
  if (ACTIVITY_LABEL[kind]) return ACTIVITY_LABEL[kind];
  if (kind.startsWith("ALERT_")) return `경고 · ${kind.slice(6)}`;
  return kind.replaceAll("_", " ");
}

export async function fetchRecentActivity(limit = 40) {
  const { data, error } = await supabase.rpc("admin_recent_activity", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as unknown as ActivityRow[];
}

export interface GlobalSearchResult {
  members: { id: string; username: string | null; nickname: string; rank: string; game_points: number; status: string }[];
  rooms: { id: string; room_number: number; title: string; status: string; game_mode: string; current_players: number }[];
  affiliates: { id: string; affiliate_code: string; status: string; nickname: string | null }[];
  transactions: {
    id: string;
    txid: string | null;
    status: string;
    requested_krw: number;
    expected_usdt: number;
    created_at: string;
    nickname: string | null;
  }[];
  withdrawals: {
    id: string;
    status: string;
    requested_points: number;
    payout_amount: number;
    requested_at: string;
    nickname: string | null;
  }[];
}

export async function globalSearch(q: string) {
  const { data, error } = await supabase.rpc("admin_global_search", { _q: q });
  if (error) throw error;
  return data as unknown as GlobalSearchResult;
}
