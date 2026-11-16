/**
 * 계급(랭크) 정의 — 강등 없음, 순차 승급.
 * 승급 조건 판정은 서버(evaluate_member_rank RPC)가 authoritative 하다.
 * 여기 값은 표시/안내 전용.
 */
export type AppRank = "UNRANKED" | "BRONZE" | "SILVER" | "GOLD" | "DIAMOND" | "CHALLENGER";

export interface RankTier {
  rank: AppRank;
  order: number;
  label: string;
  /** 누적 충전액(원) */
  minChargeAmount: number;
  /** 누적 충전 횟수 */
  minChargeCount: number;
  /** 누적 출석일 */
  minAttendance: number;
  pointsReward: number;
  /** 계급 컬러 (디자인 토큰 기반 클래스) */
  badgeClass: string;
  summary: string;
}

export const RANK_TIERS: RankTier[] = [
  {
    rank: "UNRANKED",
    order: 0,
    label: "언랭크",
    minChargeAmount: 0,
    minChargeCount: 0,
    minAttendance: 0,
    pointsReward: 10000,
    badgeClass: "border-border bg-white/5 text-muted-foreground",
    summary: "가입 즉시 · 기본 프레임/카드 뒷면/이모티콘",
  },
  {
    rank: "BRONZE",
    order: 1,
    label: "브론즈",
    minChargeAmount: 1000000,
    minChargeCount: 0,
    minAttendance: 3,
    pointsReward: 10000,
    badgeClass: "border-[#a9704a]/60 bg-[#a9704a]/15 text-[#d79a6d]",
    summary: "누적 충전 100만원 + 출석 3일",
  },
  {
    rank: "SILVER",
    order: 2,
    label: "실버",
    minChargeAmount: 5000000,
    minChargeCount: 0,
    minAttendance: 15,
    pointsReward: 30000,
    badgeClass: "border-[#c9d2de]/50 bg-[#c9d2de]/12 text-[#dfe6ef]",
    summary: "누적 충전 500만원 + 출석 15일",
  },
  {
    rank: "GOLD",
    order: 3,
    label: "골드",
    minChargeAmount: 10000000,
    minChargeCount: 0,
    minAttendance: 30,
    pointsReward: 100000,
    badgeClass: "border-gold/60 bg-gold/12 text-gold",
    summary: "누적 충전 1,000만원 + 출석 30일",
  },
  {
    rank: "DIAMOND",
    order: 4,
    label: "다이아몬드",
    minChargeAmount: 20000000,
    minChargeCount: 30,
    minAttendance: 0,
    pointsReward: 300000,
    badgeClass: "border-[#7fd7ff]/50 bg-[#7fd7ff]/12 text-[#a9e6ff]",
    summary: "누적 충전 2,000만원 + 충전 30회",
  },
  {
    rank: "CHALLENGER",
    order: 5,
    label: "챌린저",
    minChargeAmount: 50000000,
    minChargeCount: 0,
    minAttendance: 0,
    pointsReward: 500000,
    badgeClass: "border-gold bg-gradient-to-r from-gold/25 to-accent/20 text-gold-soft",
    summary: "누적 충전 5,000만원",
  },
];

export function tierOf(rank: AppRank | null | undefined): RankTier {
  return RANK_TIERS.find((t) => t.rank === rank) ?? RANK_TIERS[0]!;
}

export function nextTier(rank: AppRank | null | undefined): RankTier | null {
  const cur = tierOf(rank);
  return RANK_TIERS.find((t) => t.order === cur.order + 1) ?? null;
}

/** 다음 계급까지의 진행률(0~1). 조건이 여러 개면 가장 뒤처진 항목 기준. */
export function rankProgress(
  rank: AppRank | null | undefined,
  stats: { chargeAmount: number; chargeCount: number; attendance: number },
) {
  const next = nextTier(rank);
  if (!next) return { next: null, ratio: 1, items: [] as const };
  const items = [
    {
      key: "charge_amount" as const,
      label: "누적 충전액",
      current: stats.chargeAmount,
      target: next.minChargeAmount,
      unit: "원",
    },
    {
      key: "charge_count" as const,
      label: "누적 충전 횟수",
      current: stats.chargeCount,
      target: next.minChargeCount,
      unit: "회",
    },
    {
      key: "attendance" as const,
      label: "누적 출석",
      current: stats.attendance,
      target: next.minAttendance,
      unit: "일",
    },
  ].filter((i) => i.target > 0);

  const ratio = items.length
    ? Math.min(...items.map((i) => Math.min(1, i.current / i.target)))
    : 1;
  return { next, ratio, items };
}

export const EFFECT_CATEGORY_LABEL: Record<string, string> = {
  card_skin: "카드 스킨",
  card_back: "카드 뒷면",
  table_skin: "테이블 스킨",
  profile_frame: "프로필 프레임",
  name_effect: "닉네임 효과",
  entry_effect: "입장 효과",
  win_effect: "승리 효과",
  showdown_effect: "쇼다운 효과",
  pot_effect: "판돈 효과",
  emote: "이모티콘",
  title: "훈장/타이틀",
  avatar: "아바타",
};
