import cashBundleAsset from "@/assets/cash-bundle.png";
import { cn } from "@/lib/utils";

/** ANGEL SUTDA 전용 현금다발 asset (CSS 사각형 가짜 지폐를 사용하지 않는다) */
export const CASH_BUNDLE_ASSET = cashBundleAsset;

/** ANGEL CHIP — 골드 토큰 한 개 */
export function AngelChip({
  size = 18,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn("relative inline-block shrink-0 rounded-full ring-1 ring-gold/70", className)}
      style={{
        width: size,
        height: size,
        background:
          "radial-gradient(circle at 32% 28%, var(--gold-soft), var(--gold) 46%, var(--gold-deep) 100%)",
        boxShadow: "0 3px 6px -2px oklch(0 0 0/0.85), inset 0 0 0 2px oklch(0 0 0/0.25)",
        ...style,
      }}
    >
      <span
        className="absolute inset-[26%] rounded-full"
        style={{ background: "var(--charcoal)", opacity: 0.75 }}
      />
    </span>
  );
}

/** 현금다발 한 묶음 — 실제 이미지 asset 렌더 */
export function CashBundle({
  width,
  className,
  style,
}: {
  width: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={cashBundleAsset}
      alt=""
      aria-hidden
      loading="lazy"
      width={width}
      height={Math.round(width * 0.66)}
      className={cn("pointer-events-none block select-none", className)}
      style={{
        width,
        height: "auto",
        filter: "drop-shadow(0 3px 5px oklch(0 0 0/0.75))",
        ...style,
      }}
    />
  );
}

/** POT 금액 → 현금다발 LEVEL 1~5 (기본 베팅 배수 기준) */
export function potTier(pot: number, baseBet: number): 1 | 2 | 3 | 4 | 5 {
  const ratio = pot / Math.max(1, baseBet);
  if (ratio >= 60) return 5;
  if (ratio >= 30) return 4;
  if (ratio >= 14) return 3;
  if (ratio >= 6) return 2;
  return 1;
}

/** 베팅 금액 → 날아갈 현금다발 개수 (1~6, 시각적 단계화) */
export function bundlesForBet(amount: number, baseBet: number): number {
  if (amount <= 0) return 0;
  const ratio = amount / Math.max(1, baseBet);
  if (ratio >= 16) return 6;
  if (ratio >= 8) return 5;
  if (ratio >= 4) return 4;
  if (ratio >= 2) return 3;
  if (ratio >= 1) return 2;
  return 1;
}

/**
 * CashStack — POT SAFE ZONE 내부에서만 쌓이는 실제 현금다발 스택.
 * 컨테이너 높이가 고정되어 있어 LEVEL 5에서도 좌석/카드/POT 금액을 가리지 않는다.
 */
export function CashStack({
  amount,
  baseBet = 1000,
  className,
}: {
  amount: number;
  baseBet?: number;
  className?: string;
}) {
  if (amount <= 0) return null;
  const level = potTier(amount, baseBet);
  const columns = [2, 3, 4, 5, 5][level - 1]!;
  const rows = [1, 2, 3, 5, 7][level - 1]!;
  const width = [40, 40, 38, 36, 34][level - 1]!;
  const step = Math.max(9, width * 0.3);

  return (
    <div
      data-testid="cash-stack"
      data-cash-level={level}
      className={cn(
        "flex h-[96px] max-w-full items-end justify-center gap-[2px] overflow-hidden",
        level >= 5 && "drop-shadow-[0_0_16px_var(--gold)]",
        className,
      )}
    >
      {Array.from({ length: columns }).map((_, col) => {
        const count = Math.max(
          1,
          Math.round(rows - Math.abs(col - (columns - 1) / 2) * (level >= 4 ? 1 : 0.5)),
        );
        return (
          <span
            key={col}
            className="relative block"
            style={{ width, height: (count - 1) * step + width * 0.66 }}
          >
            {Array.from({ length: count }).map((__, i) => (
              <CashBundle
                key={i}
                width={width}
                className="absolute left-0 animate-deal"
                style={{
                  bottom: i * step,
                  animationDelay: `${i * 40}ms`,
                  transform: `rotate(${((col + i) % 3) - 1}deg)`,
                }}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}
