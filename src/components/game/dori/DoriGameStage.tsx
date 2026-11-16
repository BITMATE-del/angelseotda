import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * DoriGameStage — 도리짓고땡 전용 고정 캔버스(1600×900) + uniform scale.
 * 기존 섯다 GameStage는 수정하지 않고, 도리 전용으로 동일한 원칙만 재현한다.
 */
export const DORI_STAGE_WIDTH = 1536;
export const DORI_STAGE_HEIGHT = 864;


export function DoriGameStage({
  children,
  className,
  bottomGap = 16,
}: {
  children: React.ReactNode;
  className?: string;
  bottomGap?: number;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = el.clientWidth || rect.width;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const availableHeight = Math.max(320, vh - rect.top - bottomGap);
    const next = Math.min(width / DORI_STAGE_WIDTH, availableHeight / DORI_STAGE_HEIGHT, 1);
    const clamped = Math.max(0.4, Number.isFinite(next) ? next : 1);
    setScale((prev) => (Math.abs(prev - clamped) < 0.002 ? prev : clamped));
  }, [bottomGap]);

  useEffect(() => {
    measure();
    // 관찰 대상은 "바깥 viewport" 뿐이다 — stage 내부(카드 수/HUD)는 scale 에 영향을 주지 않는다.
    const el = viewportRef.current;
    const ro = new ResizeObserver(() => measure());
    if (el) ro.observe(el);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [measure]);


  return (
    <div ref={viewportRef} className={cn("w-full", className)}>
      <div
        style={{ height: DORI_STAGE_HEIGHT * scale }}
        className="relative mx-auto"
      >
        <div
          style={{
            width: DORI_STAGE_WIDTH,
            height: DORI_STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            left: `calc(50% - ${(DORI_STAGE_WIDTH * scale) / 2}px)`,
          }}
          className="absolute top-0"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
