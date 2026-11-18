import { SUTDA2_TABLE, tableRowCards } from "@/lib/game/sutda2Rules";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  kwangttaeng: "광땡",
  ttaeng: "땡",
  special: "특수 족보",
  kkeut: "끗",
};

export function HandRankChart({ className }: { className?: string }) {
  const groups = ["kwangttaeng", "ttaeng", "special"] as const;

  return (
    <aside className={cn("panel-surface rounded-2xl p-4", className)}>
      <h3 className="text-gold-plate font-display text-lg">족보표</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">위쪽이 강한 패입니다</p>

      <div className="mt-3 space-y-3">
        {groups.map((group) => (
          <div key={group}>
            <p className="text-[11px] font-semibold tracking-wide text-gold-soft/80">
              {CATEGORY_LABEL[group]}
            </p>
            <ul className="mt-1 space-y-0.5">
              {SUTDA2_TABLE.filter((r) => r.category === group).map((row) => {
                const [imgA, imgB] = tableRowCards(row);
                return (
                  <li
                    key={row.code}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs text-foreground/85 odd:bg-white/[0.03]"
                  >
                    <span>{row.name}</span>
                    <span className="flex shrink-0 gap-1">
                      <img
                        src={imgA}
                        alt=""
                        className="h-9 w-6 rounded-[3px] object-cover ring-1 ring-gold/25"
                        loading="lazy"
                      />
                      <img
                        src={imgB}
                        alt=""
                        className="h-9 w-6 rounded-[3px] object-cover ring-1 ring-gold/25"
                        loading="lazy"
                      />
                    </span>
                  </li>
                );
              })}

            </ul>
          </div>
        ))}
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-gold-soft/80">끗</p>
          <p className="mt-1 rounded-md bg-white/[0.03] px-2 py-1.5 text-xs leading-relaxed text-foreground/75">
            두 패의 합을 10으로 나눈 나머지. 갑오(9끗)가 가장 높고 0은 망통입니다.
          </p>
        </div>
      </div>
    </aside>
  );
}
