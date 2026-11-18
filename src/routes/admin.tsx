import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  bootstrapSuperAdmin,
  fetchMyLastAdminLogin,
  listAdmins,
  logAdminEvent,
  ROLE_LABEL,
  setRole,
  superAdminExists,
  type AdminRole,
} from "@/lib/services/roleService";
import { toast } from "sonner";
import { AdminCrypto } from "@/components/admin/AdminCrypto";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminItems } from "@/components/admin/AdminItems";
import { AdminCustomTitles } from "@/components/admin/AdminCustomTitles";
import { AdminCustomProfiles } from "@/components/admin/AdminCustomProfiles";
import { AdminLogSearch } from "@/components/admin/AdminLogSearch";
import { AdminMembers } from "@/components/admin/AdminMembers";
import { AdminRoomLogs } from "@/components/admin/AdminRoomLogs";
import { AdminDoriRooms } from "@/components/admin/AdminDoriRooms";
import { AdminRooms } from "@/components/admin/AdminRooms";
import { AdminSupportPopups } from "@/components/admin/AdminSupportPopups";
import { GameErrorLogPanel } from "@/components/admin/GameErrorLogPanel";
import { SystemHealthPanel } from "@/components/admin/SystemHealthPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchAdminWithdrawals,
  formatPoints,
  formatUsdt,
  formatWon,
  processCharge,
  processWithdrawal,
  WITHDRAW_STATUS_LABEL,
  type AdminWithdrawalRow,
} from "@/lib/services/walletService";
import { CopyAddressButton } from "@/components/common/CopyButton";
import {
  CHARGE_FLOW,
  formatDateTime,
  handleReport,
  recalcSeasonRankings,
  setSeasonStatus,
  TX_TYPE_LABEL,
  USER_STATUS_LABEL,
  updateAdminSetting,
  updateCardAsset,
  updateRoomType,
  WITHDRAW_FLOW,
} from "@/lib/services/adminService";
import {
  fetchAdminAffiliates,
  fetchAffiliateOverview,
  formatRebateRate,
  setAffiliateRebateRate,
  REBATE_RATE_DEFAULT,
  REBATE_RATE_MAX,
  REBATE_RATE_MIN,
} from "@/lib/services/affiliateService";
import {
  adminFinalizeWeeklySeason,
  adminPayWeeklyRewards,
  adminRecalcWeeklySeason,
  fetchDepositRanking,
  fetchGwangRanking,
  fetchProfitRanking,
  fetchSeasonRewards,
  fetchSeasons,
  MIN_RANKING_PARTICIPANTS,
  RANKING_TYPES,
  SEASON_STATUS_LABEL,
  type RankingType,
} from "@/lib/services/rankingService";
import { adjustPointsV2 } from "@/lib/services/cryptoChargeService";
import { cn } from "@/lib/utils";
import { GAME_ROOM_COLUMNS } from "@/lib/rooms/roomColumns";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "운영 콘솔 · 엔젤섯다 ANGEL SUTDA" },
      { name: "description", content: "회원·포인트·충전출금·게임 운영을 처리하는 엔젤섯다 관리자 콘솔." },
      { property: "og:title", content: "운영 콘솔 · 엔젤섯다" },
      { property: "og:description", content: "엔젤섯다 운영 관리 페이지." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

const MENU = [
  { id: "dashboard", label: "대시보드", group: "운영 현황" },
  { id: "live", label: "실시간 모니터링", group: "운영 현황" },
  { id: "health", label: "서버 상태/무결성", group: "운영 현황" },
  { id: "members", label: "회원 관리", group: "회원 관리" },
  { id: "points", label: "포인트 지급/회수", group: "회원 관리" },
  { id: "reports", label: "신고 처리", group: "회원 관리" },
  { id: "rooms", label: "방 관리", group: "게임 관리" },
  { id: "doriRooms", label: "도리짓고땡 방 관리", group: "게임 관리" },
  { id: "roomTypes", label: "방 등급 설정", group: "게임 관리" },
  { id: "rounds", label: "게임 기록", group: "게임 관리" },
  { id: "roomLogs", label: "방 진행 로그", group: "게임 관리" },
  { id: "errors", label: "게임 오류 로그", group: "게임 관리" },
  { id: "charges", label: "충전 신청", group: "재무 관리" },
  { id: "crypto", label: "USDT 자동충전", group: "재무 관리" },
  { id: "withdrawals", label: "출금 신청", group: "재무 관리" },
  { id: "ledger", label: "포인트 원장", group: "재무 관리" },
  { id: "affiliates", label: "총판 관리", group: "재무 관리" },
  { id: "items", label: "상점 관리", group: "콘텐츠" },
  { id: "customTitles", label: "커스텀 칭호", group: "콘텐츠" },
  { id: "customProfiles", label: "커스텀 프로필", group: "콘텐츠" },
  { id: "cards", label: "카드 자산", group: "콘텐츠" },
  { id: "notices", label: "공지 관리", group: "콘텐츠" },
  { id: "support", label: "고객센터/이벤트 팝업", group: "콘텐츠" },
  { id: "weekly", label: "주간 랭킹/계급", group: "랭킹/계급" },
  { id: "seasons", label: "시즌/랭킹", group: "랭킹/계급" },
  { id: "settings", label: "시스템 설정", group: "시스템" },
  { id: "logs", label: "운영 로그", group: "시스템" },
  { id: "admins", label: "관리자 계정", group: "시스템", superOnly: true },
] as const;

type MenuId = (typeof MENU)[number]["id"];

function Admin() {
  const { user, profile, isAdmin, isSuperAdmin, role, loading, roleLoading } = useAuth();
  const [menu, setMenu] = useState<MenuId>("dashboard");
  const logged = useRef(false);

  const lastLogin = useQuery({
    queryKey: ["admin-last-login", user?.id],
    enabled: !!user && isAdmin,
    queryFn: () => fetchMyLastAdminLogin(user!.id),
  });

  // 관리자 콘솔 진입 시 서버에 ADMIN_LOGIN 기록 (세션당 1회)
  useEffect(() => {
    if (!isAdmin || logged.current) return;
    logged.current = true;
    void logAdminEvent("ADMIN_LOGIN").catch(() => undefined);
  }, [isAdmin]);

  if (loading || (user && roleLoading)) {
    return <CenterCard title="확인 중…" body="권한을 확인하고 있습니다." />;
  }
  if (!user) {
    return <CenterCard title="로그인이 필요합니다" body="관리자 계정으로 로그인해 주세요." />;
  }
  if (!isAdmin) {
    return <AccessDenied />;
  }

  const visibleMenu = MENU.filter((m) => !("superOnly" in m && m.superOnly) || isSuperAdmin);
  const groups = [...new Set(visibleMenu.map((m) => m.group))];

  return (
    <div className="min-h-screen bg-[oklch(0.16_0.01_60)] text-foreground">
      <div className="mx-auto flex max-w-[1920px]">
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-gold/15 bg-black/60 px-3 py-5">
          <Link to="/" className="mb-6 flex items-center gap-2 px-2">
            <img src="/brand/angel-sutda-logo.png" alt="엔젤섯다" className="h-10 w-auto" />
          </Link>
          <nav className="flex-1 space-y-4 pb-6">
            {groups.map((group) => (
              <div key={group}>
                <p className="px-2 pb-1 text-[10px] font-semibold tracking-widest text-gold-soft/60">
                  {group.toUpperCase()}
                </p>
                {visibleMenu.filter((m) => m.group === group).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMenu(m.id)}
                    className={cn(
                      "block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      menu === m.id
                        ? "bg-gold/12 font-semibold text-gold"
                        : "text-foreground/70 hover:bg-white/5 hover:text-gold",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-8 py-7">
          <header className="mb-6 flex items-center justify-between gap-4">
            <h1 className="text-gold-plate font-display text-2xl">
              {MENU.find((m) => m.id === menu)?.label}
            </h1>
            <div className="flex items-center gap-4">
              <div className="text-right leading-tight">
                <p className="font-display text-sm text-gold">
                  {profile?.nickname ?? "관리자"}
                  <span className="ml-2 rounded border border-gold/40 px-1.5 py-0.5 text-[10px] tracking-widest text-gold-soft">
                    {ROLE_LABEL[role as AdminRole]}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  마지막 로그인 · {lastLogin.data ? formatDateTime(lastLogin.data) : "기록 없음"}
                </p>
              </div>
              <Button variant="table" size="sm" asChild>
                <Link to="/">서비스로 돌아가기</Link>
              </Button>
            </div>
          </header>
          {menu === "dashboard" && <Dashboard onNavigate={(id) => setMenu(id as MenuId)} />}
          {menu === "members" && <AdminMembers isSuperAdmin={isSuperAdmin} />}
          {menu === "points" && <PointAdjust />}
          {menu === "charges" && <Charges />}
          {menu === "crypto" && <AdminCrypto isSuperAdmin={isSuperAdmin} />}
          {menu === "withdrawals" && <Withdrawals />}
          {menu === "ledger" && <Ledger />}
          {menu === "doriRooms" && <AdminDoriRooms />}
          {menu === "roomTypes" && <RoomTypes />}
          {menu === "rooms" && <AdminRooms isSuperAdmin={isSuperAdmin} />}
          {menu === "roomLogs" && <AdminRoomLogs />}
          {menu === "live" && <LiveMonitor />}
          {menu === "rounds" && <Rounds />}
          {menu === "cards" && <CardAssets />}
          {menu === "items" && <AdminItems isSuperAdmin={isSuperAdmin} />}
          {menu === "customTitles" && <AdminCustomTitles />}
          {menu === "customProfiles" && <AdminCustomProfiles />}
          {menu === "notices" && <Notices />}
          {menu === "support" && <AdminSupportPopups />}
          {menu === "affiliates" && <Affiliates />}
          {menu === "reports" && <Reports />}
          {menu === "seasons" && <Seasons />}
          {menu === "weekly" && <WeeklyRankingAdmin />}
          {menu === "settings" && <Settings />}
          {menu === "health" && <SystemHealthPanel />}
          {menu === "errors" && <GameErrorLogPanel />}
          {menu === "logs" && <AdminLogSearch />}
          {menu === "admins" && isSuperAdmin && <AdminAccounts />}
        </main>
      </div>
    </div>
  );
}

/* ---------- 접근 차단 / 초기 최고관리자 ---------- */

function AccessDenied() {
  const queryClient = useQueryClient();
  const exists = useQuery({ queryKey: ["super-admin-exists"], queryFn: superAdminExists });
  const bootstrap = useMutation({
    mutationFn: bootstrapSuperAdmin,
    onSuccess: async () => {
      toast.success("최고관리자로 등록되었습니다.");
      await queryClient.invalidateQueries({ queryKey: ["my-role"] });
      await queryClient.invalidateQueries({ queryKey: ["super-admin-exists"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "초기 설정에 실패했습니다."),
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="panel-surface w-full max-w-md rounded-2xl p-10 text-center">
        <h1 className="font-display text-xl text-gold">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          이 계정에는 관리자 권한이 없습니다. 권한은 서버(user_roles)에서만 부여됩니다.
        </p>
        {exists.data === false && (
          <div className="mt-6 rounded-xl border border-gold/25 bg-black/40 p-4 text-left">
            <p className="font-display text-sm text-gold">초기 최고관리자 설정</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              아직 최고관리자가 없습니다. 현재 로그인한 계정을 최고관리자로 등록할 수 있습니다. 이
              절차는 최초 1회만 사용할 수 있으며, 이후 서버에서 영구히 차단됩니다.
            </p>
            <Button
              variant="gold"
              size="sm"
              className="mt-3 w-full"
              disabled={bootstrap.isPending}
              onClick={() => bootstrap.mutate()}
            >
              이 계정을 최고관리자로 등록
            </Button>
          </div>
        )}
        <Button variant="table" size="sm" className="mt-6" asChild>
          <Link to="/">서비스로 돌아가기</Link>
        </Button>
      </div>
    </div>
  );
}

/* ---------- 관리자 계정 관리 (super_admin 전용) ---------- */

function AdminAccounts() {
  const queryClient = useQueryClient();
  const admins = useQuery({ queryKey: ["admin-accounts"], queryFn: listAdmins });
  const [targetUsername, setTargetUsername] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("admin");
  const [reason, setReason] = useState("");

  const change = useMutation({
    mutationFn: async (input: { userId: string; role: AdminRole; reason: string }) =>
      setRole(input.userId, input.role, input.reason),
    onSuccess: async () => {
      toast.success("권한이 변경되었습니다.");
      setReason("");
      setTargetUsername("");
      await queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["my-role"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "권한 변경에 실패했습니다."),
  });

  async function grantByUsername() {
    const username = targetUsername.trim().toLowerCase();
    if (!username) {
      toast.error("아이디를 입력해 주세요.");
      return;
    }
    if (!reason.trim()) {
      toast.error("변경 사유는 필수입니다.");
      return;
    }
    // 아이디 검색은 관리자 전용 RPC 로만 수행한다 (profiles.username 직접 조회 차단)
    const { data, error } = await supabase.rpc("admin_find_user_by_username", {
      _username: username,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error("해당 아이디의 회원을 찾을 수 없습니다.");
      return;
    }
    change.mutate({ userId: data as string, role: newRole, reason: reason.trim() });
  }

  return (
    <div className="space-y-5">
      <Panel title="관리자 지정" desc="아이디로 회원을 찾아 관리자 권한을 부여합니다. 비밀번호는 조회·노출되지 않습니다.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Label>회원 아이디</Label>
            <Input
              value={targetUsername}
              onChange={(e) => setTargetUsername(e.target.value)}
              placeholder="angeladmin"
            />
          </div>
          <div className="w-44">
            <Label>부여 역할</Label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as AdminRole)}
              className="h-10 w-full rounded-md border border-gold/25 bg-black/40 px-3 text-sm"
            >
              <option value="admin">ADMIN</option>
              <option value="super_admin">SUPER ADMIN</option>
              <option value="affiliate">총판</option>
              <option value="user">일반 회원 (회수)</option>
            </select>
          </div>
          <div className="min-w-[240px] flex-1">
            <Label>사유 (필수)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button variant="gold" size="sm" disabled={change.isPending} onClick={grantByUsername}>
            적용
          </Button>
        </div>
      </Panel>

      <Panel title="관리자 목록" desc="현재 관리자 권한을 가진 계정과 최근 로그인 기록입니다.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-gold/15">
                <th className="py-2 text-left">아이디</th>
                <th className="py-2 text-left">닉네임</th>
                <th className="py-2 text-left">역할</th>
                <th className="py-2 text-left">상태</th>
                <th className="py-2 text-left">최근 로그인</th>
                <th className="py-2 text-right">권한 변경</th>
              </tr>
            </thead>
            <tbody>
              {(admins.data ?? []).map((a) => (
                <tr key={a.user_id} className="border-b border-white/5">
                  <td className="py-2">{a.username ?? "-"}</td>
                  <td className="py-2">{a.nickname}</td>
                  <td className="py-2 text-gold">{ROLE_LABEL[a.role as AdminRole]}</td>
                  <td className="py-2">{USER_STATUS_LABEL[a.status] ?? a.status}</td>
                  <td className="py-2">
                    {a.last_login_at ? formatDateTime(a.last_login_at) : "기록 없음"}
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-2">
                      {a.role !== "super_admin" && (
                        <Button
                          variant="table"
                          size="sm"
                          onClick={() => {
                            if (!reason.trim()) {
                              toast.error("상단에 사유를 입력해 주세요.");
                              return;
                            }
                            change.mutate({
                              userId: a.user_id,
                              role: "super_admin",
                              reason: reason.trim(),
                            });
                          }}
                        >
                          SUPER 승격
                        </Button>
                      )}
                      <Button
                        variant="table"
                        size="sm"
                        onClick={() => {
                          if (!reason.trim()) {
                            toast.error("상단에 사유를 입력해 주세요.");
                            return;
                          }
                          change.mutate({ userId: a.user_id, role: "user", reason: reason.trim() });
                        }}
                      >
                        권한 회수
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {admins.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    관리자 계정이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

/* ---------- 공통 UI ---------- */

function CenterCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="panel-surface rounded-2xl p-10 text-center">
        <h1 className="font-display text-xl text-gold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Panel({
  title,
  desc,
  children,
  className,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel-surface rounded-2xl p-5", className)}>
      <div className="mb-3">
        <h2 className="font-display text-lg text-gold">{title}</h2>
        {desc && <p className="mt-1 text-[11px] text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel-surface rounded-xl px-5 py-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-display mt-1 text-2xl text-gold">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-gold-soft/70">{sub}</p>}
    </div>
  );
}

/** 주간 랭킹 시즌 집계 / 확정 / 상금 지급 + 계급 승급 현황 */
function WeeklyRankingAdmin() {
  const queryClient = useQueryClient();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [view, setView] = useState<RankingType>("DEPOSIT");

  const seasons = useQuery({ queryKey: ["admin-weekly-seasons"], queryFn: () => fetchSeasons(20) });
  const season = useMemo(
    () => (seasons.data ?? []).find((s) => s.id === seasonId) ?? (seasons.data ?? [])[0] ?? null,
    [seasons.data, seasonId],
  );

  const deposit = useQuery({
    queryKey: ["admin-weekly-deposit", season?.id],
    enabled: !!season && view === "DEPOSIT",
    queryFn: () => fetchDepositRanking(season!.id, 30),
  });
  const gwang = useQuery({
    queryKey: ["admin-weekly-gwang", season?.id],
    enabled: !!season && view === "GWANG",
    queryFn: () => fetchGwangRanking(season!.id, 30),
  });
  const profit = useQuery({
    queryKey: ["admin-weekly-profit", season?.id],
    enabled: !!season && view === "PROFIT",
    queryFn: () => fetchProfitRanking(season!.id, 30),
  });
  const rewards = useQuery({
    queryKey: ["admin-season-rewards", season?.id],
    enabled: !!season,
    queryFn: () => fetchSeasonRewards(season!.id),
  });
  const promotions = useQuery({
    queryKey: ["admin-rank-promotions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rank_promotions")
        .select("id, user_id, from_rank, to_rank, created_at, charge_amount_at, attendance_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-weekly-seasons"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-weekly-deposit"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-weekly-gwang"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-weekly-profit"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-season-rewards"] });
  };

  const recalc = useMutation({
    mutationFn: () => adminRecalcWeeklySeason(season!.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success("집계를 갱신했습니다.");
      setReason("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "집계 실패"),
  });

  const finalize = useMutation({
    mutationFn: () => adminFinalizeWeeklySeason(season!.id),
    onSuccess: () => {
      toast.success("시즌을 확정했습니다.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "확정 실패"),
  });

  const pay = useMutation({
    mutationFn: () => adminPayWeeklyRewards(season!.id),
    onSuccess: () => {
      toast.success("상금 지급을 처리했습니다.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "지급 실패"),
  });

  const enough = (n: number) => n >= MIN_RANKING_PARTICIPANTS;

  return (
    <div className="space-y-5">
      <Panel
        title="주간 시즌 관리"
        desc="한국시간 월요일 00:00 ~ 일요일 23:59 · 참여자 20명 이상일 때만 상금이 지급됩니다. 확정 시즌 정정은 최고관리자 + 사유 입력이 필요합니다."
      >
        <div className="flex flex-wrap gap-2">
          {(seasons.data ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => setSeasonId(s.id)}
              className={cn(
                "rounded-lg border px-3 py-1 text-[11px]",
                season?.id === s.id
                  ? "border-gold/60 bg-gold/12 text-gold"
                  : "border-border bg-black/30 text-muted-foreground hover:text-foreground",
              )}
            >
              {s.week_key} · {SEASON_STATUS_LABEL[s.status] ?? s.status}
            </button>
          ))}
        </div>

        {season && (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <Kpi
                label="주간 총 승인 충전액"
                value={formatWon(Number(season.total_charge_amount))}
                sub={`입금랭커 1위 상금 = ${(Number(season.reward_rate) * 100).toFixed(0)}%`}
              />
              <Kpi
                label="입금랭커 참여자"
                value={`${season.deposit_participants}명`}
                sub={enough(season.deposit_participants) ? "지급 조건 충족" : "20명 미달 · 미지급"}
              />
              <Kpi
                label="광땡랭커 참여자"
                value={`${season.gwang_participants}명`}
                sub={enough(season.gwang_participants) ? "지급 조건 충족" : "20명 미달 · 미지급"}
              />
              <Kpi
                label="수익왕 참여자"
                value={`${season.profit_participants}명`}
                sub={enough(season.profit_participants) ? "지급 조건 충족" : "20명 미달 · 미지급"}
              />
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="w-72 space-y-1.5">
                <Label htmlFor="weekly-reason">정정 사유 (확정 시즌 재집계 시 필수)</Label>
                <Input
                  id="weekly-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="예: 충전 승인 누락 반영"
                />
              </div>
              <Button
                variant="table"
                size="sm"
                disabled={recalc.isPending}
                onClick={() => recalc.mutate()}
              >
                집계 갱신
              </Button>
              <Button
                variant="goldOutline"
                size="sm"
                disabled={finalize.isPending || season.status === "REWARDED"}
                onClick={() => finalize.mutate()}
              >
                시즌 확정
              </Button>
              <Button
                variant="gold"
                size="sm"
                disabled={pay.isPending || !["FINALIZED", "REWARDED"].includes(season.status)}
                onClick={() => pay.mutate()}
              >
                상금 지급
              </Button>
            </div>
          </>
        )}
      </Panel>

      <Panel title="랭킹 상세" desc="입금랭커 · 광땡랭커 · 수익왕 실시간 집계">
        <div className="mb-3 flex gap-2">
          {RANKING_TYPES.map((t) => (
            <Button
              key={t.key}
              variant={view === t.key ? "gold" : "table"}
              size="sm"
              onClick={() => setView(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {view === "DEPOSIT" && (
          <Table head={["순위", "회원", "충전액", "출금액", "순입금", "충전횟수"]}>
            {(deposit.data ?? []).map((r) => (
              <tr key={r.user_id} className="border-t border-border/40">
                <td className="px-3 py-2 text-gold">{Number(r.rank_position)}</td>
                <td className="px-3 py-2">{r.nickname}</td>
                <td className="px-3 py-2">{formatWon(Number(r.charge_amount))}</td>
                <td className="px-3 py-2">{formatWon(Number(r.withdraw_amount))}</td>
                <td className="px-3 py-2 text-gold-soft">{formatWon(Number(r.net_deposit))}</td>
                <td className="px-3 py-2">{r.charge_count}회</td>
              </tr>
            ))}
          </Table>
        )}
        {view === "GWANG" && (
          <Table head={["순위", "회원", "38광땡", "18광땡", "13광땡", "총 광땡승", "게임수"]}>
            {(gwang.data ?? []).map((r) => (
              <tr key={r.user_id} className="border-t border-border/40">
                <td className="px-3 py-2 text-gold">{Number(r.rank_position)}</td>
                <td className="px-3 py-2">{r.nickname}</td>
                <td className="px-3 py-2">{r.gwang38_wins}</td>
                <td className="px-3 py-2">{r.gwang18_wins}</td>
                <td className="px-3 py-2">{r.gwang13_wins}</td>
                <td className="px-3 py-2 text-gold-soft">{r.total_gwang_wins}</td>
                <td className="px-3 py-2">{r.games_played}</td>
              </tr>
            ))}
          </Table>
        )}
        {view === "PROFIT" && (
          <Table head={["순위", "회원", "승리 획득 포인트", "승리수", "게임수"]}>
            {(profit.data ?? []).map((r) => (
              <tr key={r.user_id} className="border-t border-border/40">
                <td className="px-3 py-2 text-gold">{Number(r.rank_position)}</td>
                <td className="px-3 py-2">{r.nickname}</td>
                <td className="px-3 py-2 text-gold-soft">{formatPoints(Number(r.win_points))}</td>
                <td className="px-3 py-2">{r.win_count}</td>
                <td className="px-3 py-2">{r.games_played}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="상금 지급 내역" desc="같은 순위 상금은 중복 지급되지 않습니다.">
          <Table head={["구분", "순위", "보상", "지급시각"]}>
            {(rewards.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border/40">
                <td className="px-3 py-2">
                  {RANKING_TYPES.find((t) => t.key === r.ranking_type)?.label ?? r.ranking_type}
                </td>
                <td className="px-3 py-2">{r.rank_position}위</td>
                <td className="px-3 py-2 text-gold-soft">
                  {r.reward_type === "POINTS"
                    ? formatPoints(Number(r.reward_amount))
                    : `충전 레이크 면제권 ${r.reward_amount}장`}
                </td>
                <td className="px-3 py-2">{formatDateTime(r.paid_at)}</td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Panel title="최근 계급 승급" desc="강등 없음 · 순차 승급만 허용됩니다.">
          <Table head={["회원", "승급", "누적충전", "출석", "시각"]}>
            {(promotions.data ?? []).map((p) => (
              <tr key={p.id} className="border-t border-border/40">
                <td className="px-3 py-2 font-mono text-[10px]">{p.user_id.slice(0, 8)}</td>
                <td className="px-3 py-2 text-gold-soft">
                  {p.from_rank} → {p.to_rank}
                </td>
                <td className="px-3 py-2">{formatWon(Number(p.charge_amount_at))}</td>
                <td className="px-3 py-2">{p.attendance_at}일</td>
                <td className="px-3 py-2">{formatDateTime(p.created_at)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </div>
  );
}



function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead>
          <tr className="border-b border-gold/15 text-[11px] text-gold-soft/70">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">{children}</tbody>
      </table>
    </div>
  );
}

function Empty({ colSpan, text = "데이터가 없습니다." }: { colSpan: number; text?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return (key: string) => void qc.invalidateQueries({ queryKey: [key] });
}

function fail(e: unknown) {
  toast.error(e instanceof Error ? e.message : "처리에 실패했습니다.");
}

/* ---------- 1. 대시보드 ---------- */

function Dashboard({ onNavigate }: { onNavigate: (id: string) => void }) {
  const stats = useQuery({
    queryKey: ["admin-dashboard-flow"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("point_transactions")
        .select("type, amount, created_at")
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      return { tx: data ?? [] };
    },
  });

  const d = stats.data;

  const flow = useMemo(() => {
    const map = new Map<string, { inbound: number; outbound: number }>();
    for (const t of d?.tx ?? []) {
      const day = t.created_at.slice(5, 10);
      const cur = map.get(day) ?? { inbound: 0, outbound: 0 };
      if (Number(t.amount) >= 0) cur.inbound += Number(t.amount);
      else cur.outbound += Math.abs(Number(t.amount));
      map.set(day, cur);
    }
    return [...map.entries()].slice(0, 10).reverse();
  }, [d?.tx]);

  const peak = Math.max(1, ...flow.map(([, v]) => Math.max(v.inbound, v.outbound)));

  return (
    <div className="space-y-6">
      <AdminDashboard onNavigate={onNavigate} />


      <Panel title="포인트 유입/유출 추이" desc="최근 거래 400건 기준 일자별 합계">
        <div className="flex h-52 items-end gap-3">
          {flow.map(([day, v]) => (
            <div key={day} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-40 w-full items-end justify-center gap-1">
                <div
                  className="w-1/3 rounded-t bg-jade/70"
                  style={{ height: `${(v.inbound / peak) * 100}%` }}
                  title={`유입 ${v.inbound}`}
                />
                <div
                  className="w-1/3 rounded-t bg-crimson/70"
                  style={{ height: `${(v.outbound / peak) * 100}%` }}
                  title={`유출 ${v.outbound}`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{day}</span>
            </div>
          ))}
          {flow.length === 0 && <p className="text-xs text-muted-foreground">거래 기록이 없습니다.</p>}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          <span className="text-jade">■</span> 유입 · <span className="text-crimson">■</span> 유출
        </p>
      </Panel>
    </div>
  );
}

/* ---------- 2. 회원 관리 ---------- */


/* ---------- 3. 포인트 지급/회수 ---------- */

function PointAdjust() {
  const invalidate = useInvalidate();
  const [targetId, setTargetId] = useState("");
  const [amount, setAmount] = useState(0);
  const [memo, setMemo] = useState("");

  const recent = useQuery({
    queryKey: ["admin-manual-tx"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("point_transactions")
        .select("*")
        .in("type", ["admin_add", "admin_remove", "ADMIN_ADD", "ADMIN_REMOVE"])
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const run = useMutation({
    mutationFn: async (sign: 1 | -1) => {
      if (!targetId.trim()) throw new Error("대상 회원 ID를 입력해 주세요.");
      if (!amount || amount <= 0) throw new Error("0보다 큰 포인트를 입력해 주세요.");
      if (!memo.trim()) throw new Error("지급/회수 사유는 필수입니다.");
      await adjustPointsV2({
        userId: targetId.trim(),
        direction: sign === 1 ? "ADD" : "REMOVE",
        amount,
        reason: memo.trim(),
      });
    },
    onSuccess: () => {
      toast.success("포인트 처리가 완료되었습니다.");
      setAmount(0);
      setMemo("");
      invalidate("admin-manual-tx");
    },
    onError: fail,
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <Panel title="수동 지급 / 회수" desc="사유가 없으면 실행되지 않으며 모든 내역이 원장과 운영 로그에 남습니다.">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="target">대상 회원 ID</Label>
            <Input id="target" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount">포인트</Label>
            <Input
              id="amount"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memo">사유 (필수)</Label>
            <Input id="memo" value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="gold" disabled={run.isPending} onClick={() => run.mutate(1)}>
              지급
            </Button>
            <Button variant="danger" disabled={run.isPending} onClick={() => run.mutate(-1)}>
              회수
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="최근 수동 처리 내역">
        <Table head={["일시", "대상", "구분", "금액", "처리 후", "사유"]}>
          {(recent.data ?? []).map((t) => (
            <tr key={t.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(t.created_at)}</td>
              <td className="px-3 py-2 font-mono text-[10px]">{t.user_id.slice(0, 8)}</td>
              <td className="px-3 py-2">{TX_TYPE_LABEL[t.type] ?? t.type}</td>
              <td className={cn("px-3 py-2", t.amount >= 0 ? "text-jade" : "text-crimson")}>
                {formatPoints(t.amount)}
              </td>
              <td className="px-3 py-2 text-gold-soft">{formatPoints(t.balance_after)}</td>
              <td className="px-3 py-2 text-muted-foreground">{t.memo ?? "-"}</td>
            </tr>
          ))}
          {recent.data?.length === 0 && <Empty colSpan={6} />}
        </Table>
      </Panel>
    </div>
  );
}

/* ---------- 4. 충전 ---------- */

function Charges() {
  const invalidate = useInvalidate();
  const [note, setNote] = useState("");

  const charges = useQuery({
    queryKey: ["admin-charges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("charge_requests")
        .select("*")
        .order("requested_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const act = useMutation({
    mutationFn: async (input: { id: string; status: string }) =>
      processCharge(input.id, input.status, note.trim() || undefined),
    onSuccess: () => {
      toast.success("충전 신청을 처리했습니다.");
      setNote("");
      invalidate("admin-charges");
    },
    onError: fail,
  });

  return (
    <div className="space-y-4">
      <div className="w-[520px] space-y-1.5">
        <Label htmlFor="cnote">처리 메모</Label>
        <Input id="cnote" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Panel title="충전 신청" desc="입금 확인 후 승인하면 포인트가 즉시 지급되고 원장에 기록됩니다.">
        <Table head={["신청일", "회원", "입금자명", "금액", "지급 포인트", "상태", "처리"]}>
          {(charges.data ?? []).map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(c.requested_at)}</td>
              <td className="px-3 py-2 font-mono text-[10px]">{c.user_id.slice(0, 8)}</td>
              <td className="px-3 py-2">{c.depositor_name}</td>
              <td className="px-3 py-2">{formatWon(c.requested_amount)}</td>
              <td className="px-3 py-2 text-gold-soft">{formatPoints(c.point_amount)}</td>
              <td className="px-3 py-2">{WITHDRAW_STATUS_LABEL[c.status] ?? c.status}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1.5">
                  {!["APPROVED", "REJECTED"].includes(c.status) &&
                    CHARGE_FLOW.map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={s === "APPROVED" ? "gold" : s === "REJECTED" ? "danger" : "table"}
                        onClick={() => act.mutate({ id: c.id, status: s })}
                      >
                        {WITHDRAW_STATUS_LABEL[s]}
                      </Button>
                    ))}
                </div>
              </td>
            </tr>
          ))}
          {charges.data?.length === 0 && <Empty colSpan={7} />}
        </Table>
      </Panel>
    </div>
  );
}

/* ---------- 5. 출금 ---------- */

function Withdrawals() {
  const invalidate = useInvalidate();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<AdminWithdrawalRow | null>(null);

  const list = useQuery({
    queryKey: ["admin-withdrawals"],
    queryFn: () => fetchAdminWithdrawals(100),
  });

  const act = useMutation({
    mutationFn: async (input: { id: string; status: string }) =>
      processWithdrawal(input.id, input.status, note.trim() || undefined),
    onSuccess: () => {
      toast.success("출금 신청을 처리했습니다.");
      setNote("");
      setConfirm(null);
      invalidate("admin-withdrawals");
    },
    onError: fail,
  });

  return (
    <div className="space-y-4">
      <div className="w-[520px] space-y-1.5">
        <Label htmlFor="wnote">처리 메모</Label>
        <Input id="wnote" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Panel
        title="USDT 출금 신청"
        desc="출금은 USDT(TRC20) 전용입니다. 신청 시 포인트는 잠금되며, 지급완료 또는 반려 시 잠금이 해제됩니다. 주소는 신청 당시 저장된 값이며 회원이 이후 기본 주소를 바꿔도 변하지 않습니다."
      >
        <Table
          head={[
            "신청일",
            "회원",
            "출금 포인트",
            "환산액",
            "환율",
            "전송 예정",
            "USDT 주소",
            "상태",
            "처리",
          ]}
        >
          {(list.data ?? []).map((w) => (
            <tr key={w.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(w.requested_at)}</td>
              <td className="px-3 py-2">
                <div>{w.nickname ?? "-"}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{w.user_id.slice(0, 8)}</div>
              </td>
              <td className="px-3 py-2">{formatPoints(w.requested_points)}</td>
              <td className="px-3 py-2 text-gold-soft">{formatWon(w.payout_amount)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {w.krw_per_usdt ? `${w.krw_per_usdt.toLocaleString("ko-KR")}원/USDT` : "-"}
              </td>
              <td className="px-3 py-2 text-gold">
                {formatUsdt(w.expected_usdt)}
                <div className="text-[10px] text-muted-foreground">수수료 0%</div>
              </td>
              <td className="max-w-[220px] px-3 py-2">
                {w.address ? (
                  <div className="space-y-1">
                    <div className="break-all font-mono text-[10px]">{w.address}</div>
                    <div className="text-[10px] text-muted-foreground">{w.network ?? "TRC20"}</div>
                    <CopyAddressButton address={w.address} />
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    주소 없음 ({w.payout_method === "bank" ? "과거 원화 신청" : w.payout_method})
                  </span>
                )}
              </td>
              <td className="px-3 py-2">{WITHDRAW_STATUS_LABEL[w.status] ?? w.status}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1.5">
                  {!["PAID", "REJECTED", "CANCELLED"].includes(w.status) &&
                    WITHDRAW_FLOW.map((s) =>
                      s === "PAID" ? (
                        <Button key={s} size="sm" variant="gold" onClick={() => setConfirm(w)}>
                          {WITHDRAW_STATUS_LABEL[s]}
                        </Button>
                      ) : (
                        <Button
                          key={s}
                          size="sm"
                          variant={s === "REJECTED" ? "danger" : "table"}
                          onClick={() => act.mutate({ id: w.id, status: s })}
                        >
                          {WITHDRAW_STATUS_LABEL[s]}
                        </Button>
                      ),
                    )}
                </div>
              </td>
            </tr>
          ))}
          {list.data?.length === 0 && <Empty colSpan={9} />}
        </Table>
      </Panel>

      {confirm && (
        <Panel
          title="지급완료 처리 확인"
          desc="외부 지갑에서 USDT 전송을 완료한 뒤에만 지급완료로 처리하세요. 지급완료된 신청은 다시 처리할 수 없습니다."
        >
          <div className="space-y-3 p-1 text-xs">
            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <p className="text-muted-foreground">회원</p>
                <p>{`${confirm.nickname ?? "-"} (${confirm.user_id.slice(0, 8)})`}</p>
              </div>
              <div>
                <p className="text-muted-foreground">출금 포인트</p>
                <p>{formatPoints(confirm.requested_points)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">전송 예정</p>
                <p className="text-gold">{formatUsdt(confirm.expected_usdt)}</p>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">USDT 주소 ({confirm.network ?? "TRC20"})</p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-gold">{confirm.address ?? "-"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyAddressButton address={confirm.address} />
              <Button size="sm" variant="table" onClick={() => setConfirm(null)}>
                취소
              </Button>
              <Button
                size="sm"
                variant="gold"
                disabled={act.isPending}
                onClick={() => act.mutate({ id: confirm.id, status: "PAID" })}
              >
                {act.isPending ? "처리 중…" : "전송 완료 · 지급완료 처리"}
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ---------- 6. 포인트 원장 ---------- */

function Ledger() {
  const [type, setType] = useState("all");
  const [userId, setUserId] = useState("");

  const tx = useQuery({
    queryKey: ["admin-ledger", type, userId],
    queryFn: async () => {
      let query = supabase
        .from("point_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (type !== "all") query = query.eq("type", type);
      if (userId.trim()) query = query.eq("user_id", userId.trim());
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80 space-y-1.5">
          <Label htmlFor="uid">회원 ID</Label>
          <Input id="uid" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["all", ...Object.keys(TX_TYPE_LABEL)].map((t) => (
            <Button key={t} size="sm" variant={type === t ? "gold" : "table"} onClick={() => setType(t)}>
              {t === "all" ? "전체" : TX_TYPE_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>
      <Panel title="포인트 원장" desc="모든 포인트 변동은 잔액 변화와 함께 불변 기록으로 저장됩니다.">
        <Table head={["일시", "회원", "유형", "변동", "이전", "이후", "잠금(후)", "메모"]}>
          {(tx.data ?? []).map((t) => (
            <tr key={t.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(t.created_at)}</td>
              <td className="px-3 py-2 font-mono text-[10px]">{t.user_id.slice(0, 8)}</td>
              <td className="px-3 py-2">{TX_TYPE_LABEL[t.type] ?? t.type}</td>
              <td className={cn("px-3 py-2", t.amount >= 0 ? "text-jade" : "text-crimson")}>
                {formatPoints(t.amount)}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{formatPoints(t.balance_before)}</td>
              <td className="px-3 py-2 text-gold-soft">{formatPoints(t.balance_after)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatPoints(t.locked_after)}</td>
              <td className="px-3 py-2 text-muted-foreground">{t.memo ?? t.reference_type ?? "-"}</td>
            </tr>
          ))}
          {tx.data?.length === 0 && <Empty colSpan={8} />}
        </Table>
      </Panel>
    </div>
  );
}

/* ---------- 7. 방 등급 설정 ---------- */

function RoomTypes() {
  const invalidate = useInvalidate();
  const tiers = useQuery({
    queryKey: ["admin-room-types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("room_types").select("*").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: updateRoomType,
    onSuccess: () => {
      toast.success("방 등급 설정을 저장했습니다.");
      invalidate("admin-room-types");
    },
    onError: fail,
  });

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {(tiers.data ?? []).map((t) => (
        <TierEditor key={t.id} tier={t} onSave={(v) => save.mutate(v)} />
      ))}
    </div>
  );
}

function TierEditor({
  tier,
  onSave,
}: {
  tier: {
    id: string;
    name: string;
    min_points: number;
    base_bet: number;
    max_players: number;
    active: boolean;
    allow_sutda2: boolean;
    allow_sutda3: boolean;
  };
  onSave: (v: {
    id: string;
    minPoints: number;
    baseBet: number;
    maxPlayers: number;
    active: boolean;
    allowSutda2: boolean;
    allowSutda3: boolean;
  }) => void;
}) {
  const [minPoints, setMinPoints] = useState(tier.min_points);
  const [baseBet, setBaseBet] = useState(tier.base_bet);
  const [maxPlayers, setMaxPlayers] = useState(tier.max_players);
  const [active, setActive] = useState(tier.active);
  const [s2, setS2] = useState(tier.allow_sutda2);
  const [s3, setS3] = useState(tier.allow_sutda3);

  return (
    <Panel title={tier.name} desc={`채널 ID: ${tier.id}`}>
      <div className="space-y-3">
        <NumField label="최소 입장 포인트" value={minPoints} onChange={setMinPoints} step={10000} />
        <NumField label="기본 베팅" value={baseBet} onChange={setBaseBet} step={500} />
        <NumField label="정원" value={maxPlayers} onChange={setMaxPlayers} />
        <ToggleRow label="채널 활성화" checked={active} onChange={setActive} />
        <ToggleRow label="2장 섯다 허용" checked={s2} onChange={setS2} />
        <ToggleRow label="3장 섯다 허용" checked={s3} onChange={setS3} />
        <Button
          variant="gold"
          className="w-full"
          onClick={() =>
            onSave({
              id: tier.id,
              minPoints,
              baseBet,
              maxPlayers,
              active,
              allowSutda2: s2,
              allowSutda3: s3,
            })
          }
        >
          저장
        </Button>
      </div>
    </Panel>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/* ---------- 8. 방 관리 ---------- */


/* ---------- 9. 실시간 모니터링 ---------- */

function LiveMonitor() {
  const live = useQuery({
    queryKey: ["admin-live"],
    refetchInterval: 5000,
    queryFn: async () => {
      const [rooms, rounds, chats] = await Promise.all([
        supabase.from("game_rooms").select(GAME_ROOM_COLUMNS).eq("status", "playing"),
        supabase
          .from("game_rounds")
          // 카드 보안: deck / deck_pos 는 절대 조회하지 않는다 (관리자도 진행중 패 열람 금지)
          .select("id, room_id, round_number, game_mode, status, phase, stage, pot, base_bet, current_bet, current_turn_user_id, winner_id, settlement_status, started_at, finished_at, settled")
          .order("started_at", { ascending: false })
          .limit(20),
        supabase
          .from("chat_messages")
          .select("id, message, created_at, user_id, room_id")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      return { rooms: rooms.data ?? [], rounds: rounds.data ?? [], chats: chats.data ?? [] };
    },
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <Panel
          title="진행 중인 테이블"
          desc="5초마다 자동 갱신 · 진행 중인 패의 앞면은 관리자도 열람할 수 없습니다."
        >
          <Table head={["제목", "채널", "모드", "인원", "기본 베팅"]}>
            {(live.data?.rooms ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.title}</td>
                <td className="px-3 py-2">{r.room_type ?? "-"}</td>
                <td className="px-3 py-2">{r.game_mode}</td>
                <td className="px-3 py-2">
                  {r.current_players}/{r.max_players}
                </td>
                <td className="px-3 py-2 text-gold-soft">{formatPoints(r.base_bet)}</td>
              </tr>
            ))}
            {live.data?.rooms.length === 0 && <Empty colSpan={5} text="진행 중인 게임이 없습니다." />}
          </Table>
        </Panel>
        <Panel title="최근 라운드">
          <Table head={["시작", "라운드", "모드", "팟", "상태", "정산"]}>
            {(live.data?.rounds ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.started_at)}</td>
                <td className="px-3 py-2">#{r.round_number}</td>
                <td className="px-3 py-2">{r.game_mode}</td>
                <td className="px-3 py-2 text-gold-soft">{formatPoints(r.pot)}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2">{r.settled ? "완료" : "대기"}</td>
              </tr>
            ))}
            {live.data?.rounds.length === 0 && <Empty colSpan={6} />}
          </Table>
        </Panel>
      </div>
      <Panel title="실시간 채팅 모니터">
        <ul className="max-h-[600px] space-y-1.5 overflow-y-auto text-xs">
          {(live.data?.chats ?? []).map((c) => (
            <li key={c.id} className="rounded-lg bg-black/30 px-3 py-2">
              <p className="text-[10px] text-muted-foreground">
                {formatDateTime(c.created_at)} · {c.user_id?.slice(0, 8) ?? "system"}
              </p>
              <p className="mt-0.5 text-foreground/85">{c.message}</p>
            </li>
          ))}
          {live.data?.chats.length === 0 && (
            <li className="text-muted-foreground">채팅 기록이 없습니다.</li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

/* ---------- 10. 게임 기록 ---------- */

function Rounds() {
  const rounds = useQuery({
    queryKey: ["admin-rounds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_rounds")
        // 카드 보안: deck / deck_pos 는 절대 조회하지 않는다
        .select("id, room_id, round_number, game_mode, status, phase, stage, pot, base_bet, current_bet, current_turn_user_id, winner_id, settlement_status, started_at, finished_at, settled")
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Panel title="게임 기록" desc="정산은 서버 RPC에서만 수행되며 결과는 수정할 수 없습니다.">
      <Table head={["시작", "종료", "모드", "라운드", "팟", "승자", "상태"]}>
        {(rounds.data ?? []).map((r) => (
          <tr key={r.id}>
            <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.started_at)}</td>
            <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.finished_at)}</td>
            <td className="px-3 py-2">{r.game_mode}</td>
            <td className="px-3 py-2">#{r.round_number}</td>
            <td className="px-3 py-2 text-gold-soft">{formatPoints(r.pot)}</td>
            <td className="px-3 py-2 font-mono text-[10px]">{r.winner_id?.slice(0, 8) ?? "-"}</td>
            <td className="px-3 py-2">{r.settled ? "정산완료" : r.status}</td>
          </tr>
        ))}
        {rounds.data?.length === 0 && <Empty colSpan={7} />}
      </Table>
    </Panel>
  );
}

/* ---------- 11. 카드 자산 ---------- */

function CardAssets() {
  const invalidate = useInvalidate();
  const cards = useQuery({
    queryKey: ["admin-cards"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("card_assets")
        .select("*")
        .order("month")
        .order("variant");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: updateCardAsset,
    onSuccess: () => {
      toast.success("카드 자산을 갱신했습니다.");
      invalidate("admin-cards");
    },
    onError: fail,
  });

  return (
    <Panel title="화투 카드 자산 (20장)" desc="광 카드 지정과 이미지 경로를 관리합니다.">
      <div className="grid gap-4 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-10">
        {(cards.data ?? []).map((c) => (
          <div key={c.id} className="rounded-xl border border-gold/15 bg-black/30 p-3 text-center">
            <img
              src={c.asset_url}
              alt={c.name}
              className="mx-auto h-32 w-auto rounded-md ring-1 ring-gold/20"
            />
            <p className="mt-2 text-xs font-semibold text-foreground">{c.name}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{c.id}</p>
            <div className="mt-2 flex justify-center gap-1.5">
              <Button
                size="sm"
                variant={c.is_gwang ? "gold" : "table"}
                onClick={() =>
                  save.mutate({
                    id: c.id,
                    assetUrl: c.asset_url,
                    enabled: c.enabled,
                    isGwang: !c.is_gwang,
                  })
                }
              >
                {c.is_gwang ? "광" : "일반"}
              </Button>
              <Button
                size="sm"
                variant={c.enabled ? "table" : "danger"}
                onClick={() =>
                  save.mutate({
                    id: c.id,
                    assetUrl: c.asset_url,
                    enabled: !c.enabled,
                    isGwang: c.is_gwang,
                  })
                }
              >
                {c.enabled ? "사용" : "중지"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ---------- 12. 상점 아이템 ---------- */


/* ---------- 13. 공지 ---------- */

const NOTICE_CATEGORIES = [
  { id: "system", label: "시스템" },
  { id: "event", label: "이벤트" },
  { id: "maintenance", label: "점검" },
] as const;

function Notices() {
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    id: null as string | null,
    title: "",
    body: "",
    category: "system",
    pinned: false,
    published: true,
  });

  const notices = useQuery({
    queryKey: ["admin-notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notices")
        .select("*")
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const reset = () =>
    setForm({ id: null, title: "", body: "", category: "system", pinned: false, published: true });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("제목을 입력해 주세요.");
      if (!form.body.trim()) throw new Error("내용을 입력해 주세요.");
      const { error } = await supabase.rpc("admin_upsert_notice", {
        // 신규 등록은 _id에 null을 전달한다 (RPC가 새 공지를 생성).
        _id: form.id as unknown as string,
        _title: form.title.trim(),
        _body: form.body.trim(),
        _category: form.category,
        _pinned: form.pinned,
        _published: form.published,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "공지를 수정했습니다." : "공지를 등록했습니다.");
      reset();
      invalidate("admin-notices");
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_delete_notice", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("공지를 삭제했습니다.");
      invalidate("admin-notices");
    },
    onError: fail,
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[440px_1fr]">
      <Panel
        title={form.id ? "공지 수정" : "공지 작성"}
        desc="분류·상단고정·게시 여부를 지정할 수 있습니다."
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nt">제목</Label>
            <Input
              id="nt"
              value={form.title}
              maxLength={120}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nb">내용</Label>
            <textarea
              id="nb"
              value={form.body}
              rows={8}
              maxLength={4000}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label>분류</Label>
            <div className="flex gap-2">
              {NOTICE_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setForm({ ...form, category: c.id })}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    form.category === c.id
                      ? "border-gold/50 bg-gold/12 text-gold"
                      : "border-border text-foreground/70",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-6 text-xs">
            <label className="flex items-center gap-2">
              <Switch
                checked={form.pinned}
                onCheckedChange={(v) => setForm({ ...form, pinned: v })}
              />
              상단 고정
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={form.published}
                onCheckedChange={(v) => setForm({ ...form, published: v })}
              />
              게시
            </label>
          </div>
          <div className="flex gap-2">
            <Button variant="gold" className="flex-1" onClick={() => save.mutate()}>
              {form.id ? "수정 저장" : "등록"}
            </Button>
            {form.id && (
              <Button variant="table" onClick={reset}>
                새 공지
              </Button>
            )}
          </div>
        </div>
      </Panel>
      <Panel title="공지 목록">
        <Table head={["등록일", "분류", "제목", "고정", "게시", "관리"]}>
          {(notices.data ?? []).map((n) => (
            <tr key={n.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(n.created_at)}</td>
              <td className="px-3 py-2">
                {NOTICE_CATEGORIES.find((c) => c.id === (n.category ?? "system"))?.label ?? "시스템"}
              </td>
              <td className="px-3 py-2 text-foreground">{n.title}</td>
              <td className="px-3 py-2">{n.pinned ? "고정" : "-"}</td>
              <td className="px-3 py-2">{n.published ? "게시중" : "숨김"}</td>
              <td className="flex gap-1.5 px-3 py-2">
                <Button
                  size="sm"
                  variant="table"
                  onClick={() =>
                    setForm({
                      id: n.id,
                      title: n.title,
                      body: n.body,
                      category: n.category ?? "system",
                      pinned: n.pinned,
                      published: n.published,
                    })
                  }
                >
                  수정
                </Button>
                <Button size="sm" variant="danger" onClick={() => remove.mutate(n.id)}>
                  삭제
                </Button>
              </td>
            </tr>
          ))}
          {notices.data?.length === 0 && <Empty colSpan={6} />}
        </Table>
      </Panel>
    </div>
  );
}

/* ---------- 13-1. 총판 관리 ---------- */

function Affiliates() {
  const invalidate = useInvalidate();
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [memo, setMemo] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rateEdit, setRateEdit] = useState<{ id: string; rate: string; reason: string } | null>(
    null,
  );

  const affiliates = useQuery({
    queryKey: ["admin-affiliates"],
    queryFn: fetchAdminAffiliates,
  });

  const detail = useQuery({
    queryKey: ["admin-affiliate-detail", selected],
    enabled: !!selected,
    queryFn: () => fetchAffiliateOverview(selected!),
  });


  const designate = useMutation({
    mutationFn: async () => {
      const username = target.trim().toLowerCase();
      if (!username) throw new Error("회원 아이디를 입력해 주세요.");
      const { data: foundId, error: findError } = await supabase.rpc(
        "admin_find_user_by_username",
        { _username: username },
      );
      if (findError) throw findError;
      if (!foundId) throw new Error("해당 아이디의 회원을 찾을 수 없습니다.");
      const { error } = await supabase.rpc("admin_set_affiliate", {
        _user_id: foundId as string,
        ...(code.trim() ? { _code: code.trim().toUpperCase() } : {}),
        ...(memo.trim() ? { _memo: memo.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("총판으로 지정했습니다.");
      setTarget("");
      setCode("");
      setMemo("");
      invalidate("admin-affiliates");
    },
    onError: fail,
  });

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase.rpc("admin_set_affiliate_status", {
        _affiliate_id: input.id,
        _status: input.status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("총판 상태를 변경했습니다.");
      invalidate("admin-affiliates");
    },
    onError: fail,
  });

  const saveRate = useMutation({
    mutationFn: async (input: { id: string; rate: string; reason: string }) => {
      const rate = Number(input.rate);
      if (!input.reason.trim()) throw new Error("변경 사유를 입력해 주세요.");
      await setAffiliateRebateRate({ affiliateId: input.id, rate, reason: input.reason.trim() });
    },
    onSuccess: () => {
      toast.success("리베이트율을 변경했습니다. 이후 승인되는 신규 충전부터 적용됩니다.");
      setRateEdit(null);
      invalidate("admin-affiliates");
      invalidate("admin-affiliate-detail");
    },
    onError: fail,
  });

  const keyword = search.trim().toLowerCase();
  const shownAffiliates = (affiliates.data ?? []).filter(
    (a) =>
      !keyword ||
      (a.code ?? "").toLowerCase().includes(keyword) ||
      (a.username ?? "").toLowerCase().includes(keyword) ||
      (a.nickname ?? "").toLowerCase().includes(keyword),
  );
  const editTarget = rateEdit ? shownAffiliates.find((a) => a.id === rateEdit.id) : undefined;

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel title="총판 지정" desc="회원 아이디로 총판을 지정하고 가입코드를 발급합니다.">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="af-user">회원 아이디</Label>
            <Input id="af-user" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-code">가입코드 (비우면 자동 발급)</Label>
            <Input id="af-code" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="af-memo">메모</Label>
            <Input id="af-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <Button variant="gold" className="w-full" onClick={() => designate.mutate()}>
            총판 지정 / 코드 발급
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            충전 승인 시 신청 금액의 7%가 차감되어 93%만 지급되며, 차감액 중 총판 코드에 설정된
            리베이트율(기본 2.00%)만큼 총판 정산으로 적립되고 나머지는 회사 수익입니다.
          </p>
        </div>
      </Panel>
      <div className="space-y-5">
        <Panel
          title="총판 목록"
          desc="행을 선택하면 산하회원·커미션 상세가 표시됩니다. 리베이트율 변경은 이후 승인되는 신규 충전에만 적용됩니다."
        >
          <div className="mb-3 px-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="총판명(아이디/닉네임) 또는 총판 코드 검색"
              className="h-9 max-w-xs text-xs"
            />
          </div>
          {rateEdit && (
            <div className="mx-3 mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-gold/30 bg-black/30 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="af-rate">
                  리베이트율 (%) · 총판 코드 {editTarget?.code ?? "-"} · 현재{" "}
                  {formatRebateRate(editTarget?.rebateRate ?? REBATE_RATE_DEFAULT)}
                </Label>
                <Input
                  id="af-rate"
                  type="number"
                  step="0.01"
                  min={REBATE_RATE_MIN}
                  max={REBATE_RATE_MAX}
                  value={rateEdit.rate}
                  onChange={(e) => setRateEdit({ ...rateEdit, rate: e.target.value })}
                  className="h-9 w-28 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="af-rate-reason">변경 사유 (필수)</Label>
                <Input
                  id="af-rate-reason"
                  value={rateEdit.reason}
                  onChange={(e) => setRateEdit({ ...rateEdit, reason: e.target.value })}
                  className="h-9 w-64 text-xs"
                />
              </div>
              <Button variant="gold" size="sm" onClick={() => saveRate.mutate(rateEdit)}>
                저장
              </Button>
              <Button variant="goldOutline" size="sm" onClick={() => setRateEdit(null)}>
                취소
              </Button>
              <p className="w-full text-[11px] text-muted-foreground">
                허용 범위 {REBATE_RATE_MIN}% ~ {REBATE_RATE_MAX}% (0.01% 단위). 과거 리베이트 내역은
                변경되지 않고, 변경 이후 승인되는 신규 충전부터 적용됩니다.
              </p>
            </div>
          )}
          <Table
            head={[
              "등록일",
              "아이디",
              "닉네임",
              "가입코드",
              "산하회원",
              "기준 충전액",
              "리베이트율",
              "누적 커미션",
              "미정산",
              "정산완료",
              "상태",
              "관리",
            ]}
          >
            {shownAffiliates.map((a) => (
              <tr
                key={a.id}
                onClick={() => setSelected(a.id)}
                className={
                  selected === a.id ? "cursor-pointer bg-gold/10" : "cursor-pointer hover:bg-white/5"
                }
              >
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(a.createdAt)}</td>
                <td className="px-3 py-2 text-foreground">{a.username ?? "-"}</td>
                <td className="px-3 py-2">{a.nickname ?? "-"}</td>
                <td className="px-3 py-2 font-display text-gold">{a.code}</td>
                <td className="px-3 py-2">
                  {a.members}명{a.membersWeek > 0 && (
                    <span className="ml-1 text-[10px] text-jade">+{a.membersWeek}</span>
                  )}
                </td>
                <td className="px-3 py-2">{formatPoints(Number(a.baseTotal ?? 0))}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-gold-soft">
                      {formatRebateRate(a.rebateRate)}
                    </span>
                    <Button
                      size="sm"
                      variant="goldOutline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRateEdit({
                          id: a.id,
                          rate: Number(a.rebateRate ?? REBATE_RATE_DEFAULT).toFixed(2),
                          reason: "",
                        });
                      }}
                    >
                      수정
                    </Button>
                  </div>
                </td>
                <td className="px-3 py-2 text-jade">
                  {formatPoints(Number(a.commissionTotal ?? 0))}
                </td>
                <td className="px-3 py-2 text-crimson">{formatPoints(Number(a.pending ?? 0))}</td>
                <td className="px-3 py-2 text-jade">{formatPoints(Number(a.settled ?? 0))}</td>
                <td className="px-3 py-2">{a.status === "active" ? "활성" : "중지"}</td>
                <td className="px-3 py-2">
                  {a.status === "active" ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatus.mutate({ id: a.id, status: "disabled" });
                      }}
                    >
                      중지
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="gold"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatus.mutate({ id: a.id, status: "active" });
                      }}
                    >
                      활성화
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {shownAffiliates.length === 0 && <Empty colSpan={12} />}
          </Table>
        </Panel>

        {selected && (
          <Panel
            title={`총판 상세 · ${detail.data?.affiliate?.nickname ?? ""} (${detail.data?.affiliate?.code ?? "-"})`}
            desc="산하회원별 충전액·커미션과 최근 활동"
          >
            {detail.isLoading ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">불러오는 중…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["현재 리베이트율", formatRebateRate(detail.data?.affiliate?.rebateRate)],
                    ["산하회원", `${(detail.data?.totals?.members ?? 0).toLocaleString("ko-KR")}명`],
                    ["기준 충전액", formatPoints(Number(detail.data?.totals?.baseTotal ?? 0))],
                    ["누적 커미션", formatPoints(Number(detail.data?.totals?.commissionTotal ?? 0))],
                    ["미정산", formatPoints(Number(detail.data?.totals?.pending ?? 0))],
                    ["정산 완료", formatPoints(Number(detail.data?.totals?.settled ?? 0))],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-border bg-black/30 px-3 py-2">
                      <p className="text-[10px] tracking-widest text-muted-foreground">{label}</p>
                      <p className="font-display mt-1 text-sm text-gold-soft">{value}</p>
                    </div>
                  ))}
                </div>

                <Table head={["아이디", "닉네임", "계급", "충전액", "커미션", "미정산", "최근 충전", "가입일"]}>
                  {(detail.data?.members ?? []).map((m) => (
                    <tr key={m.userId}>
                      <td className="px-3 py-2 text-foreground">{m.username ?? "-"}</td>
                      <td className="px-3 py-2">{m.nickname ?? "-"}</td>
                      <td className="px-3 py-2 text-gold/80">{m.rank ?? "UNRANKED"}</td>
                      <td className="px-3 py-2">
                        {formatPoints(m.chargeAmount)}{" "}
                        <span className="text-[10px] text-muted-foreground">({m.chargeCount}건)</span>
                      </td>
                      <td className="px-3 py-2 text-jade">{formatPoints(m.commissionAmount)}</td>
                      <td className="px-3 py-2 text-crimson">{formatPoints(m.commissionPending)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {m.lastChargeAt ? formatDateTime(m.lastChargeAt) : "-"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(m.joinedAt)}
                      </td>
                    </tr>
                  ))}
                  {(detail.data?.members ?? []).length === 0 && <Empty colSpan={8} />}
                </Table>

                <div>
                  <p className="mb-2 text-xs text-muted-foreground">최근 활동</p>
                  <ul className="space-y-1.5">
                    {(detail.data?.activity ?? []).slice(0, 15).map((a, i) => (
                      <li
                        key={`${a.at}-${i}`}
                        className="flex items-center justify-between rounded-lg border border-border bg-black/30 px-3 py-1.5 text-xs"
                      >
                        <span className={a.type === "JOIN" ? "text-gold-soft" : "text-jade"}>
                          {a.type === "JOIN" ? "신규 가입" : "커미션 적립"} · {a.nickname}
                          {a.type === "COMMISSION" && ` +${formatPoints(Number(a.amount ?? 0))}`}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDateTime(a.at)}
                        </span>
                      </li>
                    ))}
                    {(detail.data?.activity ?? []).length === 0 && (
                      <li className="py-4 text-center text-xs text-muted-foreground">
                        활동 내역이 없습니다.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}
          </Panel>
        )}
      </div>

    </div>
  );
}

/* ---------- 14. 신고 ---------- */

function Reports() {
  const invalidate = useInvalidate();
  const [note, setNote] = useState("");

  const reports = useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const act = useMutation({
    mutationFn: async (input: { id: string; status: string }) =>
      handleReport(input.id, input.status, note.trim()),
    onSuccess: () => {
      toast.success("신고를 처리했습니다.");
      setNote("");
      invalidate("admin-reports");
    },
    onError: fail,
  });

  return (
    <div className="space-y-4">
      <div className="w-[520px] space-y-1.5">
        <Label htmlFor="rnote">처리 메모</Label>
        <Input id="rnote" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Panel title="신고 접수">
        <Table head={["접수일", "분류", "신고자", "대상", "내용", "상태", "처리"]}>
          {(reports.data ?? []).map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.created_at)}</td>
              <td className="px-3 py-2">{r.category}</td>
              <td className="px-3 py-2 font-mono text-[10px]">{r.reporter_id.slice(0, 8)}</td>
              <td className="px-3 py-2 font-mono text-[10px]">
                {r.target_user_id?.slice(0, 8) ?? "-"}
              </td>
              <td className="max-w-[320px] truncate px-3 py-2">{r.content}</td>
              <td className="px-3 py-2">{r.status}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1.5">
                  <Button size="sm" variant="table" onClick={() => act.mutate({ id: r.id, status: "REVIEWING" })}>
                    확인중
                  </Button>
                  <Button size="sm" variant="gold" onClick={() => act.mutate({ id: r.id, status: "RESOLVED" })}>
                    조치완료
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => act.mutate({ id: r.id, status: "REJECTED" })}>
                    반려
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {reports.data?.length === 0 && <Empty colSpan={7} />}
        </Table>
      </Panel>
    </div>
  );
}

/* ---------- 15. 시즌/랭킹 ---------- */

function Seasons() {
  const invalidate = useInvalidate();
  const seasons = useQuery({
    queryKey: ["admin-seasons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seasons")
        .select("*")
        .order("start_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string }) =>
      setSeasonStatus(input.id, input.status),
    onSuccess: () => {
      toast.success("시즌 상태를 변경했습니다.");
      invalidate("admin-seasons");
    },
    onError: fail,
  });

  const recalc = useMutation({
    mutationFn: recalcSeasonRankings,
    onSuccess: () => toast.success("시즌 랭킹을 재계산했습니다."),
    onError: fail,
  });

  return (
    <div className="space-y-4">
      <Button variant="gold" onClick={() => recalc.mutate()} disabled={recalc.isPending}>
        현재 시즌 랭킹 재계산
      </Button>
      <Panel title="시즌 목록">
        <Table head={["이름", "시작", "종료", "상태", "관리"]}>
          {(seasons.data ?? []).map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 text-foreground">{s.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(s.start_at)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(s.end_at)}</td>
              <td className="px-3 py-2">{s.status}</td>
              <td className="px-3 py-2">
                <div className="flex gap-1.5">
                  <Button size="sm" variant="gold" onClick={() => setStatus.mutate({ id: s.id, status: "active" })}>
                    활성
                  </Button>
                  <Button size="sm" variant="table" onClick={() => setStatus.mutate({ id: s.id, status: "ended" })}>
                    종료
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {seasons.data?.length === 0 && <Empty colSpan={5} />}
        </Table>
      </Panel>
    </div>
  );
}

/* ---------- 16. 시스템 설정 ---------- */

function Settings() {
  const invalidate = useInvalidate();
  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("key, value").order("key");
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (input: { key: string; raw: string }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.raw);
      } catch {
        parsed = input.raw;
      }
      await updateAdminSetting(input.key, parsed);
    },
    onSuccess: () => {
      toast.success("설정을 저장했습니다.");
      invalidate("admin-settings");
    },
    onError: fail,
  });

  return (
    <Panel title="시스템 설정" desc="점검 모드, 충전/출금 한도, 안내 문구 등을 관리합니다. JSON 형식으로 저장됩니다.">
      <div className="grid gap-3 xl:grid-cols-2">
        {(settings.data ?? []).map((s) => (
          <SettingRow key={s.key} settingKey={s.key} value={s.value} onSave={save.mutate} />
        ))}
      </div>
    </Panel>
  );
}

function SettingRow({
  settingKey,
  value,
  onSave,
}: {
  settingKey: string;
  value: unknown;
  onSave: (v: { key: string; raw: string }) => void;
}) {
  const [raw, setRaw] = useState(JSON.stringify(value));
  return (
    <div className="flex items-end gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        <Label className="font-mono text-[11px]">{settingKey}</Label>
        <Input value={raw} onChange={(e) => setRaw(e.target.value)} />
      </div>
      <Button size="sm" variant="gold" onClick={() => onSave({ key: settingKey, raw })}>
        저장
      </Button>
    </div>
  );
}

/* ---------- 17. 운영 로그 ---------- */

