import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { RankBadge } from "@/components/rank/RankBadge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatPoints, formatWon } from "@/lib/services/walletService";
import {
  MIN_RANKING_PARTICIPANTS,
  RANKING_TYPES,
  SEASON_STATUS_LABEL,
  TITLE_SOURCE_LABEL,
  claimDailyAttendance,
  ensureWeeklySeason,
  equipTitle,
  fetchMyTitles,
  fetchRankClaims,
  fetchDepositRanking,
  fetchGwangRanking,
  fetchProfitRanking,
  fetchSeasonRewards,
  fetchSeasons,
  fetchTodayAttendance,
  remainingLabel,
  syncMyRank,
  weekRangeLabel,
  type RankingType,
} from "@/lib/services/rankingService";
import { RANK_TIERS, rankProgress, tierOf } from "@/lib/game/rankTiers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ranking")({
  head: () => ({
    meta: [
      { title: "주간 랭킹 · 계급 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content:
          "엔젤섯다 주간 랭킹 — 입금랭커, 광땡랭커, 수익왕 순위와 상금, 계급 승급 조건과 계급 전용 보상을 확인하세요.",
      },
      { property: "og:title", content: "주간 랭킹 · 계급 · 엔젤섯다" },
      {
        property: "og:description",
        content: "월요일 00시부터 일요일 자정까지, 이번 주 최고의 섯다 플레이어를 가립니다.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://angel-sd.com/ranking" }],
  }),
  component: Ranking,
});

const SEASON_SORTS = [
  { key: "rank_points", label: "랭크 포인트" },
  { key: "wins", label: "승리 수" },
  { key: "gwangttaeng_count", label: "광땡" },
] as const;

function Ranking() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RankingType | "TIER" | "OVERALL">("DEPOSIT");
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 이번 주 시즌 보장 생성 (로그인 사용자 기준)
  useQuery({
    queryKey: ["ensure-weekly-season"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: ensureWeeklySeason,
  });

  const seasons = useQuery({ queryKey: ["weekly-seasons"], queryFn: () => fetchSeasons(12) });
  const season = useMemo(
    () => (seasons.data ?? []).find((s) => s.id === seasonId) ?? (seasons.data ?? [])[0] ?? null,
    [seasons.data, seasonId],
  );

  const deposit = useQuery({
    queryKey: ["weekly-deposit", season?.id],
    enabled: !!season && !!user && tab === "DEPOSIT",
    queryFn: () => fetchDepositRanking(season!.id),
  });
  const gwang = useQuery({
    queryKey: ["weekly-gwang", season?.id],
    enabled: !!season && !!user && tab === "GWANG",
    queryFn: () => fetchGwangRanking(season!.id),
  });
  const profit = useQuery({
    queryKey: ["weekly-profit", season?.id],
    enabled: !!season && !!user && tab === "PROFIT",
    queryFn: () => fetchProfitRanking(season!.id),
  });
  const rewards = useQuery({
    queryKey: ["season-rewards", season?.id],
    enabled: !!season && !!user,
    queryFn: () => fetchSeasonRewards(season!.id),
  });

  const overall = useQuery({
    queryKey: ["ranking-overall"],
    // 회원 프로필은 로그인 회원만 조회할 수 있다 (비로그인 노출 차단)
    enabled: tab === "OVERALL" && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, level, rank, rank_points, wins, losses, max_streak, gwangttaeng_count")
        .order("rank_points", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const attendance = useQuery({
    queryKey: ["attendance-today", user?.id],
    enabled: !!user,
    queryFn: () => fetchTodayAttendance(user!.id),
  });

  const checkIn = useMutation({
    mutationFn: claimDailyAttendance,
    onSuccess: (res) => {
      toast.success(
        res.checked_in
          ? `출석 완료! 누적 ${res.attendance_count}일`
          : `오늘은 이미 출석했습니다. (누적 ${res.attendance_count}일)`,
      );
      void queryClient.invalidateQueries({ queryKey: ["attendance-today"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "출석 처리 실패"),
  });

  const sync = useMutation({
    mutationFn: syncMyRank,
    onSuccess: (rank) => {
      toast.success(`계급 확인 완료 — 현재 ${tierOf(rank).label}`);
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["user-items"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "계급 갱신 실패"),
  });

  const myTier = tierOf(profile?.rank as never);
  const progress = rankProgress(profile?.rank as never, {
    chargeAmount: Number(profile?.total_charge_amount ?? 0),
    chargeCount: Number(profile?.total_charge_count ?? 0),
    attendance: Number(profile?.attendance_count ?? 0),
  });

  const participants =
    tab === "DEPOSIT"
      ? (season?.deposit_participants ?? 0)
      : tab === "GWANG"
        ? (season?.gwang_participants ?? 0)
        : (season?.profit_participants ?? 0);

  const liveCount =
    tab === "DEPOSIT"
      ? (deposit.data?.length ?? 0)
      : tab === "GWANG"
        ? (gwang.data?.length ?? 0)
        : (profit.data?.length ?? 0);
  const effectiveParticipants = Math.max(participants, liveCount);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-gold-plate font-display text-2xl">주간 랭킹 &amp; 계급</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            주간 시즌 · 한국시간 월요일 00:00 ~ 일요일 23:59 · 매주 독립 집계
          </p>
        </div>
        {season && (
          <div className="panel-surface rounded-xl px-4 py-3 text-right">
            <p className="text-[11px] text-muted-foreground">
              {season.week_key} · {weekRangeLabel(season.starts_at, season.ends_at)} ·{" "}
              {SEASON_STATUS_LABEL[season.status] ?? season.status}
            </p>
            <p className="font-display text-lg text-gold">
              {season.status === "ACTIVE" ? remainingLabel(season.ends_at, tick) : "집계 종료"}
            </p>
          </div>
        )}
      </div>

      {/* 내 계급 카드 */}
      <div className="panel-surface mt-5 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <RankBadge rank={(profile?.rank as never) ?? "UNRANKED"} size="lg" />
            <div>
              <p className="font-display text-lg text-foreground">
                {profile?.nickname ?? "게스트"}
              </p>
              <p className="text-xs text-muted-foreground">
                누적 충전 {formatWon(Number(profile?.total_charge_amount ?? 0))} ·{" "}
                {Number(profile?.total_charge_count ?? 0)}회 · 출석{" "}
                {Number(profile?.attendance_count ?? 0)}일
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={attendance.data?.checkedIn ? "goldOutline" : "gold"}
              size="sm"
              disabled={!user || checkIn.isPending}
              onClick={() => checkIn.mutate()}
            >
              {attendance.data?.checkedIn ? "오늘 출석 완료" : "출석 체크"}
            </Button>
            <Button
              variant="table"
              size="sm"
              disabled={!user || sync.isPending}
              onClick={() => sync.mutate()}
            >
              계급 확인/보상 수령
            </Button>
          </div>
        </div>

        {progress.next ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                다음 계급 <span className="text-gold">{progress.next.label}</span> —{" "}
                {progress.next.summary}
              </span>
              <span className="text-gold-soft">{Math.floor(progress.ratio * 100)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold/70 to-gold"
                style={{ width: `${Math.max(2, progress.ratio * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {progress.items.map((i) => (
                <span key={i.key}>
                  {i.label} {i.current.toLocaleString("ko-KR")} / {i.target.toLocaleString("ko-KR")}
                  {i.unit}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-gold-soft">
            최고 계급 CHALLENGER 달성 — 강등 없이 영구 유지됩니다.
          </p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          계급은 강등되지 않으며 순차적으로만 승급합니다. 계급 전용 아이템/이펙트는 상점에서 판매하지
          않고 계급 달성 보상으로만 지급됩니다.
        </p>
      </div>

      {user && <TitleShelf userId={user.id} />}

      {/* 탭 */}
      <div className="mt-6 flex flex-wrap gap-2">
        {RANKING_TYPES.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "gold" : "table"}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
        <Button variant={tab === "TIER" ? "gold" : "table"} size="sm" onClick={() => setTab("TIER")}>
          계급표
        </Button>
        <Button
          variant={tab === "OVERALL" ? "gold" : "table"}
          size="sm"
          onClick={() => setTab("OVERALL")}
        >
          통산 랭킹
        </Button>
      </div>

      {/* 시즌 선택 */}
      {tab !== "TIER" && tab !== "OVERALL" && (seasons.data?.length ?? 0) > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(seasons.data ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => setSeasonId(s.id)}
              className={cn(
                "rounded-lg border px-3 py-1 text-[11px] transition",
                season?.id === s.id
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-border bg-black/30 text-muted-foreground hover:text-foreground",
              )}
            >
              {s.week_key}
            </button>
          ))}
        </div>
      )}

      {tab !== "TIER" && tab !== "OVERALL" && (
        <div className="panel-surface mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs">
          <span className="text-muted-foreground">
            상금: {RANKING_TYPES.find((t) => t.key === tab)?.reward}
          </span>
          <span
            className={cn(
              effectiveParticipants >= MIN_RANKING_PARTICIPANTS ? "text-gold" : "text-accent",
            )}
          >
            참여자 {effectiveParticipants}명 / 최소 {MIN_RANKING_PARTICIPANTS}명
            {effectiveParticipants >= MIN_RANKING_PARTICIPANTS
              ? " · 상금 지급 조건 충족"
              : " · 미달 시 상금 미지급"}
          </span>
        </div>
      )}

      {!user && tab !== "TIER" && tab !== "OVERALL" && (
        <p className="panel-surface mt-4 rounded-2xl p-10 text-center text-sm text-muted-foreground">
          주간 랭킹은 로그인 후 확인할 수 있습니다.
        </p>
      )}

      {/* 입금랭커 */}
      {user && tab === "DEPOSIT" && (
        <RankTable
          headers={["순위", "플레이어", "충전액", "출금액", "순입금액", "충전횟수"]}
          rows={(deposit.data ?? []).map((r) => ({
            key: r.user_id,
            position: Number(r.rank_position),
            nickname: r.nickname,
            rank: r.rank,
            cells: [
              formatWon(Number(r.charge_amount)),
              formatWon(Number(r.withdraw_amount)),
              formatWon(Number(r.net_deposit)),
              `${r.charge_count}회`,
            ],
          }))}
          loading={deposit.isLoading}
        />
      )}

      {/* 광땡랭커 */}
      {user && tab === "GWANG" && (
        <RankTable
          headers={["순위", "플레이어", "38광땡", "18광땡", "13광땡", "총 광땡승"]}
          rows={(gwang.data ?? []).map((r) => ({
            key: r.user_id,
            position: Number(r.rank_position),
            nickname: r.nickname,
            rank: r.rank,
            cells: [
              `${r.gwang38_wins}회`,
              `${r.gwang18_wins}회`,
              `${r.gwang13_wins}회`,
              `${r.total_gwang_wins}회`,
            ],
          }))}
          loading={gwang.isLoading}
        />
      )}

      {/* 수익왕 */}
      {user && tab === "PROFIT" && (
        <RankTable
          headers={["순위", "플레이어", "승리 획득 포인트", "승리 수", "게임 수"]}
          rows={(profit.data ?? []).map((r) => ({
            key: r.user_id,
            position: Number(r.rank_position),
            nickname: r.nickname,
            rank: r.rank,
            cells: [formatPoints(Number(r.win_points)), `${r.win_count}승`, `${r.games_played}판`],
          }))}
          loading={profit.isLoading}
        />
      )}

      {/* 지급 내역 */}
      {user && tab !== "TIER" && tab !== "OVERALL" && (rewards.data?.length ?? 0) > 0 && (
        <div className="panel-surface mt-4 rounded-2xl p-4">
          <p className="font-display text-sm text-gold">상금 지급 내역 ({season?.week_key})</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {(rewards.data ?? []).map((r) => (
              <li key={r.id}>
                {RANKING_TYPES.find((t) => t.key === r.ranking_type)?.label ?? r.ranking_type}{" "}
                {r.rank_position}위 ·{" "}
                {r.reward_type === "POINTS"
                  ? formatPoints(Number(r.reward_amount))
                  : `충전 레이크 면제권 ${r.reward_amount}장`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 계급표 */}
      {tab === "TIER" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {RANK_TIERS.map((t) => (
            <div key={t.rank} className="panel-surface rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <RankBadge rank={t.rank} />
                <span className="text-xs text-gold">{formatPoints(t.pointsReward)}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t.summary}</p>
              <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground/80">
                {t.minChargeAmount > 0 && <li>누적 충전액 {formatWon(t.minChargeAmount)} 이상</li>}
                {t.minChargeCount > 0 && <li>누적 충전 {t.minChargeCount}회 이상</li>}
                {t.minAttendance > 0 && <li>누적 출석 {t.minAttendance}일 이상</li>}
                <li>계급 전용 아이템/이펙트 지급 (상점 판매 없음)</li>
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* 통산 랭킹 */}
      {tab === "OVERALL" && (
        <div className="panel-surface mt-4 overflow-hidden rounded-2xl">
          <table className="w-full text-sm">
            <thead className="bg-black/40 text-[11px] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">순위</th>
                <th className="px-4 py-3 text-left">플레이어</th>
                {SEASON_SORTS.map((s) => (
                  <th key={s.key} className="px-4 py-3 text-right">
                    {s.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-right">전적</th>
              </tr>
            </thead>
            <tbody>
              {(overall.data ?? []).map((p, i) => (
                <tr key={p.id} className="border-t border-border/50 odd:bg-white/[0.02]">
                  <td
                    className={cn(
                      "px-4 py-3 font-display",
                      i < 3 ? "text-gold" : "text-foreground/70",
                    )}
                  >
                    {i + 1}
                  </td>
                  <td className="px-4 py-3">
                    <span className="mr-2 inline-flex align-middle">
                      <RankBadge rank={(p.rank as never) ?? "UNRANKED"} size="sm" />
                    </span>
                    {p.nickname}
                  </td>
                  <td className="px-4 py-3 text-right text-gold-soft">
                    {p.rank_points.toLocaleString("ko-KR")}
                  </td>
                  <td className="px-4 py-3 text-right text-xs">{p.wins}</td>
                  <td className="px-4 py-3 text-right text-xs">{p.gwangttaeng_count}</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {p.wins}승 {p.losses}패 · 최고 {p.max_streak}연승
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

/** 보유 칭호 + 계급 보상 지급 내역 */
function TitleShelf({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const titles = useQuery({
    queryKey: ["my-titles", userId],
    queryFn: () => fetchMyTitles(userId),
  });
  const claims = useQuery({
    queryKey: ["rank-claims", userId],
    queryFn: () => fetchRankClaims(userId),
  });
  const equip = useMutation({
    mutationFn: equipTitle,
    onSuccess: () => {
      toast.success("칭호를 장착했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["my-titles", userId] });
      void queryClient.invalidateQueries({ queryKey: ["user-items"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "칭호 장착 실패"),
  });

  const rows = titles.data ?? [];

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="panel-surface rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <p className="font-display text-sm text-gold">내 칭호</p>
          <span className="text-[11px] text-muted-foreground">
            게임 좌석에 <span className="text-gold-soft">[칭호] | [닉네임]</span> 으로 표시됩니다
          </span>
        </div>
        {titles.isLoading ? (
          <p className="mt-4 text-xs text-muted-foreground">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            보유한 칭호가 없습니다. 계급 승급 또는 주간 랭킹 1위 보상으로 획득할 수 있습니다.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {rows.map((t) => (
              <li
                key={t.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-xl border px-3 py-2",
                  t.equipped
                    ? "border-gold/60 bg-gold/10"
                    : t.rarity === "RARE"
                      ? "border-crimson/60 bg-crimson/8"
                      : "border-border bg-black/30",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-xs text-foreground">
                    {t.name}
                    {t.rarity === "RARE" && <span className="ml-1 text-[10px] text-crimson">RARE</span>}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {TITLE_SOURCE_LABEL[t.source_type ?? ""] ?? t.source_type ?? "지급"}
                    {t.rank_required ? ` · ${tierOf(t.rank_required).label}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={t.equipped ? "goldOutline" : "table"}
                  disabled={t.equipped || equip.isPending}
                  onClick={() => equip.mutate(t.item_id)}
                >
                  {t.equipped ? "장착중" : "장착"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel-surface rounded-2xl p-5">
        <p className="font-display text-sm text-gold">계급 보상 지급 내역</p>
        {claims.isLoading ? (
          <p className="mt-4 text-xs text-muted-foreground">불러오는 중…</p>
        ) : (claims.data ?? []).length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            아직 지급된 계급 보상이 없습니다. “계급 확인/보상 수령”을 눌러 확인하세요.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-xs">
            {(claims.data ?? []).map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-black/30 px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <RankBadge rank={c.rank} size="sm" />
                  <span className="text-[10px] text-muted-foreground">
                    {new Intl.DateTimeFormat("ko-KR", {
                      timeZone: "Asia/Seoul",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(new Date(c.claimed_at))}
                  </span>
                </span>
                <span className="text-gold-soft">{formatPoints(Number(c.points_reward))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface RankRow {
  key: string;
  position: number;
  nickname: string;
  rank: string;
  cells: string[];
}

function RankTable({
  headers,
  rows,
  loading,
}: {
  headers: string[];
  rows: RankRow[];
  loading: boolean;
}) {
  return (
    <div className="panel-surface mt-4 overflow-hidden rounded-2xl">
      <table className="w-full text-sm">
        <thead className="bg-black/40 text-[11px] text-muted-foreground">
          <tr>
            {headers.map((h, i) => (
              <th key={h} className={cn("px-4 py-3", i <= 1 ? "text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border/50 odd:bg-white/[0.02]">
              <td
                className={cn(
                  "px-4 py-3 font-display",
                  r.position <= 3 ? "text-gold" : "text-foreground/70",
                )}
              >
                {r.position}
              </td>
              <td className="px-4 py-3">
                <span className="mr-2 inline-flex align-middle">
                  <RankBadge rank={r.rank as never} size="sm" />
                </span>
                {r.nickname}
              </td>
              {r.cells.map((c, i) => (
                <td key={i} className="px-4 py-3 text-right text-xs text-foreground/80">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          이번 주 집계된 기록이 없습니다.
        </p>
      )}
      {loading && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">집계 중...</p>
      )}
    </div>
  );
}
