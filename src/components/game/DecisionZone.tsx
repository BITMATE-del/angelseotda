import { cn } from "@/lib/utils";

/**
 * DecisionZone — C. PHASE / DECISION ZONE.
 *
 * READY · 쪼기(PEEL) · 공개패 선택 · 최종 승부패 선택 · SHOWDOWN 안내 · 결과 안내 전용 블록.
 * TABLE ZONE 과 ACTION BAR 사이의 독립 grid row 이므로 어떤 phase 에서도 서로 겹치지 않는다.
 * 내용이 넘치면 이 블록 내부에서만 스크롤된다 (액션바 침범 금지).
 */
export function DecisionZone({
  title = null,
  children,
  height,
  className,
}: {
  title?: string | null;
  children: React.ReactNode;
  height: number;
  className?: string;
}) {
  return (
    <section
      data-decision-zone
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-gold/25 bg-charcoal/80 px-3 py-2",
        className,
      )}
      style={{ height }}
    >
      {title && (
        <p className="shrink-0 pb-1 text-center font-display text-[12px] tracking-[0.14em] text-gold">
          {title}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
