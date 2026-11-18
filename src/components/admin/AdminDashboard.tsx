import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Empty, Panel, Table } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  activityLabel,
  fetchDashboardOverview,
  fetchRecentActivity,
  globalSearch,
} from "@/lib/services/adminDashboardService";
import {
  CRITICAL_ALERT_LABEL,
  fetchCriticalAlerts,
  formatDateTime,
} from "@/lib/services/adminService";
import { formatPoints, formatWon } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";

/** 대시보드 KPI 카드 */
function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gold" | "jade" | "crimson" }) {
  return (
    <div className="panel-surface rounded-xl px-4 py-3">
      <p className="text-[10px] tracking-widest text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-display mt-1 text-lg",
          tone === "jade" ? "text-jade" : tone === "crimson" ? "text-crimson" : "text-gold",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** 운영 상태 카드 (정상/주의) */
function StatusCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2",
        ok ? "border-jade/30 bg-jade/8" : "border-destructive/40 bg-destructive/10",
      )}
    >
      <p className="text-[10px] tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("font-display mt-1 text-xs", ok ? "text-jade" : "text-destructive-foreground")}>{value}</p>
    </div>
  );
}

const QUICK_LINKS = [
  { id: "members", label: "회원관리" },
  { id: "withdrawals", label: "출금대기" },
  { id: "crypto", label: "USDT 자동충전" },
  { id: "affiliates", label: "총판 미정산" },
  { id: "live", label: "실시간 게임" },
  { id: "items", label: "상점관리" },
  { id: "weekly", label: "랭킹관리" },
  { id: "health", label: "시스템상태" },
  { id: "logs", label: "운영로그" },
] as const;

export function AdminDashboard({ onNavigate }: { onNavigate: (menu: string) => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");

  const overview = useQuery({
    queryKey: ["admin-dashboard-overview"],
    queryFn: fetchDashboardOverview,
    refetchInterval: 30_000,
  });
  const alerts = useQuery({
    queryKey: ["admin-critical-alerts", "OPERATION"],
    queryFn: () => fetchCriticalAlerts("OPERATION"),
    refetchInterval: 30_000,
  });
  const activity = useQuery({
    queryKey: ["admin-recent-activity"],
    queryFn: () => fetchRecentActivity(50),
    refetchInterval: 30_000,
  });
  const search = useQuery({
    queryKey: ["admin-global-search", term],
    enabled: term.trim().length >= 2,
    queryFn: () => globalSearch(term.trim()),
  });

  const d = overview.data;
  const ops = d?.ops;
  const watcherOnline =
    !!ops?.watcherLastSuccessAt && Date.now() - new Date(ops.watcherLastSuccessAt).getTime() < 10 * 60 * 1000;
  const realtimeOk = (ops?.recentGameErrors ?? 0) === 0;
  const criticalCount = alerts.data?.criticalCount ?? 0;
  const result = search.data;

  return (
    <div className="space-y-5">
      {/* 통합 검색 */}
      <Panel title="운영 통합 검색" desc="회원 아이디/닉네임 · 방 번호 · 총판 코드 · USDT txid · 출금 ID로 검색합니다.">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-80"
            value={q}
            placeholder="예: angeladmin / 1024 / TXID / 출금 UUID"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setTerm(q);
            }}
          />
          <Button size="sm" variant="gold" onClick={() => setTerm(q)}>
            검색
          </Button>
          {term && (
            <Button
              size="sm"
              variant="table"
              onClick={() => {
                setTerm("");
                setQ("");
              }}
            >
              초기화
            </Button>
          )}
        </div>

        {term.trim().length >= 2 && (
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div className="rounded-xl border border-border bg-black/30 p-3">
              <p className="mb-2 text-[11px] tracking-widest text-gold-soft">회원 {result?.members.length ?? 0}</p>
              {(result?.members ?? []).map((m) => (
                <button
                  key={m.id}
                  onClick={() => onNavigate("members")}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-white/5"
                >
                  <span className="text-foreground">
                    [{m.rank}] {m.nickname}
                    {m.username ? ` · ${m.username}` : ""}
                  </span>
                  <span className="text-gold-soft">{formatPoints(m.game_points)}</span>
                </button>
              ))}
              {result?.members.length === 0 && <p className="text-xs text-muted-foreground">일치하는 회원이 없습니다.</p>}
            </div>
            <div className="rounded-xl border border-border bg-black/30 p-3">
              <p className="mb-2 text-[11px] tracking-widest text-gold-soft">게임방 {result?.rooms.length ?? 0}</p>
              {(result?.rooms ?? []).map((r) => (
                <button
                  key={r.id}
                  onClick={() => onNavigate("rooms")}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-white/5"
                >
                  <span className="text-foreground">
                    {r.room_number}번 · {r.title}
                  </span>
                  <span className="text-muted-foreground">
                    {r.status} · {r.current_players}명
                  </span>
                </button>
              ))}
              {result?.rooms.length === 0 && <p className="text-xs text-muted-foreground">일치하는 방이 없습니다.</p>}
            </div>
            <div className="rounded-xl border border-border bg-black/30 p-3">
              <p className="mb-2 text-[11px] tracking-widest text-gold-soft">총판 {result?.affiliates.length ?? 0}</p>
              {(result?.affiliates ?? []).map((a) => (
                <button
                  key={a.id}
                  onClick={() => onNavigate("affiliates")}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-white/5"
                >
                  <span className="text-foreground">
                    {a.affiliate_code} · {a.nickname ?? "-"}
                  </span>
                  <span className="text-muted-foreground">{a.status}</span>
                </button>
              ))}
              {result?.affiliates.length === 0 && <p className="text-xs text-muted-foreground">일치하는 총판이 없습니다.</p>}
            </div>
            <div className="rounded-xl border border-border bg-black/30 p-3">
              <p className="mb-2 text-[11px] tracking-widest text-gold-soft">
                USDT 거래 {result?.transactions.length ?? 0} · 출금 {result?.withdrawals.length ?? 0}
              </p>
              {(result?.transactions ?? []).map((t) => (
                <button
                  key={t.id}
                  onClick={() => onNavigate("crypto")}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-white/5"
                >
                  <span className="font-mono text-[10px] text-foreground">{(t.txid ?? t.id).slice(0, 18)}…</span>
                  <span className="text-muted-foreground">
                    {t.nickname ?? "-"} · {formatWon(t.requested_krw)} · {t.status}
                  </span>
                </button>
              ))}
              {(result?.withdrawals ?? []).map((w) => (
                <button
                  key={w.id}
                  onClick={() => onNavigate("withdrawals")}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-white/5"
                >
                  <span className="font-mono text-[10px] text-foreground">{w.id.slice(0, 18)}…</span>
                  <span className="text-muted-foreground">
                    {w.nickname ?? "-"} · {formatWon(w.payout_amount)} · {w.status}
                  </span>
                </button>
              ))}
              {result && result.transactions.length === 0 && result.withdrawals.length === 0 && (
                <p className="text-xs text-muted-foreground">일치하는 거래/출금이 없습니다.</p>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* KPI */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="전체 회원"
          value={`${(d?.members ?? 0).toLocaleString("ko-KR")}명`}
          sub={`오늘 신규 ${d?.newSignupsToday ?? 0}명`}
        />
        <Kpi label="현재 온라인" value={`${d?.onlineNow ?? 0}명`} sub="최근 5분 활동" />
        <Kpi label="현재 게임중" value={`${d?.inGameNow ?? 0}명`} sub={`진행 방 ${d?.playingRooms ?? 0}개`} />
        <Kpi label="활성 방" value={`${d?.activeRooms ?? 0}개`} sub={`오늘 게임 ${d?.roundsToday ?? 0}판`} />
        <Kpi
          label="오늘 USDT 충전"
          value={formatWon(d?.usdtChargeToday ?? 0)}
          sub={`${d?.usdtChargeTodayCount ?? 0}건`}
          tone="jade"
        />
        <Kpi
          label="오늘 출금"
          value={formatWon(d?.withdrawPaidToday ?? 0)}
          sub={`신청 ${formatWon(d?.withdrawRequestedToday ?? 0)} · 대기 ${d?.pendingWithdrawCount ?? 0}건`}
          tone="crimson"
        />
        <Kpi label="유통 게임 포인트" value={formatPoints(d?.circulatingPoints ?? 0)} />
        <Kpi label="잠금 포인트" value={formatPoints(d?.lockedPoints ?? 0)} sub="출금 신청 등으로 잠긴 포인트" />
        <Kpi
          label="총판 미정산 커미션"
          value={formatWon(d?.affiliateUnsettled ?? 0)}
          sub={`${d?.affiliateUnsettledCount ?? 0}건`}
        />
        <Kpi label="대기 충전 신청" value={`${d?.pendingChargeCount ?? 0}건`} />
        <Kpi
          label="현재 CRITICAL"
          value={`${criticalCount}건`}
          tone={criticalCount === 0 ? "jade" : "crimson"}
          sub="해결된 테스트 이력 제외"
        />
        <Kpi label="정지 라운드" value={`${ops?.stuckRounds ?? 0}건`} tone={(ops?.stuckRounds ?? 0) === 0 ? "jade" : "crimson"} />
      </div>

      {/* 운영 상태 */}
      <Panel
        title="운영 상태"
        desc={`갱신 ${d ? formatDateTime(d.checkedAt) : "-"} · 30초 자동 갱신`}
        actions={
          <Button size="sm" variant="table" onClick={() => void overview.refetch()}>
            새로고침
          </Button>
        }
      >
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
          <StatusCard label="GAME CORE" value={`${ops?.gameCoreVersion ?? "-"} / READY`} ok={ops?.gameCoreVersion === "STABLE_1"} />
          <StatusCard
            label="GAME SECURITY"
            value={`${ops?.gameSecurityVersion ?? "-"} / READY`}
            ok={ops?.gameSecurityVersion === "GAME_SECURITY_1"}
          />
          <StatusCard label="REALTIME" value={realtimeOk ? "ONLINE" : "DEGRADED"} ok={realtimeOk} />
          <StatusCard
            label="USDT WATCHER"
            value={ops?.cryptoEnabled ? (watcherOnline ? "ONLINE" : "OFFLINE") : "DISABLED"}
            ok={!ops?.cryptoEnabled || watcherOnline}
          />
          <StatusCard label="CRITICAL" value={`${criticalCount}건`} ok={criticalCount === 0} />
          <StatusCard
            label="TEST DRIVER"
            value={ops?.testDriverEnabled ? "ENABLED" : "DISABLED"}
            ok={!ops?.testDriverEnabled}
          />
          <StatusCard
            label="APP MODE / 점검"
            value={`${ops?.appMode ?? "-"}${ops?.maintenance ? " · 점검중" : ""}${ops?.gameLock ? " · 게임잠금" : ""}`}
            ok={!ops?.maintenance && !ops?.gameLock}
          />
          <StatusCard
            label="최근 WATCHER 성공"
            value={ops?.watcherLastSuccessAt ? formatDateTime(ops.watcherLastSuccessAt) : "기록 없음"}
            ok={watcherOnline || !ops?.cryptoEnabled}
          />
          <StatusCard
            label="미해결 무결성"
            value={`${ops?.openFindings ?? 0}건`}
            ok={(ops?.openFindings ?? 0) === 0}
          />
          <StatusCard
            label="최근 15분 게임 오류"
            value={`${ops?.recentGameErrors ?? 0}건`}
            ok={(ops?.recentGameErrors ?? 0) === 0}
          />
          <StatusCard label="DB 백업" value="Supabase 자동 백업 (docs/OPERATIONS_RECOVERY.md)" ok />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(alerts.data?.alerts ?? []).map((a) => (
            <div
              key={a.code}
              className={cn(
                "rounded-lg border px-3 py-2 text-[11px]",
                a.level === "OK" || a.level === "OFF"
                  ? "border-border bg-black/30 text-muted-foreground"
                  : "border-destructive/40 bg-destructive/10 text-destructive-foreground",
              )}
            >
              <p className="tracking-widest">{CRITICAL_ALERT_LABEL[a.code] ?? a.code}</p>
              <p className="font-display mt-0.5">
                {a.level} · {a.count}건
              </p>
              <p className="mt-0.5 text-[10px] opacity-80">{a.detail}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* 빠른 이동 */}
      <Panel title="빠른 이동">
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map((l) => (
            <Button key={l.id} size="sm" variant="table" onClick={() => onNavigate(l.id)}>
              {l.label}
            </Button>
          ))}
        </div>
      </Panel>

      {/* 최근 중요 활동 */}
      <Panel title="최근 중요 활동" desc="가입 · USDT 충전 · 출금 · 관리자 처리 · 자동 퇴장 · 시스템 경고 최신 50건">
        <Table head={["시간", "구분", "회원/대상", "내용", "결과"]}>
          {(activity.data ?? []).map((r, i) => (
            <tr key={`${r.at}-${i}`}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.at)}</td>
              <td className="px-3 py-2 text-gold-soft">{activityLabel(r.kind)}</td>
              <td className="px-3 py-2 text-foreground">{r.who ?? "-"}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.detail || "-"}</td>
              <td className="px-3 py-2">{r.result ?? "-"}</td>
            </tr>
          ))}
          {activity.data?.length === 0 && <Empty colSpan={5} />}
        </Table>
      </Panel>
    </div>
  );
}
