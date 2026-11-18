import { doriMonthOf } from "@/lib/game/dori/doriRules";
import { formatPoints } from "@/lib/services/walletService";
import type { DoriRoundInfo, DoriSeatState } from "@/lib/services/doriService";
import { cn } from "@/lib/utils";

/** SHOWDOWN 결과 — 짓기 3장 / 승부 2장 / 족보를 구분해서 보여준다. */
export function DoriResultPanel({
  round,
  seats,
}: {
  round: DoriRoundInfo;
  seats: DoriSeatState[];
}) {
  const rematch = round.settlementStatus === "REMATCH";
  const rows = seats.filter((s) => s.inRound);

  return (
    <div className="rounded-2xl border border-gold/30 bg-black/70 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base text-gold">
          {rematch ? `${round.rematchReason ?? "동점 · 재경기"} (판돈 이월)` : "라운드 결과"}
        </h3>
        <span className="font-display text-sm text-gold-soft">POT {formatPoints(round.pot)}</span>
      </div>

      <ul className="mt-3 grid gap-2">
        {rows.map((s) => (
          <li
            key={s.userId}
            className={cn(
              "rounded-xl border px-3 py-2 text-[13px]",
              s.resultType === "WIN"
                ? "border-gold/60 bg-gold/10"
                : "border-gold/15 bg-black/40",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-foreground/90">
                {s.seat}번 · {s.nickname}
              </span>
              <span
                className={cn(
                  "font-display",
                  s.resultType === "WIN"
                    ? "text-gold"
                    : s.resultType === "REMATCH"
                      ? "text-jade"
                      : "text-foreground/60",
                )}
              >
                {s.folded
                  ? "다이"
                  : s.resultType === "WIN"
                    ? "승"
                    : s.resultType === "REMATCH"
                      ? "재경기"
                      : "패"}
              </span>
            </div>
            {!s.folded && (
              <div className="mt-1 grid gap-0.5 text-[12px] text-foreground/75">
                {s.makeStatus === "HWANG" || !s.selectedCards ? (
                  <p className="text-destructive">짓기 실패 · 황</p>
                ) : (
                  <>
                    <p>
                      [짓기]{" "}
                      {s.selectedCards.map((c) => doriMonthOf(c)).join(" + ")} ={" "}
                      <span className="text-gold">{s.makeTotal}</span>
                    </p>
                    <p>
                      [승부패] {(s.remainingCards ?? []).map((c) => doriMonthOf(c)).join(" + ")}
                    </p>
                  </>
                )}
                <p>
                  [족보] <span className="text-gold">{s.handLabel ?? "황"}</span>
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
