import { tierOf, type AppRank } from "@/lib/game/rankTiers";
import { cn } from "@/lib/utils";

/** 계급 배지 — 계급별 컬러/라벨을 일관되게 노출한다. */
export function RankBadge({
  rank,
  size = "md",
  className,
}: {
  rank: AppRank | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tier = tierOf(rank);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-display tracking-wide",
        tier.badgeClass,
        size === "sm" && "px-1.5 py-0.5 text-[10px]",
        size === "md" && "px-2.5 py-1 text-[11px]",
        size === "lg" && "px-4 py-2 text-sm",
        className,
      )}
      title={tier.summary}
    >
      {size === "lg" && <span aria-hidden>♛</span>}
      {tier.label}
    </span>
  );
}
