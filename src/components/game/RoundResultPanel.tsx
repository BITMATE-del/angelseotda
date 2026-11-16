import type { EngineState } from "@/lib/game/engine";
import { formatPoints } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";
import { rematchReasonLabel, type RematchReason } from "@/lib/game/gusaRematch";

const SPECIAL_LABEL: Record<string, string> = {
  kwang38: "38광땡",
  kwang18: "18광땡",
  kwang13: "13광땡",
  ali: "알리",
  doksa: "독사",
  gubing: "구삥",
  jangbing: "장삥",
  jangsa: "장사",
  seryuk: "세륙",
  gusa: "구사",
  gusa_meongteong: "멍텅구리구사",
  amhaeng: "암행어사",
  ttaengjabi: "땡잡이",
};

/**
 * RoundResultPanel — C. DECISION ZONE 안에서만 렌더링되는 결과 안내.
 * 테이블/POT 위에 겹치지 않으며, 카드는 TABLE ZONE 에서 계속 보인다.
 */
export function RoundResultPanel({
  state,
  nextRoundIn,
  rematch = false,
  rematchReason = null,
  carryPot = 0,
}: {
  state: EngineState;
  nextRoundIn: number | null;
  rematch?: boolean;
  rematchReason?: RematchReason | null;
  carryPot?: number;
}) {
  if (rematch) {
    return (
      <div className="animate-result flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="font-display text-lg text-crimson">
          {rematchReasonLabel(rematchReason)} · 2장 재경기
        </p>
        <p className="text-[12px] text-gold">이월 POT {formatPoints(carryPot)}</p>
        {nextRoundIn !== null && (
          <p className="text-[11px] tracking-widest text-gold-soft">NEXT {nextRoundIn}</p>
        )}
      </div>
    );
  }

  const winners = state.players.filter((p) => state.winners.includes(p.userId));
  const hand = winners[0]?.hand;

  return (
    <div className="animate-result flex h-full flex-col items-center justify-center gap-1 text-center">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="font-display text-base text-gold">
          {winners.length > 1 ? "무승부 DRAW" : "승리 WINNER"}
        </span>
        <span className="max-w-[220px] truncate text-[13px] text-foreground">
          {winners.map((w) => w.nickname).join(", ") || "-"}
        </span>
        {hand && (
          <span className="text-[12px] text-gold-soft">{SPECIAL_LABEL[hand.code] ?? hand.name}</span>
        )}
        <span className="text-[13px] text-gold">획득 POT {formatPoints(state.pot)}</span>
        {nextRoundIn !== null && (
          <span className="text-[11px] tracking-widest text-gold-soft">
            NEXT ROUND {nextRoundIn}
          </span>
        )}
      </div>
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[11px]">
        {state.players.map((p) => {
          const delta =
            p.initialPoints != null && p.finalPoints != null ? p.finalPoints - p.initialPoints : null;
          return (
            <span key={p.userId} className="flex items-center gap-1">
              <span className="text-foreground/70">{p.nickname}</span>
              <span
                className={cn(
                  "font-display",
                  delta === null || delta === 0
                    ? "text-muted-foreground"
                    : delta > 0
                      ? "text-jade"
                      : "text-crimson",
                )}
              >
                {delta === null ? "-" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("ko-KR")}P`}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
