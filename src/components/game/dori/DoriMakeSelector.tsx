import { HwatuCard } from "@/components/game/HwatuCard";
import { Button } from "@/components/ui/button";
import {
  doriMonthOf,
  evaluateDoriPairCards,
  isDoriMakeTotal,
} from "@/lib/game/dori/doriRules";

import { cn } from "@/lib/utils";

/**
 * DoriMakeSelector — 내 5장에서 짓기 3장을 직접 고른다.
 * 여러 조합이 가능해도 자동 확정하지 않고 사용자가 선택한다.
 */
export function DoriMakeSelector({
  cards,
  selected,
  onToggle,
  onSubmit,
  submitting,
  hwang,
}: {
  cards: string[];
  selected: string[];
  onToggle: (card: string) => void;
  onSubmit: () => void;
  submitting?: boolean;
  hwang: boolean;
}) {
  const total = selected.reduce((s, c) => s + doriMonthOf(c), 0);
  const ok = selected.length === 3 && isDoriMakeTotal(total);
  const remaining = cards.filter((c) => !selected.includes(c));
  const hand =
    ok && remaining.length === 2
      ? evaluateDoriPairCards(remaining[0]!, remaining[1]!)
      : null;


  return (
    <div className="rounded-2xl border border-gold/25 bg-black/55 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm text-gold">짓기 — 3장을 선택하세요 (합 10 · 20 · 30)</h3>
        {hwang && <span className="text-[12px] text-destructive">짓기 실패 · 황</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {cards.map((card) => {
          const isSel = selected.includes(card);
          return (
            <button
              key={card}
              type="button"
              onClick={() => onToggle(card)}
              className={cn(
                "rounded-lg transition-transform",
                isSel ? "-translate-y-2 ring-2 ring-gold" : "ring-1 ring-transparent",
              )}
            >
              <HwatuCard cardId={card} size="lg" />
              <span className="mt-1 block text-center text-[11px] text-foreground/70">
                {doriMonthOf(card)}월
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid gap-1 text-[13px]">
        <p className="text-foreground/80">
          선택 합계 <span className="font-display text-gold">{total}</span> ·{" "}
          {selected.length !== 3 ? (
            <span className="text-foreground/60">3장을 선택하세요</span>
          ) : ok ? (
            <span className="text-jade">짓기 성공</span>
          ) : (
            <span className="text-destructive">10 · 20 · 30 이 아닙니다</span>
          )}
        </p>
        <p className="text-foreground/70">
          남은 패{" "}
          <span className="text-gold-soft">
            {remaining.map((c) => `${doriMonthOf(c)}월`).join(" · ") || "-"}
          </span>{" "}
          {hand && <span className="text-gold">→ {hand.label}</span>}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="gold" size="sm" disabled={!ok || submitting} onClick={onSubmit}>
          이 조합으로 짓기
        </Button>
        {hwang && (
          <span className="text-[12px] text-foreground/70">
            어떤 3장으로도 10 · 20 · 30을 만들 수 없어 황으로 진행됩니다.
          </span>
        )}
      </div>
    </div>
  );
}
