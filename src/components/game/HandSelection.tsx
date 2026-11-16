import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HwatuCard } from "./HwatuCard";
import { comboOptions } from "@/lib/game/sutda3Rules";
import { cn } from "@/lib/utils";

/**
 * 3장 섯다 최종 승부패 선택 패널.
 * - 자동 선택은 하지 않는다(옵션 구조만 준비, 기본 OFF).
 * - 확정 후에는 변경할 수 없다.
 */
export function HandSelection({
  cards,
  confirmed,
  autoPickBest = false,
  onConfirm,
}: {
  cards: readonly string[];
  confirmed: string[] | null;
  autoPickBest?: boolean;
  onConfirm: (cards: [string, string]) => void;
}) {
  const options = comboOptions(cards);
  const [picked, setPicked] = useState<number | null>(null);

  if (options.length === 0) return null;

  const confirmedKey = confirmed ? [...confirmed].sort().join("|") : null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-3 py-2">
      <p className="w-full text-center font-display text-[13px] text-gold">
        {confirmed ? "승부패가 확정되었습니다." : "최종 승부할 패를 선택하세요."}
      </p>
      <div className="flex flex-wrap items-stretch justify-center gap-3">

        {options.map((option, index) => {
          const key = [...option.cards].sort().join("|");
          const isConfirmed = confirmedKey === key;
          const isPicked = confirmed ? isConfirmed : picked === index;
          return (
            <button
              key={key}
              type="button"
              disabled={!!confirmed}
              onClick={() => setPicked(index)}
              className={cn(
                "rounded-xl border bg-black/35 px-3 py-2.5 text-center transition",
                isPicked
                  ? "border-gold ring-1 ring-gold/70 shadow-[0_0_18px_-6px_var(--gold)]"
                  : "border-gold/20 hover:border-gold/50",
                confirmed && !isConfirmed && "opacity-35 saturate-50",
              )}
            >
              <span className="flex justify-center gap-1.5">
                {option.cards.map((id) => (
                  <HwatuCard key={id} cardId={id} size="md" />
                ))}
              </span>
              <span className="mt-1.5 block font-display text-sm text-gold-soft">
                {option.hand.name}
              </span>
            </button>
          );
        })}
      </div>
      {!confirmed && (
        <div className="flex items-center justify-center gap-3">

          <Button
            variant="gold"
            disabled={picked === null}
            onClick={() => {
              const option = picked !== null ? options[picked] : null;
              if (option) onConfirm(option.cards);
            }}
          >
            이 패로 승부
          </Button>
          {autoPickBest && (
            <span className="text-[11px] text-muted-foreground">최고 족보 자동 선택 ON</span>
          )}
        </div>
      )}
    </div>
  );
}
