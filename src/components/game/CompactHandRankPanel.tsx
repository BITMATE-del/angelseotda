import { SUTDA2_TABLE } from "@/lib/game/sutda2Rules";
import { cn } from "@/lib/utils";

/** 우측 보조 족보 패널 — 게임판을 침범하지 않는 작은 요약 패널 */
export function CompactHandRankPanel({
  className,
  myHandCode = null,
}: {
  className?: string;
  /** 내 확정 족보 (SHOWDOWN 이후 강조 표시) */
  myHandCode?: string | null;
}) {
  const rows = SUTDA2_TABLE.filter((r) => r.category !== "kkeut").slice(0, 12);

  return (
    <aside
      className={cn(
        "rounded-xl border border-gold/20 bg-black/40 px-2.5 py-2 backdrop-blur-[2px]",
        className,
      )}
    >
      <p className="font-display text-[12px] tracking-[0.12em] text-gold">족보 안내</p>
      <ol className="mt-1.5 space-y-0.5">
        {rows.map((row, i) => (
          <li
            key={row.code}
            className={cn(
              "flex items-center gap-2 rounded px-1.5 py-0.5 text-[11px] text-foreground/80",
              row.code === myHandCode && "bg-gold/15 text-gold ring-1 ring-gold/50",
            )}
          >
            <span className="w-4 shrink-0 text-center text-[10px] text-muted-foreground">
              {i + 1}
            </span>
            <span className="truncate">{row.name}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1.5 rounded bg-white/[0.03] px-1.5 py-1 text-[10px] leading-relaxed text-foreground/65">
        끗은 두 패 합의 10 나머지. 갑오(9끗)가 가장 높고 0은 망통입니다.
      </p>
    </aside>
  );
}
