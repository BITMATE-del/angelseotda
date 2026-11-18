import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime } from "@/lib/services/adminService";
import { formatPoints } from "@/lib/services/walletService";
import {
  EMPTY_TOTALS,
  fetchAffiliateOverview,
  formatRebateRate,
  referralLink,
  type AffiliateMemberRow,
} from "@/lib/services/affiliateService";

export const Route = createFileRoute("/affiliate")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "총판 센터 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content:
          "엔젤섯다 총판 전용 센터 — 산하회원, 충전액, 커미션, 정산 상태와 추천링크를 관리하세요.",
      },
      { property: "og:title", content: "총판 센터 · 엔젤섯다" },
      { property: "og:description", content: "산하회원·충전액·커미션 정산을 한눈에 관리하세요." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: () => (
    <AppShell>
      <p className="panel-surface rounded-2xl p-8 text-center text-sm">
        총판 정보를 불러오지 못했습니다.
      </p>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <p className="panel-surface rounded-2xl p-8 text-center text-sm">페이지가 없습니다.</p>
    </AppShell>
  ),
  component: AffiliatePage,
});

type SortKey = "joined" | "charge" | "commission";

function copy(text: string, label: string) {
  void navigator.clipboard.writeText(text);
  toast.success(`${label}을(를) 복사했습니다.`);
}

function Stat({
  label,
  value,
  tone = "text-foreground",
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-black/30 px-3 py-2">
      <p className="text-[10px] tracking-widest text-muted-foreground">{label}</p>
      <p className={`font-display mt-1 text-sm ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AffiliatePage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("joined");

  const overview = useQuery({
    queryKey: ["affiliate-overview", user?.id],
    enabled: !!user,
    queryFn: () => fetchAffiliateOverview(),
  });

  const data = overview.data;
  const totals = data?.totals ?? EMPTY_TOTALS;
  const members = data?.members ?? [];
  const commissions = data?.commissions ?? [];
  const activity = data?.activity ?? [];

  const keyword = q.trim().toLowerCase();
  const sorters: Record<SortKey, (a: AffiliateMemberRow, b: AffiliateMemberRow) => number> = {
    joined: (a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime(),
    charge: (a, b) => b.chargeAmount - a.chargeAmount,
    commission: (a, b) => b.commissionAmount - a.commissionAmount,
  };
  const shown = members
    .filter(
      (m) =>
        !keyword ||
        (m.username ?? "").toLowerCase().includes(keyword) ||
        (m.nickname ?? "").toLowerCase().includes(keyword),
    )
    .sort(sorters[sort]);

  if (!user) {
    return (
      <AppShell>
        <div className="panel-surface rounded-2xl p-10 text-center">
          <p className="text-sm text-foreground/80">총판 센터는 로그인 후 이용할 수 있습니다.</p>
          <Button variant="gold" className="mt-4" asChild>
            <Link to="/auth">로그인</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  if (overview.isLoading) {
    return (
      <AppShell>
        <p className="panel-surface rounded-2xl p-10 text-center text-sm text-muted-foreground">
          총판 정보를 불러오는 중입니다…
        </p>
      </AppShell>
    );
  }

  if (!data?.affiliate) {
    return (
      <AppShell>
        <div className="panel-surface rounded-2xl p-10 text-center">
          <h1 className="text-gold-plate font-display text-xl">총판 센터</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            총판 권한이 없는 계정입니다. 총판 신청은 관리자(텔레그램) 문의를 통해 진행됩니다.
          </p>
        </div>
      </AppShell>
    );
  }

  const aff = data.affiliate;
  const link = referralLink(aff.code);
  const active = aff.status === "active";

  return (
    <AppShell>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-gold-plate font-display text-2xl">총판 센터</h1>
        <span
          className={`rounded-full px-3 py-1 text-[11px] ${
            active ? "bg-jade/15 text-jade" : "bg-destructive/15 text-destructive"
          }`}
        >
          {aff.nickname ?? "총판"} · {active ? "활성" : "중지"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          등록일 {formatDateTime(aff.createdAt)}
        </span>
      </div>

      {!active && (
        <p className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          현재 총판 권한이 중지된 상태입니다. 신규 커미션 적립이 제한될 수 있습니다.
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="panel-surface gold-frame rounded-2xl p-5">
          <p className="text-[11px] tracking-widest text-muted-foreground">내 가입코드</p>
          <p className="font-display mt-1 text-2xl text-gold">{aff.code}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="goldOutline" size="sm" onClick={() => copy(aff.code, "가입코드")}>
              코드 복사
            </Button>
            <Button variant="goldOutline" size="sm" onClick={() => copy(link, "추천링크")}>
              추천링크 복사
            </Button>
          </div>
          <p className="mt-2 break-all text-[10px] text-muted-foreground">{link}</p>
        </div>
        <div className="panel-surface rounded-2xl p-5">
          <p className="text-[11px] tracking-widest text-muted-foreground">현재 리베이트율</p>
          <p className="font-display mt-1 text-2xl text-gold-soft">
            {formatRebateRate(aff.rebateRate)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            관리자만 변경할 수 있으며, 변경 시 이후 승인되는 신규 충전부터 적용됩니다.
          </p>
        </div>
        <div className="panel-surface rounded-2xl p-5">
          <p className="text-[11px] tracking-widest text-muted-foreground">산하회원</p>
          <p className="font-display mt-1 text-2xl text-foreground">
            {totals.members.toLocaleString("ko-KR")}명
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            최근 7일 신규 {totals.membersWeek.toLocaleString("ko-KR")}명
          </p>
        </div>
        <div className="panel-surface rounded-2xl p-5">
          <p className="text-[11px] tracking-widest text-muted-foreground">누적 커미션</p>
          <p className="font-display mt-1 text-2xl text-jade">
            {formatPoints(totals.commissionTotal)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            기준 충전액 {formatPoints(totals.baseTotal)} · {totals.commissionCount}건
          </p>
        </div>
      </div>

      <section className="panel-surface mt-4 rounded-2xl p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg text-gold">정산 요약</h2>
          <p className="text-[11px] text-muted-foreground">
            충전 승인액의 {formatRebateRate(aff.rebateRate)}가 총판 커미션으로 적립됩니다. 과거
            내역은 거래 당시 비율로 보존됩니다.
          </p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="최근 24시간" value={formatPoints(totals.day1)} tone="text-gold-soft" />
          <Stat label="최근 7일" value={formatPoints(totals.day7)} tone="text-gold-soft" />
          <Stat label="최근 30일" value={formatPoints(totals.day30)} tone="text-gold-soft" />
          <Stat label="미정산" value={formatPoints(totals.pending)} tone="text-crimson" />
          <Stat label="정산 완료" value={formatPoints(totals.settled)} tone="text-jade" />
        </div>
      </section>

      <section className="panel-surface mt-5 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg text-gold">산하회원 ({shown.length}명)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="아이디 / 닉네임 검색"
              className="h-9 w-48 text-xs"
            />
            {(
              [
                ["joined", "가입순"],
                ["charge", "충전액순"],
                ["commission", "커미션순"],
              ] as [SortKey, string][]
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={sort === key ? "gold" : "goldOutline"}
                onClick={() => setSort(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-gold/10 text-left">
                <th className="py-2">아이디</th>
                <th className="py-2">닉네임</th>
                <th className="py-2">계급</th>
                <th className="py-2">보유 포인트</th>
                <th className="py-2">충전액(기준)</th>
                <th className="py-2">커미션</th>
                <th className="py-2">미정산</th>
                <th className="py-2">최근 충전</th>
                <th className="py-2">가입일</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.userId} className="border-b border-white/5">
                  <td className="py-2 text-foreground">{m.username ?? "-"}</td>
                  <td className="py-2">{m.nickname ?? "-"}</td>
                  <td className="py-2 text-gold/80">{m.rank ?? "UNRANKED"}</td>
                  <td className="py-2 text-gold-soft">{formatPoints(m.points ?? 0)}</td>
                  <td className="py-2">
                    {formatPoints(m.chargeAmount)}{" "}
                    <span className="text-muted-foreground">({m.chargeCount}건)</span>
                  </td>
                  <td className="py-2 text-jade">{formatPoints(m.commissionAmount)}</td>
                  <td className="py-2 text-crimson">{formatPoints(m.commissionPending)}</td>
                  <td className="py-2 text-muted-foreground">
                    {m.lastChargeAt ? formatDateTime(m.lastChargeAt) : "-"}
                  </td>
                  <td className="py-2 text-muted-foreground">{formatDateTime(m.joinedAt)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted-foreground">
                    산하회원이 없습니다. 추천링크를 공유해 회원을 유치하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
        <section className="panel-surface rounded-2xl p-5">
          <h2 className="font-display text-lg text-gold">커미션 내역</h2>
          <div className="mt-3 max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-gold/10 text-left">
                  <th className="py-2">일시</th>
                  <th className="py-2">회원</th>
                  <th className="py-2">기준 금액</th>
                  <th className="py-2">비율</th>
                  <th className="py-2">커미션</th>
                  <th className="py-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b border-white/5">
                    <td className="py-2 text-muted-foreground">{formatDateTime(c.createdAt)}</td>
                    <td className="py-2">{c.nickname ?? c.username ?? "-"}</td>
                    <td className="py-2">{formatPoints(Number(c.baseAmount ?? 0))}</td>
                    <td className="py-2">{(Number(c.rate ?? 0) * 100).toFixed(1)}%</td>
                    <td className="py-2 text-jade">{formatPoints(Number(c.amount ?? 0))}</td>
                    <td className="py-2">
                      <span
                        className={
                          (c.status ?? "").toUpperCase() === "SETTLED"
                            ? "rounded bg-jade/15 px-1.5 py-0.5 text-jade"
                            : "rounded bg-crimson/15 px-1.5 py-0.5 text-crimson"
                        }
                      >
                        {(c.status ?? "").toUpperCase() === "SETTLED" ? "정산완료" : "미정산"}
                      </span>
                    </td>
                  </tr>
                ))}
                {commissions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      커미션 내역이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel-surface rounded-2xl p-5">
          <h2 className="font-display text-lg text-gold">최근 활동</h2>
          <ul className="mt-3 max-h-[420px] space-y-2 overflow-auto">
            {activity.map((a, i) => (
              <li
                key={`${a.at}-${i}`}
                className="rounded-xl border border-border bg-black/30 px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={a.type === "JOIN" ? "text-gold-soft" : "text-jade"}>
                    {a.type === "JOIN" ? "신규 가입" : "커미션 적립"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateTime(a.at)}
                  </span>
                </div>
                <p className="mt-1 text-foreground">
                  {a.nickname}
                  {a.type === "COMMISSION" && (
                    <span className="ml-1 text-jade">+{formatPoints(Number(a.amount ?? 0))}</span>
                  )}
                </p>
              </li>
            ))}
            {activity.length === 0 && (
              <li className="py-6 text-center text-xs text-muted-foreground">
                활동 내역이 없습니다.
              </li>
            )}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
