import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 게임판 기준 해상도 (design viewport).
 * 게임 화면의 모든 좌석/카드/POT/액션바는 이 고정 캔버스 안에 배치되고,
 * 브라우저 크기와 전체화면 여부에 따라 "동일 비율(uniform scale)"로만 확대/축소된다.
 *
 * → 창모드/전체화면/1920/1600/1366/1200 어디서든 상대 위치와 카드 비율이 동일하다.
 */
export const STAGE_WIDTH = 1600;
export const STAGE_HEIGHT = 1210;
export const STAGE_ASPECT = STAGE_WIDTH / STAGE_HEIGHT;

const MIN_SCALE = 0.38;
/**
 * 세로가 부족하다고 무한히 축소하지 않는다 (카드가 작아지는 것을 막는다).
 * 이 값보다 더 줄여야 화면에 들어가는 경우에는 축소 대신 세로 스크롤을 허용한다.
 */
const MIN_FIT_SCALE = 0.86;
const MAX_SCALE = 1.8;

/**
 * GameViewport + GameStage.
 *
 * - GameViewport : 브라우저에서 실제로 사용 가능한 영역 (측정 대상)
 * - GameStage    : 1600x900 고정 캔버스. 내부 레이아웃은 절대 해상도별로 바뀌지 않는다.
 *
 * scale = min(viewportWidth / 1600, viewportHeight / 900) — X/Y 독립 스케일이나
 * width/height 100% stretching 을 사용하지 않으므로 카드/캐릭터 비율이 찌그러지지 않는다.
 */
export function GameStage({
  children,
  className,
  /** 화면 하단에 남겨둘 여백 (px, 브라우저 기준) */
  bottomGap = 16,
  /**
   * true → 세로도 항상 화면에 맞춘다 (MIN_FIT_SCALE 하한 없음 → 페이지 세로 스크롤 0).
   * 기본값 false 이므로 3장 섯다 등 기존 화면 스케일 동작은 그대로 유지된다.
   */
  fitHeight = false,
  onScaleChange,
}: {
  children: React.ReactNode;
  className?: string;
  bottomGap?: number;
  fitHeight?: boolean;
  onScaleChange?: (scale: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = el.clientWidth || rect.width;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    // 전체화면에서는 요소가 화면 상단부터 시작하므로 top 보정만으로 정확히 계산된다.
    const availableHeight = Math.max(320, vh - rect.top - bottomGap);
    const widthScale = width / STAGE_WIDTH;
    const heightScale = availableHeight / STAGE_HEIGHT;
    // 가로는 절대 넘치지 않게, 세로는 MIN_FIT_SCALE 밑으로는 줄이지 않고 스크롤로 처리한다.
    const next = fitHeight
      ? Math.min(widthScale, heightScale, 1)
      : Math.min(widthScale, Math.max(heightScale, MIN_FIT_SCALE), 1);
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number.isFinite(next) ? next : 1));
    setScale((prev) => (Math.abs(prev - clamped) < 0.002 ? prev : clamped));
  }, [bottomGap, fitHeight]);

  useEffect(() => {
    measure();
    const el = viewportRef.current;
    const ro = new ResizeObserver(() => measure());
    if (el) ro.observe(el);
    // 브라우저 zoom(90/100/110%)은 visualViewport/resize 로 재측정된다.
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    document.addEventListener("fullscreenchange", measure);
    const raf = window.requestAnimationFrame(measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
      document.removeEventListener("fullscreenchange", measure);
      window.cancelAnimationFrame(raf);
    };
  }, [measure]);

  useEffect(() => {
    onScaleChange?.(scale);
  }, [scale, onScaleChange]);

  return (
    <div
      ref={viewportRef}
      data-game-viewport
      className={cn("relative w-full overflow-x-hidden", className)}
      style={{ height: Math.round(STAGE_HEIGHT * scale) }}
    >
      <div
        data-game-stage
        data-stage-scale={scale.toFixed(3)}
        className="absolute top-0"
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          left: "50%",
          marginLeft: -STAGE_WIDTH / 2,
          transform: `scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 전체화면 전환 — Stage 는 재배치되지 않고 같은 레이아웃이 확대된다 */
export function useFullscreen<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen?.().catch(() => undefined);
  }, [ref]);

  return { active, toggle };
}
