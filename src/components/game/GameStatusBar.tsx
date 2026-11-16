import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * GameStatusBar — Action Bar 위 한 줄. 현재 phase와 정확히 일치하는 안내 + 남은 시간.
 */
export function GameStatusBar({
  message,
  phaseLabel,
  deadline,
  paused = false,
  className,
}: {
  message: string;
  phaseLabel?: string | null;
  /** 서버 turn_deadline_at (ISO) */
  deadline?: string | null;
  paused?: boolean;
  className?: string;
}) {
  const [remain, setRemain] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setRemain(null);
      return;
    }
    const tick = () =>
      setRemain(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [deadline]);

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-gold/20 bg-black/45 px-4 py-2",
        paused && "border-destructive/50",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {phaseLabel && (
          <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 font-display text-[11px] tracking-[0.15em] text-gold">
            {phaseLabel}
          </span>
        )}
        <p className={cn("truncate text-[13px]", paused ? "text-destructive" : "text-foreground/85")}>
          {message}
        </p>
      </div>
      {remain !== null && (
        <span className="shrink-0 font-display text-sm text-gold-soft">
          남은 시간 <span className="text-gold">{remain}</span>
        </span>
      )}
    </div>
  );
}
