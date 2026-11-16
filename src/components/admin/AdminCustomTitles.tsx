import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPoints } from "@/lib/services/walletService";
import {
  adminDisableCustomTitle,
  adminListCustomTitles,
  remainLabel,
} from "@/lib/services/customTitleService";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "사용중",
  EXPIRED: "만료",
  DISABLED: "사용중지",
};

const FILTERS = [
  { key: "", label: "전체" },
  { key: "ACTIVE", label: "사용중" },
  { key: "EXPIRED", label: "만료" },
  { key: "DISABLED", label: "사용중지" },
] as const;

export function AdminCustomTitles() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ["admin-custom-titles", status],
    queryFn: () => adminListCustomTitles(status || undefined),
  });

  const disable = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminDisableCustomTitle(id, reason),
    onSuccess: () => {
      toast.success("커스텀 칭호를 사용 중지했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-custom-titles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "처리에 실패했습니다."),
  });

  const rows = list.data ?? [];

  return (
    <section className="panel-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-gold">커스텀 칭호 관리</h2>
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={status === f.key ? "gold" : "table"}
              size="sm"
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="text-gold-soft/70">
            <tr>
              {["회원", "닉네임", "칭호명", "구매일", "만료일", "상태", "가격", "장착", "관리"].map(
                (h) => (
                  <th key={h} className="border-b border-border/60 pb-2 pr-3 font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/30">
                <td className="py-2 pr-3 text-muted-foreground">{r.username ?? r.userId.slice(0, 8)}</td>
                <td className="py-2 pr-3">{r.nickname ?? "-"}</td>
                <td className="py-2 pr-3 font-display text-gold">{r.title}</td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {new Date(r.purchasedAt).toLocaleString("ko-KR")}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {new Date(r.expiresAt).toLocaleString("ko-KR")}
                  {r.status === "ACTIVE" && (
                    <span className="ml-1 text-gold-soft">({remainLabel(r.expiresAt)})</span>
                  )}
                </td>
                <td className="py-2 pr-3">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="py-2 pr-3">{formatPoints(r.price)}</td>
                <td className="py-2 pr-3">{r.equipped ? "장착중" : "-"}</td>
                <td className="py-2 pr-3">
                  {r.status === "DISABLED" ? (
                    <span className="text-muted-foreground">{r.disabledReason ?? "중지됨"}</span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        value={reasons[r.id] ?? ""}
                        onChange={(e) => setReasons((p) => ({ ...p, [r.id]: e.target.value }))}
                        placeholder="사유 필수"
                        className="w-28 rounded border border-border bg-black/40 px-2 py-1 text-[11px] outline-none focus:border-gold/50"
                      />
                      <Button
                        variant="table"
                        size="sm"
                        disabled={!(reasons[r.id] ?? "").trim() || disable.isPending}
                        onClick={() =>
                          disable.mutate({ id: r.id, reason: (reasons[r.id] ?? "").trim() })
                        }
                      >
                        사용중지
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-foreground">
                  등록된 커스텀 칭호가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        사용 중지 시 사유가 관리자 로그에 기록되며 장착이 즉시 해제됩니다. 구매 이력은 삭제되지
        않습니다. 금칙어/예약어는 시스템 설정의 custom_title_banned_words ·
        custom_title_reserved_words 에서 관리합니다.
      </p>
    </section>
  );
}
