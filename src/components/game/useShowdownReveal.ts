import { useEffect, useState } from "react";

/**
 * SHOWDOWN 카운트다운(3 · 2 · 1 · SHOWDOWN) → 카드 공개 타이밍.
 *
 * 게임 로직이 아니라 "표시 타이밍"만 담당한다. 라운드가 바뀌면 초기화된다.
 * 카운트다운은 POT 위에 겹치지 않고 DECISION ZONE에서 렌더링한다.
 */
export function useShowdownReveal(showdown: boolean, roundId: string | null) {
  const [countdown, setCountdown] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    setRevealed(false);
    setCountdown(null);
  }, [roundId]);

  useEffect(() => {
    if (!showdown) {
      setCountdown(null);
      return;
    }
    setRevealed(false);
    const steps = ["3", "2", "1", "SHOWDOWN"];
    const timers = steps.map((step, i) => setTimeout(() => setCountdown(step), i * 360));
    timers.push(
      setTimeout(() => {
        setCountdown(null);
        setRevealed(true);
      }, steps.length * 360),
    );
    return () => timers.forEach(clearTimeout);
  }, [showdown, roundId]);

  return { countdown, revealed };
}
