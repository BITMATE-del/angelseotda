import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSettings,
  fetchTransactions,
  formatPoints,
  formatWon,
  WITHDRAW_STATUS_LABEL,
} from "@/lib/services/walletService";
import { CryptoChargePanel } from "@/components/wallet/CryptoChargePanel";
import { UsdtWithdrawPanel } from "@/components/wallet/UsdtWithdrawPanel";
import { CopyAddressButton } from "@/components/common/CopyButton";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "충전 / USDT 출금 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content:
          "포인트 충전과 USDT(TRC20) 출금을 신청하세요. 모든 신청은 관리자 확인 후 수동으로 처리됩니다.",
      },
      { property: "og:title", content: "충전 / USDT 출금 · 엔젤섯다" },
      { property: "og:description", content: "안전한 수동 승인 방식의 포인트 충전과 USDT 출금." },
    ],
  }),
  component: Wallet,
});

type PayoutDetails = { address?: string; network?: string; expected_usdt?: number } | null;

function Wallet() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<"crypto" | "withdraw" | "history">("crypto");

  const settings = useQuery({ queryKey: ["app-settings"], queryFn: fetchSettings });

  const myRequests = useQuery({
    queryKey: ["my-requests", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [charges, withdrawals] = await Promise.all([
        supabase
          .from("charge_requests")
          .select("*")
          .eq("user_id", user!.id)
          .order("requested_at", { ascending: false })
          .limit(20),
        supabase
          .from("withdrawal_requests")
          .select("*")
          .eq("user_id", user!.id)
          .order("requested_at", { ascending: false })
          .limit(20),
      ]);
      return { charges: charges.data ?? [], withdrawals: withdrawals.data ?? [] };
    },
  });

  const transactions = useQuery({
    queryKey: ["transactions", user?.id],
    enabled: !!user,
    queryFn: () => fetchTransactions(user!.id),
  });

  const rate = settings.data?.points_per_won ?? 1;

  if (!user) {
    return (
      <AppShell>
        <div className="panel-surface rounded-2xl p-10 text-center">
          <p className="text-sm">충전/출금은 로그인 후 이용할 수 있습니다.</p>
          <Button variant="gold" className="mt-4" asChild>
            <Link to="/auth">로그인</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="text-gold-plate font-display text-2xl">충전 / 출금</h1>
      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        <span className="text-muted-foreground">
          보유 <span className="text-gold">{formatPoints(profile?.game_points ?? 0)}</span>
        </span>
        <span className="text-muted-foreground">
          잠금 <span className="text-crimson">{formatPoints(profile?.locked_points ?? 0)}</span>
        </span>
        <span className="text-muted-foreground">환산 1원 = {rate}P</span>
      </div>

      <div className="mt-4 flex gap-2">
        {(
          [
            ["crypto", "USDT 자동충전"],
            ["withdraw", "USDT 출금 신청"],
            ["history", "내역"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "gold" : "table"}
            size="sm"
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[420px_1fr]">
        {tab === "crypto" && <CryptoChargePanel userId={user.id} />}

        {tab === "withdraw" && (
          <UsdtWithdrawPanel savedAddress={profile?.wallet_address ?? null} />
        )}

        <section className="space-y-4">
          <div className="panel-surface rounded-2xl p-5">
            <h3 className="font-display text-base text-gold">신청 현황</h3>
            <ul className="mt-3 space-y-2 text-xs">
              {(myRequests.data?.charges ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2">
                  <span>충전 {formatWon(c.requested_amount)}</span>
                  <span className="text-gold-soft">{formatPoints(c.point_amount)}</span>
                  <span className="text-muted-foreground">
                    {WITHDRAW_STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </li>
              ))}
              {(myRequests.data?.withdrawals ?? []).map((w) => {
                const details = (w.payout_details ?? null) as PayoutDetails;
                return (
                  <li key={w.id} className="space-y-1 rounded-lg bg-black/30 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>출금 {formatPoints(w.requested_points)}</span>
                      <span className="text-gold-soft">{formatWon(w.payout_amount)}</span>
                      <span className="text-muted-foreground">
                        {WITHDRAW_STATUS_LABEL[w.status] ?? w.status}
                      </span>
                    </div>
                    {details?.address && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 break-all font-mono text-[10px] text-muted-foreground">
                          {details.network ?? "TRC20"} · {details.address}
                        </span>
                        <CopyAddressButton address={details.address} />
                      </div>
                    )}
                  </li>
                );
              })}
              {!myRequests.data?.charges.length && !myRequests.data?.withdrawals.length && (
                <li className="text-muted-foreground">신청 내역이 없습니다.</li>
              )}
            </ul>
          </div>

          {tab === "history" && (
            <div className="panel-surface rounded-2xl p-5">
              <h3 className="font-display text-base text-gold">포인트 원장</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {(transactions.data ?? []).map((t) => (
                  <li key={t.id} className="flex items-center justify-between border-b border-border/40 py-1.5">
                    <span className="text-muted-foreground">{t.type}</span>
                    <span className={t.amount >= 0 ? "text-jade" : "text-crimson"}>
                      {t.amount >= 0 ? "+" : ""}
                      {t.amount.toLocaleString("ko-KR")}P
                    </span>
                    <span className="text-muted-foreground">{formatPoints(t.balance_after)}</span>
                  </li>
                ))}
                {transactions.data?.length === 0 && (
                  <li className="text-muted-foreground">거래 내역이 없습니다.</li>
                )}
              </ul>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
