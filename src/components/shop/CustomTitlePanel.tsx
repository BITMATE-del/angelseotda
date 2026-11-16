import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPoints } from "@/lib/services/walletService";
import {
  CUSTOM_TITLE_DAYS,
  CUSTOM_TITLE_MAX_LEN,
  CUSTOM_TITLE_PRICE,
  checkCustomTitleAvailable,
  checkCustomTitleLocal,
  equipCustomTitle,
  fetchMyCustomTitles,
  purchaseCustomTitle,
  remainLabel,
  type AvailabilityResult,
} from "@/lib/services/customTitleService";
import { cn } from "@/lib/utils";

/** 커스텀 칭호 배지 (랭킹 우승 칭호보다 화려하지 않게 유지) */
export function CustomTitleChip({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-gold/45 bg-gradient-to-b from-gold/12 to-transparent px-2 py-[2px] font-display text-[12px] text-gold-soft shadow-[0_0_6px_rgba(212,175,55,0.18)]",
        className,
      )}
    >
      {text}
      <span className="rounded bg-gold/20 px-1 text-[9px] font-bold tracking-wider text-gold">
        CUSTOM
      </span>
    </span>
  );
}

export function CustomTitlePanel({ tab, canBuy }: { tab: "shop" | "inventory"; canBuy: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [check, setCheck] = useState<AvailabilityResult | null>(null);

  const mine = useQuery({
    queryKey: ["my-custom-titles"],
    enabled: canBuy,
    queryFn: fetchMyCustomTitles,
  });

  // 입력 중 실시간 중복 확인 (최종 판정은 서버 구매 시 재검증)
  useEffect(() => {
    if (!open) return;
    const local = checkCustomTitleLocal(name);
    if (!local.ok) {
      setCheck(name.trim().length === 0 ? null : local);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void checkCustomTitleAvailable(name)
        .then((r) => alive && setCheck(r))
        .catch(() => alive && setCheck(null));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [name, open]);

  const buy = useMutation({
    mutationFn: () => purchaseCustomTitle(name, crypto.randomUUID()),
    onSuccess: () => {
      toast.success(`커스텀 칭호 "${name.trim()}" 를 ${CUSTOM_TITLE_DAYS}일간 사용할 수 있습니다.`);
      setOpen(false);
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["my-custom-titles"] });
      void queryClient.invalidateQueries({ queryKey: ["equipped-title"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "구매에 실패했습니다."),
  });

  const equip = useMutation({
    mutationFn: (id: string) => equipCustomTitle(id),
    onSuccess: () => {
      toast.success("칭호를 장착했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["my-custom-titles"] });
      void queryClient.invalidateQueries({ queryKey: ["equipped-title"] });
      void queryClient.invalidateQueries({ queryKey: ["user-items"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "장착에 실패했습니다."),
  });

  const list = mine.data ?? [];

  return (
    <>
      {tab === "shop" && (
        <div className="panel-surface rounded-2xl border border-gold/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg text-gold">커스텀 칭호</h2>
                <span className="rounded-full bg-gold/15 px-2 py-[1px] text-[10px] font-bold text-gold">
                  CUSTOM
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                원하는 칭호를 직접 만들어 구매 후 {CUSTOM_TITLE_DAYS}일간 사용할 수 있습니다. (1~
                {CUSTOM_TITLE_MAX_LEN}글자 · 중복 사용 불가 · 구매 후 이름 변경 불가)
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-gold">{formatPoints(CUSTOM_TITLE_PRICE)}</p>
              <p className="text-[11px] text-gold-soft">{CUSTOM_TITLE_DAYS}일 기간제</p>
            </div>
          </div>
          <div className="mt-4">
            <Button variant="gold" size="sm" disabled={!canBuy} onClick={() => setOpen(true)}>
              {canBuy ? "칭호 만들기" : "로그인 필요"}
            </Button>
          </div>
        </div>
      )}

      {tab === "inventory" && canBuy && (
        <div className="panel-surface rounded-2xl p-5">
          <h2 className="font-display text-lg text-gold">보유 커스텀 칭호</h2>
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">보유한 커스텀 칭호가 없습니다.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {list.map((t) => {
                const active = t.status === "ACTIVE" && new Date(t.expires_at) > new Date();
                return (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-black/30 px-4 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <CustomTitleChip text={t.title_text} />
                      {t.equipped && (
                        <span className="rounded-full bg-gold/20 px-1.5 py-[1px] text-[10px] font-bold text-gold">
                          장착중
                        </span>
                      )}
                      {!active && (
                        <span className="rounded-full bg-charcoal px-1.5 py-[1px] text-[10px] font-bold text-muted-foreground">
                          {t.status === "DISABLED" ? "사용 중지" : "만료"}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {active ? `남은 기간 ${remainLabel(t.expires_at)}` : "기간 종료"}
                      {t.disabled_reason ? ` · ${t.disabled_reason}` : ""}
                    </p>
                    <Button
                      variant={t.equipped ? "goldOutline" : "gold"}
                      size="sm"
                      disabled={!active || t.equipped || equip.isPending}
                      onClick={() => equip.mutate(t.id)}
                    >
                      {t.equipped ? "장착중" : "장착하기"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="panel-surface gold-frame w-full max-w-md rounded-2xl p-6">
            <h3 className="font-display text-xl text-gold">커스텀 칭호</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              원하는 칭호를 만들어 {CUSTOM_TITLE_DAYS}일간 사용할 수 있습니다.
            </p>

            <label className="mt-5 block text-xs text-gold-soft">칭호명</label>
            <input
              value={name}
              maxLength={CUSTOM_TITLE_MAX_LEN}
              onChange={(e) => setName(e.target.value)}
              placeholder="예) 패왕"
              className="mt-1 w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              1~{CUSTOM_TITLE_MAX_LEN}글자 · 중복 사용 불가 · 구매 후 이름 변경 불가
            </p>
            {check && (
              <p className={cn("mt-2 text-[12px]", check.ok ? "text-jade" : "text-crimson")}>
                {check.ok ? "사용 가능한 칭호입니다." : check.message}
              </p>
            )}

            <div className="mt-4 rounded-xl border border-border bg-black/30 p-4">
              <p className="text-[11px] text-muted-foreground">미리보기</p>
              <div className="mt-2">
                <CustomTitleChip text={name.trim() || "칭호"} />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="font-display text-gold">{formatPoints(CUSTOM_TITLE_PRICE)}</p>
              <div className="flex gap-2">
                <Button variant="table" size="sm" onClick={() => setOpen(false)}>
                  닫기
                </Button>
                <Button
                  variant="gold"
                  size="sm"
                  disabled={!check?.ok || buy.isPending}
                  onClick={() => buy.mutate()}
                >
                  구매하기
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
