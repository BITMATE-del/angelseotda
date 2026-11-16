import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ReadyBar — 판 시작 전 대기 상태 바.
 * READY 여부/인원/시작 조건은 100% 서버 상태(room_table_state)를 그대로 표시한다.
 */
export function ReadyBar({
  seatedCount,
  readyCount,
  iAmReady,
  readyRequired,
  starting,
  disabled,
  onToggle,
}: {
  seatedCount: number;
  readyCount: number;
  iAmReady: boolean;
  /** 서버가 전원 READY를 요구하는 상태인지 */
  readyRequired: boolean;
  /** 곧 시작 (전원 READY 충족) */
  starting: boolean;
  disabled?: boolean;
  onToggle: (ready: boolean) => void;
}) {
  const message = !readyRequired
    ? "다음 판은 자동으로 시작됩니다."
    : seatedCount < 2
      ? "상대 플레이어를 기다리는 중입니다. (최소 2명)"
      : starting
        ? "전원 준비 완료 — 곧 판이 시작됩니다."
        : iAmReady
          ? "상대 플레이어의 준비를 기다리는 중입니다."
          : "준비를 누르면 판이 시작됩니다.";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-3 py-2",
        starting ? "border-jade/50 bg-jade/10" : "border-gold/25 bg-charcoal/85",
      )}
    >
      <span className="font-display text-[13px] text-gold">
        준비 {readyCount}/{seatedCount}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">{message}</span>
      {readyRequired && (
        <Button
          variant={iAmReady ? "table" : "gold"}
          size="sm"
          disabled={disabled}
          onClick={() => onToggle(!iAmReady)}
        >
          {iAmReady ? "준비 취소" : "준비 READY"}
        </Button>
      )}
    </div>
  );
}
