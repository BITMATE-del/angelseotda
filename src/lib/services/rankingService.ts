import { supabase } from "@/integrations/supabase/client";
import type { AppRank } from "@/lib/game/rankTiers";

/**
 * 주간 랭킹 / 계급 / 이펙트 서비스.
 * 모든 집계·보상 지급은 서버 RPC가 authoritative 하며 클라이언트는 조회만 한다.
 */

export interface WeeklySeason {
  id: string;
  week_key: string;
  starts_at: string;
  ends_at: string;
  status: string;
  total_charge_amount: number;
  reward_rate: number;
  deposit_participants: number;
  gwang_participants: number;
  profit_participants: number;
  finalized_at: string | null;
  rewarded_at: string | null;
}

export const MIN_RANKING_PARTICIPANTS = 20;

export const RANKING_TYPES = [
  { key: "DEPOSIT", label: "입금랭커", reward: "1위 · 주간 총 충전액의 1% 포인트" },
  { key: "GWANG", label: "광땡랭커", reward: "1~3위 · 50,000 / 30,000 / 10,000P" },
  { key: "PROFIT", label: "수익왕", reward: "1위 · 충전 레이크 면제권 2장" },
] as const;

export type RankingType = (typeof RANKING_TYPES)[number]["key"];

/** 이번 주 시즌을 보장 생성하고 반환 (지난 시즌은 정산 대기로 전환) */
export async function ensureWeeklySeason(): Promise<WeeklySeason | null> {
  const { data, error } = await supabase.rpc("ensure_weekly_season");
  if (error) throw error;
  return (data as unknown as WeeklySeason) ?? null;
}

export async function fetchSeasons(limit = 12): Promise<WeeklySeason[]> {
  const { data, error } = await supabase
    .from("weekly_ranking_seasons")
    .select("*")
    .order("starts_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WeeklySeason[];
}

export interface DepositRow {
  user_id: string;
  nickname: string;
  rank: AppRank;
  charge_amount: number;
  withdraw_amount: number;
  net_deposit: number;
  charge_count: number;
  rank_position: number;
}
export interface GwangRow {
  user_id: string;
  nickname: string;
  rank: AppRank;
  gwang38_wins: number;
  gwang18_wins: number;
  gwang13_wins: number;
  total_gwang_wins: number;
  games_played: number;
  rank_position: number;
}
export interface ProfitRow {
  user_id: string;
  nickname: string;
  rank: AppRank;
  win_points: number;
  win_count: number;
  games_played: number;
  rank_position: number;
}

export async function fetchDepositRanking(seasonId: string, limit = 50) {
  const { data, error } = await supabase.rpc("weekly_deposit_ranking", {
    _season_id: seasonId,
    _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as unknown as DepositRow[];
}

export async function fetchGwangRanking(seasonId: string, limit = 50) {
  const { data, error } = await supabase.rpc("weekly_gwang_ranking", {
    _season_id: seasonId,
    _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as unknown as GwangRow[];
}

export async function fetchProfitRanking(seasonId: string, limit = 50) {
  const { data, error } = await supabase.rpc("weekly_profit_ranking", {
    _season_id: seasonId,
    _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as unknown as ProfitRow[];
}

export async function fetchSeasonRewards(seasonId: string) {
  const { data, error } = await supabase
    .from("ranking_rewards")
    .select("*")
    .eq("season_id", seasonId)
    .order("ranking_type")
    .order("rank_position");
  if (error) throw error;
  return data ?? [];
}

/* ---------------- 계급 ---------------- */

export async function syncMyRank(): Promise<AppRank | null> {
  const { data, error } = await supabase.rpc("sync_my_rank");
  if (error) throw error;
  return (data as AppRank | null) ?? null;
}

export interface AttendanceResult {
  checked_in: boolean;
  date: string;
  attendance_count: number;
  rank: AppRank;
}

export async function claimDailyAttendance(): Promise<AttendanceResult> {
  const { data, error } = await supabase.rpc("claim_daily_attendance");
  if (error) throw error;
  return data as unknown as AttendanceResult;
}

/** 한국시간 기준 오늘 출석 여부 */
export async function fetchTodayAttendance(userId: string) {
  const today = seoulDateString();
  const { data, error } = await supabase
    .from("user_attendance")
    .select("attend_date")
    .eq("user_id", userId)
    .eq("attend_date", today)
    .maybeSingle();
  if (error) throw error;
  return { today, checkedIn: !!data };
}

export async function fetchMyPromotions(userId: string) {
  const { data, error } = await supabase
    .from("rank_promotions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ---------------- 칭호 / 계급 보상 내역 ---------------- */

export interface OwnedTitle {
  id: string;
  item_id: string;
  equipped: boolean;
  source_type: string | null;
  acquired_at: string;
  name: string;
  description: string | null;
  rarity: string | null;
  rank_required: AppRank | null;
}

/** 보유 칭호 (계급 보상 + 주간 랭킹 우승 보상) */
export async function fetchMyTitles(userId: string): Promise<OwnedTitle[]> {
  const { data, error } = await supabase
    .from("user_items")
    .select(
      "id, item_id, equipped, source_type, acquired_at, items!inner(name, description, rarity, rank_required, category)",
    )
    .eq("user_id", userId)
    .eq("items.category", "title")
    .order("acquired_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const item = (row as unknown as { items: Record<string, unknown> }).items;
    return {
      id: String(row.id),
      item_id: String(row.item_id),
      equipped: !!row.equipped,
      source_type: (row.source_type as string | null) ?? null,
      acquired_at: String(row.acquired_at),
      name: String(item['name'] ?? ""),
      description: (item['description'] as string | null) ?? null,
      rarity: (item['rarity'] as string | null) ?? null,
      rank_required: (item['rank_required'] as AppRank | null) ?? null,
    };
  });
}

/** 칭호 장착 (서버 equip_item RPC가 카테고리 단일 장착을 보장) */
export async function equipTitle(itemId: string) {
  const { error } = await supabase.rpc("equip_item", { _item_id: itemId });
  if (error) throw error;
}

export interface RankClaim {
  id: string;
  rank: AppRank;
  points_reward: number;
  items_reward: unknown;
  claimed_at: string;
}

/** 계급 달성 보상 지급 내역 */
export async function fetchRankClaims(userId: string): Promise<RankClaim[]> {
  const { data, error } = await supabase
    .from("rank_reward_claims")
    .select("id, rank, points_reward, items_reward, claimed_at")
    .eq("user_id", userId)
    .order("claimed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RankClaim[];
}

export const TITLE_SOURCE_LABEL: Record<string, string> = {
  RANK_REWARD: "계급 보상",
  RANKING_REWARD: "주간 랭킹 우승",
  PURCHASE: "상점 구매",
  ADMIN_GRANT: "관리자 지급",
};

/* ---------------- 충전 레이크 면제권 ---------------- */

export async function fetchMyTickets(userId: string) {
  const { data, error } = await supabase
    .from("rake_free_tickets")
    .select("*")
    .eq("user_id", userId)
    .order("issued_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  return {
    rows,
    available: rows.filter((t) => t.status === "ISSUED").length,
    reserved: rows.filter((t) => t.status === "RESERVED").length,
    used: rows.filter((t) => t.status === "USED").length,
  };
}

/* ---------------- 이펙트 설정 ---------------- */

export interface EffectSettings {
  entry_effect: boolean;
  win_effect: boolean;
  showdown_effect: boolean;
  name_effect: boolean;
  reduce_others: boolean;
}

export const DEFAULT_EFFECT_SETTINGS: EffectSettings = {
  entry_effect: true,
  win_effect: true,
  showdown_effect: true,
  name_effect: true,
  reduce_others: false,
};

export async function fetchEffectSettings(userId: string): Promise<EffectSettings> {
  const { data, error } = await supabase
    .from("user_effect_settings")
    .select("entry_effect, win_effect, showdown_effect, name_effect, reduce_others")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_EFFECT_SETTINGS, ...(data ?? {}) };
}

export async function saveEffectSettings(userId: string, patch: Partial<EffectSettings>) {
  const current = await fetchEffectSettings(userId);
  const { error } = await supabase
    .from("user_effect_settings")
    .upsert({ user_id: userId, ...current, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/* ---------------- 관리자 ---------------- */

export async function adminRecalcWeeklySeason(seasonId: string, reason?: string) {
  const { error } = await supabase.rpc("admin_recalc_weekly_season", {
    _season_id: seasonId,
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw error;
}

export async function adminFinalizeWeeklySeason(seasonId: string) {
  const { error } = await supabase.rpc("admin_finalize_weekly_season", { _season_id: seasonId });
  if (error) throw error;
}

export async function adminPayWeeklyRewards(seasonId: string) {
  const { data, error } = await supabase.rpc("admin_pay_weekly_rewards", { _season_id: seasonId });
  if (error) throw error;
  return data;
}

/* ---------------- 유틸 ---------------- */

export function seoulDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 시즌 종료까지 남은 시간 문자열 */
export function remainingLabel(endsAt: string, now = Date.now()) {
  const diff = new Date(endsAt).getTime() - now;
  if (diff <= 0) return "종료";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return d > 0 ? `${d}일 ${h}시간 ${m}분` : `${h}시간 ${m}분 ${s}초`;
}

export const SEASON_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "진행중",
  CALCULATING: "집계중",
  FINALIZED: "확정",
  REWARDED: "상금지급 완료",
};

export function weekRangeLabel(startsAt: string, endsAt: string) {
  const fmt = (v: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(v));
  return `${fmt(startsAt)} ~ ${fmt(endsAt)}`;
}
