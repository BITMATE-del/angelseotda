import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPoints } from "@/lib/services/walletService";
import {
  cancelRareOffer,
  fetchMyRareOffers,
  fetchReceivedRareOffers,
  respondRareOffer,
} from "@/lib/services/rareOfferService";
import { OFFER_STATUS_LABEL } from "@/lib/shop/rareOwnership";

function StatusChip({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-charcoal px-1.5 py-[1px] text-[10px] font-bold text-muted-foreground">
      {OFFER_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function timeText(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", { hour12: false });
}

/** 받은 입찰(보유자) / 내 입찰(입찰자) — 개인정보 없이 닉네임만 노출한다. */
export function RareOffersPanel({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();

  const received = useQuery({
    queryKey: ["received-rare-offers"],
    enabled,
    queryFn: fetchReceivedRareOffers,
  });
  const mine = useQuery({
    queryKey: ["my-rare-offers"],
    enabled,
    queryFn: fetchMyRareOffers,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["received-rare-offers"] });
    void queryClient.invalidateQueries({ queryKey: ["my-rare-offers"] });
  };

  const respond = useMutation({
    mutationFn: (v: { id: string; decision: "ACCEPTED" | "DECLINED" }) =>
      respondRareOffer(v.id, v.decision),
    onSuccess: () => {
      toast.success("처리했습니다.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "처리에 실패했습니다."),
  });

  const cancel = useMutation({
    mutationFn: cancelRareOffer,
    onSuccess: () => {
      toast.success("입찰을 취소했습니다.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "취소에 실패했습니다."),
  });

  if (!enabled) return null;

  const receivedRows = received.data ?? [];
  const myRows = mine.data ?? [];
  if (receivedRows.length === 0 && myRows.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {receivedRows.length > 0 && (
        <section className="panel-surface rounded-2xl p-5">
          <h2 className="font-display text-lg text-gold">받은 입찰</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            현재 단계에서는 의사 전달까지만 가능합니다. 소유권은 이전되지 않습니다.
          </p>
          <ul className="mt-3 space-y-2">
            {receivedRows.map((o) => (
              <li key={o.id} className="rounded-xl border border-border bg-black/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{o.item_name}</span>
                  <StatusChip status={o.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {o.bidder_nickname} · {formatPoints(o.offer_amount)} · {timeText(o.created_at)}
                </p>
                {o.message && <p className="mt-1 text-xs text-gold-soft">“{o.message}”</p>}
                {o.status === "PENDING" && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="table"
                      size="sm"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: o.id, decision: "DECLINED" })}
                    >
                      거절
                    </Button>
                    <Button
                      variant="gold"
                      size="sm"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: o.id, decision: "ACCEPTED" })}
                    >
                      관심 있음
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {myRows.length > 0 && (
        <section className="panel-surface rounded-2xl p-5">
          <h2 className="font-display text-lg text-gold">내 입찰</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            입찰 신청만으로 포인트가 차감되지 않습니다.
          </p>
          <ul className="mt-3 space-y-2">
            {myRows.map((o) => (
              <li key={o.id} className="rounded-xl border border-border bg-black/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{o.item_name}</span>
                  <StatusChip status={o.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatPoints(o.offer_amount)} · {timeText(o.created_at)}
                </p>
                {o.status === "PENDING" && (
                  <Button
                    variant="table"
                    size="sm"
                    className="mt-2"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(o.id)}
                  >
                    입찰 취소
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
