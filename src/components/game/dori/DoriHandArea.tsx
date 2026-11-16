import { HwatuCard } from "@/components/game/HwatuCard";
import { doriMonthOf } from "@/lib/game/dori/doriRules";
import { cn } from "@/lib/utils";

/**
 * DoriHandArea — 내 5장 표시 (짓기 단계가 아닐 때).
 * 겹치지 않게 나란히 크게 배치하고, 짓기 확정 후에는 선택 3장/승부 2장을 구분한다.
 */
export function DoriHandArea({
  cards,
  selectedCards,
  remainingCards,
}: {
  cards: string[];
  selectedCards?: string[] | null;
  remainingCards?: string[] | null;
}) {
  const made = !!selectedCards && selectedCards.length === 3;
  const ordered = made ? [...(selectedCards ?? []), ...(remainingCards ?? [])] : cards;

  return (
    <div className="flex items-end gap-3">
      {ordered.map((card, i) => {
        const isMakeCard = made && i < 3;
        return (
          <div key={`${card}-${i}`} className="text-center">
            <HwatuCard
              cardId={card}
              size="lg"
              className={cn(
                made && (isMakeCard ? "opacity-75" : "ring-2 ring-gold"),
              )}
            />
            <span className="mt-1 block text-[11px] text-foreground/70">
              {made ? (isMakeCard ? "짓기" : "승부") : `${doriMonthOf(card)}월`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
