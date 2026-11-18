import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyAddressButton } from "@/components/common/CopyButton";
import {
  type AdminMemberRow,
  cancelDepositManually,
  CRYPTO_STATUS_LABEL,
  DEPOSIT_STATUS_LABEL,
  fetchUnmatchedDeposits,
  manualCreditDeposit,
  manualCreditOrphanDeposit,
  searchMembers,
  type UnmatchedDepositRow,
} from "@/lib/services/cryptoChargeService";
import { formatPoints, formatWon } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";

const FILTERS: { key: string; label: string }[] = [
  { key: "UNMATCHED", label: "미매칭" },
  { key: "DETECTED", label: "대기" },
  { key: "MATCHED", label: "자동확인중" },
  { key: "CREDITED", label: "지급완료" },
  { key: "CANCELLED", label: "취소" },
  { key: "ALL", label: "전체" },
];

const usdt = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : `${Number(v).toFixed(6)} USDT`;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all text-right text-foreground">{value}</span>
    </div>
  );
}

/**
 * 자동 매칭에 실패한 입금(미매칭)을 관리자가 확인 후 수동 승인/취소하는 화면.
 * 지급은 기존 자동충전 정산 경로(credit_crypto_charge)를 서버에서 그대로 재사용한다.
 */
export function AdminUnmatchedDeposits() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("UNMATCHED");
  const [open, setOpen] = useState<null | { row: UnmatchedDepositRow; mode: "APPROVE" | "CANCEL" }>(
    null,
  );
  const [reason, setReason] = useState("");
  /** 신청이 연결되지 않은 입금에서 관리자가 직접 지정한 회원 */
  const [member, setMember] = useState<AdminMemberRow | null>(null);
  const [memberQuery, setMemberQuery] = useState("");

  const memberSearch = useQuery({
    queryKey: ["admin-member-search", memberQuery],
    enabled: memberQuery.trim().length >= 2,
    queryFn: () => searchMembers(memberQuery.trim()),
  });

  const closeDialog = () => {
    setOpen(null);
    setReason("");
    setMember(null);
    setMemberQuery("");
  };

  const list = useQuery({
    queryKey: ["crypto-unmatched", filter],
    queryFn: () => fetchUnmatchedDeposits(filter),
    refetchInterval: 15_000,
  });

  const refresh = () => {
    for (const key of [
      "crypto-unmatched",
      "crypto-overview",
      "crypto-requests",
      "chain-deposits",
      "crypto-feed",
    ])
      void queryClient.invalidateQueries({ queryKey: [key] });
  };

  const approve = useMutation({
    mutationFn: (v: { row: UnmatchedDepositRow; reason: string; userId?: string }) =>
      v.row.request_id
        ? manualCreditDeposit({
            depositId: v.row.deposit_id,
            requestId: v.row.request_id,
            reason: v.reason,
          })
        : manualCreditOrphanDeposit({
            depositId: v.row.deposit_id,
            userId: v.userId!,
            reason: v.reason,
          }),
    onSuccess: (r) => {
      toast.success(`수동 승인 완료 · ${formatPoints(r.points ?? 0)} 지급`);
      setOpen(null);
      setReason("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "수동 승인 실패"),
  });

  const cancel = useMutation({
    mutationFn: (v: { row: UnmatchedDepositRow; reason: string }) =>
      cancelDepositManually({
        depositId: v.row.deposit_id,
        requestId: v.row.request_id,
        reason: v.reason,
      }),
    onSuccess: () => {
      toast.success("입금 신청을 취소했습니다.");
      setOpen(null);
      setReason("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "취소 실패"),
  });

  const rows = list.data ?? [];
  const busy = approve.isPending || cancel.isPending;

  return (
    <section className="panel-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base text-gold">미매칭 입금 · 수동 처리</h2>
        <span className="text-[11px] text-muted-foreground">
          신청 수량과 실제 입금 수량이 다른 건을 확인 후 처리합니다.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "gold" : "table"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">해당 조건의 입금 기록이 없습니다.</p>
        )}
        {rows.map((r) => {
          // 실제 온체인 입금이 확인된 건은 충전 신청 연결 여부와 무관하게 수동 승인 대상이다.
          const canApprove =
            r.confirmed &&
            r.deposit_status !== "CREDITED" &&
            r.deposit_status !== "CANCELLED" &&
            r.request_status !== "CREDITED" &&
            r.request_status !== "CANCELLED";
          const canCancel =
            r.deposit_status !== "CREDITED" && r.request_status !== "CREDITED";
          return (
            <div
              key={r.deposit_id}
              className={cn(
                "rounded-xl border bg-black/30 p-4 text-xs",
                r.deposit_status === "UNMATCHED" ? "border-crimson/50" : "border-border",
              )}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-display text-[11px]",
                    r.deposit_status === "UNMATCHED"
                      ? "bg-crimson/15 text-crimson"
                      : "bg-gold/15 text-gold",
                  )}
                >
                  {DEPOSIT_STATUS_LABEL[r.deposit_status] ?? r.deposit_status}
                </span>
                {r.manual_action === "MANUAL_APPROVED" && (
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">
                    수동승인
                  </span>
                )}
                {r.manual_action === "MANUAL_CANCELLED" && (
                  <span className="rounded-full bg-black/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                    수동취소
                  </span>
                )}
                <span className="text-muted-foreground">
                  {r.nickname ?? "신청 미연결"}
                  {r.username ? ` (${r.username})` : ""}
                </span>
                {!r.confirmed && <span className="text-crimson">블록 승인 대기</span>}
              </div>

              <div className="grid gap-x-6 sm:grid-cols-2">
                <Row label="회원 ID" value={r.user_id ?? "-"} />
                <Row
                  label="현재 신청 상태"
                  value={
                    r.request_status
                      ? (CRYPTO_STATUS_LABEL[r.request_status] ?? r.request_status)
                      : "연결된 신청 없음"
                  }
                />
                <Row label="신청 수량" value={usdt(r.requested_usdt)} />
                <Row label="실제 확인 수량" value={usdt(r.actual_usdt)} />
                <Row
                  label="차이"
                  value={
                    r.diff_usdt === null ? (
                      "-"
                    ) : (
                      <span className={r.diff_usdt < 0 ? "text-crimson" : "text-gold"}>
                        {r.diff_usdt > 0 ? "+" : ""}
                        {Number(r.diff_usdt).toFixed(6)} USDT
                      </span>
                    )
                  }
                />
                <Row
                  label="적용 환율"
                  value={
                    r.rate_krw_per_usdt
                      ? `1 USDT = ${Number(r.rate_krw_per_usdt).toLocaleString("ko-KR")}원`
                      : "-"
                  }
                />
                <Row
                  label="신청 금액"
                  value={r.requested_krw !== null ? formatWon(r.requested_krw) : "-"}
                />
                <Row
                  label="지급 기준 금액"
                  value={r.settle_krw !== null ? formatWon(r.settle_krw) : "-"}
                />
                <Row
                  label={`수수료 (${(r.fee_rate * 100).toFixed(0)}%)`}
                  value={r.est_fee !== null ? `-${formatWon(r.est_fee)}` : "-"}
                />
                <Row
                  label="지급 예정 포인트"
                  value={
                    r.est_points !== null ? (
                      <span className="text-gold">{formatPoints(r.est_points)}</span>
                    ) : (
                      "-"
                    )
                  }
                />
                <Row
                  label="신청 시간"
                  value={r.requested_at ? new Date(r.requested_at).toLocaleString("ko-KR") : "-"}
                />
                <Row label="감지 시간" value={new Date(r.detected_at).toLocaleString("ko-KR")} />
                <Row label="TXID" value={<span className="font-mono">{r.txid}</span>} />
                <Row
                  label="입금 주소"
                  value={<span className="font-mono">{r.to_address}</span>}
                />
                <Row label="자동매칭 실패 사유" value={r.note?.trim() || "수량 불일치 또는 후보 없음"} />
                <Row label="관리자 메모" value={r.manual_reason ?? "-"} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <CopyAddressButton address={r.txid} label="TXID 복사" />
                <CopyAddressButton address={r.to_address} label="주소 복사" />
                <Button
                  size="sm"
                  variant="gold"
                  disabled={!canApprove || busy}
                  onClick={() => {
                    setReason("");
                    setMember(null);
                    setMemberQuery("");
                    setOpen({ row: r, mode: "APPROVE" });
                  }}
                >
                  {r.request_id ? "수동 승인" : "회원 연결 후 수동 승인"}
                </Button>
                <Button
                  size="sm"
                  variant="table"
                  disabled={!canCancel || busy}
                  onClick={() => {
                    setReason("");
                    setMember(null);
                    setMemberQuery("");
                    setOpen({ row: r, mode: "CANCEL" });
                  }}
                >
                  입금 취소
                </Button>
              </div>
              {!r.request_id && (
                <p className="mt-2 text-[11px] text-gold-soft">
                  연결된 신청 없음 · 회원 미지정 — 수동 승인 시 관리자가 대상 회원을 직접 선택합니다.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!open} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open?.mode === "APPROVE" ? "수동 입금 승인" : "입금 신청 취소"}
            </DialogTitle>
            <DialogDescription>
              {open?.mode === "APPROVE"
                ? "실제 확인된 입금 수량을 기준으로 기존 충전 지급 규칙(수수료 포함)이 적용됩니다."
                : "포인트는 지급되지 않으며 이후 자동 지급도 되지 않습니다. 실제 코인 반환은 별도로 처리해야 합니다."}
            </DialogDescription>
          </DialogHeader>

          {open && (
            <div className="space-y-2 text-xs">
              <Row
                label="회원"
                value={
                  open.row.request_id
                    ? (open.row.nickname ?? open.row.user_id ?? "-")
                    : member
                      ? `${member.username ?? "-"} / ${member.nickname ?? "-"}`
                      : "미지정"
                }
              />
              <Row label="TXID" value={<span className="font-mono">{open.row.txid}</span>} />
              <Row
                label="입금 주소"
                value={<span className="font-mono">{open.row.to_address}</span>}
              />
              <Row label="신청 수량" value={usdt(open.row.requested_usdt)} />
              <Row label="실제 입금" value={usdt(open.row.actual_usdt)} />

              {open.mode === "APPROVE" && !open.row.request_id && (
                <div className="space-y-2 rounded-lg border border-border bg-black/30 p-3">
                  <Label htmlFor="member-search">대상 회원 검색 (아이디 / 닉네임 / 회원ID)</Label>
                  <Input
                    id="member-search"
                    value={memberQuery}
                    maxLength={60}
                    placeholder="예: test01"
                    onChange={(e) => {
                      setMemberQuery(e.target.value);
                      setMember(null);
                    }}
                  />
                  {memberQuery.trim().length >= 2 && (
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {memberSearch.isLoading && (
                        <p className="text-[11px] text-muted-foreground">검색 중…</p>
                      )}
                      {memberSearch.data?.length === 0 && (
                        <p className="text-[11px] text-muted-foreground">검색 결과가 없습니다.</p>
                      )}
                      {(memberSearch.data ?? []).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMember(m)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px]",
                            member?.id === m.id
                              ? "bg-gold/20 text-gold"
                              : "bg-black/40 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span>
                            {m.username ?? "-"} / {m.nickname ?? "-"}
                          </span>
                          <span>{formatPoints(m.game_points ?? 0)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {member && (
                    <p className="text-[11px] text-gold-soft">
                      선택: {member.username} / {member.nickname} — 이 회원에게 실제 입금{" "}
                      {usdt(open.row.actual_usdt)} 기준으로 지급합니다.
                    </p>
                  )}
                </div>
              )}

              {open.mode === "APPROVE" && (
                <>
                  <Row
                    label="지급 기준 금액"
                    value={open.row.settle_krw !== null ? formatWon(open.row.settle_krw) : "-"}
                  />
                  <Row
                    label="지급 예정"
                    value={
                      open.row.est_points !== null ? formatPoints(open.row.est_points) : "-"
                    }
                  />
                </>
              )}
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="manual-reason">처리 사유 (필수)</Label>
                <Input
                  id="manual-reason"
                  value={reason}
                  maxLength={200}
                  placeholder={
                    open.mode === "APPROVE"
                      ? "예: 입금 수량 오입력, 실제 99.8 USDT 확인"
                      : "예: 입금 내역 확인 불가"
                  }
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="table" disabled={busy} onClick={closeDialog}>
              취소
            </Button>
            <Button
              variant="gold"
              disabled={
                busy ||
                reason.trim().length < 2 ||
                !open ||
                // 회원 미지정 상태에서는 승인할 수 없다.
                (open.mode === "APPROVE" && !open.row.request_id && !member)
              }
              onClick={() => {
                if (!open) return;
                const base = { row: open.row, reason: reason.trim() };
                if (open.mode === "APPROVE")
                  approve.mutate(member ? { ...base, userId: member.id } : base);
                else cancel.mutate(base);
              }}
            >
              {busy ? "처리 중…" : open?.mode === "APPROVE" ? "승인" : "취소 처리"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
