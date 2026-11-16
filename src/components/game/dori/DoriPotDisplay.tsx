import { useEffect, useRef, useState } from "react";
import { formatPoints } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";
import { DORI_UI } from "./doriAssets";

/**
 * 도리 POT 표시 — 그래픽은 실제 에셋(pot-frame)이다.
 *
 * 중요: pot-frame.png 는 금화 더미가 이미 포함된 "금화 포함형" 에셋이다.
 * 따라서 pot-coins.png 를 추가로 겹치지 않는다 (중복 금화 방지).
 * 금액 구간별 코인 존재감은 하나의 프레임 레이어에서 scale/glow 만 조정한다.
 */

/** 금액 구간별 코인/프레임 시각 밀도 (새 이미지를 겹치지 않는다) */
function densityOf(pot: number) {
  if (pot <= 0) return { scale: 0.94, glow: 0.18, opacity: 0.82 };
  if (pot <= 10_000) return { scale: 1, glow: 0.3, opacity: 1 };
  if (pot <= 100_000) return { scale: 1.04, glow: 0.5, opacity: 1 };
  return { scale: 1.08, glow: 0.72, opacity: 1 };
}

export function DoriPotDisplay({ pot, currentBet }: { pot: number; currentBet: number }) {
  const [shown, setShown] = useState(pot);
  const [rising, setRising] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const coinRef = useRef<HTMLImageElement | null>(null);
  const prev = useRef(pot);

  // 숫자 카운트 업 (즉시 교체하지 않는다) — 종료 후 서버값을 정확히 표시한다.
  useEffect(() => {
    const from = prev.current;
    prev.current = pot;
    if (from === pot) return;
    // 백그라운드 탭 복귀 시 지난 연출을 몰아서 재생하지 않는다.
    const hidden = typeof document !== "undefined" && document.hidden;
    const reduced =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (pot > from && !hidden) {
      setRising(true);
      const timer = window.setTimeout(() => setRising(false), reduced ? 240 : 900);
      if (!reduced) {
        try {
          boxRef.current?.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }],
            { duration: 460, easing: "ease-out" },
          );
          // 코인 더미 반응 — 새 이미지를 겹치지 않고 기존 레이어만 살짝 튄다.
          coinRef.current?.animate(
            [
              { transform: "translateY(0) scale(1)" },
              { transform: "translateY(-4px) scale(1.03)" },
              { transform: "translateY(0) scale(1)" },
            ],
            { duration: 420, easing: "ease-out" },
          );
        } catch {
          /* 연출 실패는 무시 — 게임은 계속 진행된다 */
        }
      }
      const start = performance.now();
      const dur = reduced ? 120 : 440;
      let raf = 0;
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setShown(p < 1 ? Math.round(from + (pot - from) * eased) : pot);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
      };
    }
    setShown(pot);
    return;
  }, [pot]);


  const density = densityOf(pot);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        ref={boxRef}
        className="relative h-[220px] w-[470px]"
        style={{ transform: `scale(${density.scale})` }}
      >
        {/* 배경 광채 — 레퍼런스의 중앙 발광 */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 50% 42%, rgba(255,214,110,${
              rising ? 0.42 : density.glow * 0.4
            }), transparent 62%)`,
          }}
        />

        {/* 단일 POT 레이어 (프레임 + 금화 일체형 에셋) */}
        <img
          ref={coinRef}
          src={DORI_UI.potFrame}

          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain transition-[filter,opacity] duration-300"
          style={{
            opacity: density.opacity,
            filter: `drop-shadow(0 0 ${rising ? 34 : 12 + density.glow * 22}px rgba(212,175,55,${
              rising ? 0.9 : 0.25 + density.glow * 0.4
            }))`,
          }}
        />

        {/* 짧은 shine sweep — 금액이 오를 때만 */}
        {rising && (
          <span
            aria-hidden
            className="animate-dori-shine pointer-events-none absolute inset-x-[14%] bottom-[12%] top-[46%] overflow-hidden rounded-2xl"
          />
        )}

        <div className="absolute bottom-[40px] left-1/2 w-[340px] -translate-x-1/2 text-center">
          <p className="text-[13px] tracking-[0.34em] text-gold-soft/85">POT</p>
          <p
            className={cn(
              "font-display text-[44px] font-extrabold leading-tight transition-colors",
              rising ? "text-[#ffe9a8] drop-shadow-[0_0_18px_var(--gold)]" : "text-gold",
            )}
            data-testid="dori-pot"
          >
            {formatPoints(shown)}
          </p>
        </div>

      </div>

      {currentBet > 0 && (
        <p className="absolute -bottom-[2px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[13px] text-foreground/80">
          현재 베팅 {formatPoints(currentBet)}
        </p>
      )}
    </div>
  );
}
