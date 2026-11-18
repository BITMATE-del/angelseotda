/**
 * 서버 기준 카운트다운 (표시 전용).
 *
 * - 남은 시간은 항상 `서버 deadline - 현재시각(서버 시계 보정)` 으로 계산한다.
 *   컴포넌트가 mount 될 때 30초부터 임의로 감소하는 방식은 사용하지 않는다.
 * - 따라서 새로고침 / 재접속 / resize / 전체화면 / 모바일 회전 /
 *   백그라운드 → 포그라운드 복귀 후에도 같은 deadline 이면 같은 남은 시간을 보여준다.
 * - 0초가 되어도 클라이언트는 다이/공개를 만들지 않는다. 실제 행동은 서버 timeout handler 가 한다.
 *   0초 이후 짧은 구간은 "처리 중..." 으로만 표시한다.
 */
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** 서버 시계 오차 보정값 (serverNow - clientNow) */
function clockOffset(serverNow?: string | null): number {
  if (!serverNow) return 0;
  const t = Date.parse(serverNow);
  if (!Number.isFinite(t)) return 0;
  const diff = t - Date.now();
  // 비정상적으로 큰 차이는 무시한다 (시계 조작/파싱 오류 방어)
  return Math.abs(diff) > 5 * 60_000 ? 0 : diff;
}

/** 남은 초 (서버 deadline 기준) · deadline 없으면 null */
export function useServerCountdown(
  deadline?: string | null,
  serverNow?: string | null,
): number | null {
  const end = deadline ? Date.parse(deadline) : NaN;
  const offset = clockOffset(serverNow);
  const compute = () =>
    Number.isFinite(end) ? Math.ceil((end - (Date.now() + offset)) / 1000) : null;
  const [left, setLeft] = useState<number | null>(compute);

  useEffect(() => {
    if (!Number.isFinite(end)) {
      setLeft(null);
      return undefined;
    }
    const tick = () => setLeft(Math.ceil((end - (Date.now() + offset)) / 1000));
    tick();
    const timer = window.setInterval(tick, 250);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("resize", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("resize", onVisible);
    };
  }, [end, offset]);

  return left;
}

/**
 * 타이머 배지 — [내 턴 · 자동 다이까지 12초] / [자동 공개까지 12초] 형태.
 * 자체적으로만 1초 단위 갱신되므로 게임판 전체가 매초 리렌더되지 않는다.
 */
export function ServerCountdownBadge({
  deadline,
  serverNow,
  prefix,
  suffixLabel,
  className,
}: {
  deadline?: string | null;
  serverNow?: string | null;
  /** 앞에 붙는 문구 (예: "내 턴") */
  prefix?: string | null;
  /** 카운트다운 라벨 (예: "자동 다이까지", "자동 공개까지") */
  suffixLabel: string;
  className?: string;
}) {
  const left = useServerCountdown(deadline, serverNow);
  if (left === null) return null;

  const pending = left <= 0;
  const urgent = !pending && left <= 5;

  return (
    <span
      data-server-countdown={pending ? "pending" : String(left)}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-display text-[12px] tracking-wide",
        pending
          ? "border-white/20 bg-black/60 text-foreground/70"
          : urgent
            ? "animate-pulse border-danger/70 bg-danger/20 text-danger"
            : "border-gold/40 bg-black/60 text-gold-soft",
        className,
      )}
    >
      {pending
        ? "처리 중..."
        : `${prefix ? `${prefix} · ` : ""}${suffixLabel} ${Math.min(left, 999)}초`}
    </span>
  );
}

/**
 * 타이머 패널 — 라벨(작게) + 남은 초(크게) 2줄.
 * 상태 안내 pill 과 같은 행을 쓰지 않고 별도 row 로 배치한다.
 * 마지막 5초 강조는 색/그림자만 바꾸고 크기는 고정이라 레이아웃이 흔들리지 않는다.
 */
export function ServerCountdownPanel({
  deadline,
  serverNow,
  prefix,
  suffixLabel,
  className,
}: {
  deadline?: string | null;
  serverNow?: string | null;
  /** 앞에 붙는 문구 (예: "내 턴") */
  prefix?: string | null;
  /** 카운트다운 라벨 (예: "자동 다이까지", "자동 공개까지") */
  suffixLabel: string;
  className?: string;
}) {
  const left = useServerCountdown(deadline, serverNow);
  if (left === null) return null;

  const pending = left <= 0;
  const urgent = !pending && left <= 5;
  const seconds = String(Math.min(left, 999)).padStart(2, "0");

  return (
    <div
      data-server-countdown={pending ? "pending" : String(left)}
      data-server-countdown-panel=""
      className={cn(
        "pointer-events-none flex h-[52px] min-w-[180px] shrink-0 flex-col items-center justify-center rounded-xl border px-4 leading-none",
        pending
          ? "border-white/20 bg-black/70 text-foreground/70"
          : urgent
            ? "border-danger/70 bg-black/75 shadow-[0_0_16px_-4px_var(--danger)]"
            : "border-gold/50 bg-black/70",
        className,
      )}
    >
      {pending ? (
        <span className="font-display text-[15px] tracking-wide">처리 중...</span>
      ) : (
        <>
          <span className="whitespace-nowrap font-display text-[13px] tracking-wide text-gold-soft/85">
            {prefix ? `${prefix} · ` : ""}
            {suffixLabel}
          </span>
          <span
            className={cn(
              "mt-[3px] whitespace-nowrap font-display text-[26px] font-extrabold tabular-nums",
              urgent ? "text-danger" : "text-gold",
            )}
          >
            {seconds}초
          </span>
        </>
      )}
    </div>
  );
}
