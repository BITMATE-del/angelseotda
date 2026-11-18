import { useCallback, useRef, useState } from "react";
import { cardFaceUrl, getCard, skinBack, type FaceSkinId } from "@/lib/game/cardDeck";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "w-11 h-[66px]",
  /** 상대 좌석용 — sm 대비 약 +14% */
  smx: "w-[50px] h-[75px]",
  md: "w-16 h-24",
  /** 도리 내 좌석용 — MASTER_REFERENCE 기준 큰 카드 */
  dori: "w-[80px] h-[112px]",
  /** 2장 섯다 본인 좌석 — card zone safe size */
  sutda2self: "w-[86px] h-[129px]",
  /** 2장 섯다 상대 좌석 — card zone safe size */
  sutda2opp: "w-[50px] h-[75px]",
  lg: "w-24 h-36",
  xl: "w-32 h-48",
} as const;


export type CardSize = keyof typeof SIZES;

/**
 * 카드 UI 상태 — 서버의 카드 진실값(game_cards)과 완전히 분리된 "시각 상태"다.
 * 이 상태는 절대 서버 카드값을 변경하지 않는다.
 *
 * FACE_UP       : 이미 공개된 카드. 클릭/드래그 불가, 테이블에 고정.
 * FACE_DOWN     : 상대/관전자용 뒷면. 어떤 인터랙션도 연결하지 않는다.
 * SQUEEZE_READY : 쪼기 대상. 드래그(PEEL) 또는 문지르기(SCRATCH)만 허용.
 * REVEALED      : 쪼기 완료. 이후 FACE_UP과 동일하게 고정된다.
 */
export type CardVisual = "FACE_UP" | "FACE_DOWN" | "SQUEEZE_READY" | "REVEALED";

export type SqueezeMode = "PEEL" | "SCRATCH";

interface Props {
  cardId?: string;
  /** 시각 상태 (미지정 시 cardId 유무로 FACE_UP / FACE_DOWN) */
  visual?: CardVisual;
  size?: CardSize;
  backSkin?: string;
  faceSkin?: FaceSkinId | string;
  delayMs?: number;
  dimmed?: boolean;
  /** 쪼기 방식 — 기본 PEEL */
  squeezeMode?: SqueezeMode;
  /** 완전 공개 시 1회 호출 */
  onRevealed?: (cardId?: string) => void;
  className?: string;
}

export function HwatuCard({
  cardId,
  visual,
  size = "md",
  backSkin = "classic-red",
  faceSkin = "base",
  delayMs = 0,
  dimmed = false,
  squeezeMode = "PEEL",
  onRevealed,
  className,
}: Props) {
  const state: CardVisual = visual ?? (cardId ? "FACE_UP" : "FACE_DOWN");
  const [opened, setOpened] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scratches, setScratches] = useState<{ x: number; y: number }[]>([]);
  const [missing, setMissing] = useState(false);
  const startY = useRef<number | null>(null);

  const card = cardId ? getCard(cardId) : null;
  const faceSrc = card ? cardFaceUrl(card.id, faceSkin) : skinBack(backSkin);
  const backSrc = skinBack(backSkin);

  const squeezing = state === "SQUEEZE_READY" && !opened;
  const showFace = state === "FACE_UP" || state === "REVEALED" || opened;
  const coverVisible = !showFace;

  const reveal = useCallback(() => {
    setOpened(true);
    setProgress(1);
    startY.current = null;
    onRevealed?.(cardId);
  }, [cardId, onRevealed]);

  function drag(clientY: number) {
    if (startY.current === null) return;
    const delta = Math.max(0, startY.current - clientY);
    const next = Math.min(1, delta / 80);
    setProgress(next);
    if (next >= 0.85) reveal();
  }

  function scratch(e: React.PointerEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setScratches((prev) => {
      const next = [...prev, { x, y }].slice(-40);
      if (next.length >= 14) reveal();
      return next;
    });
  }

  // 쪼기 대상 카드에만 pointer handler를 연결한다 (공개 카드는 완전히 고정)
  const squeezeHandlers = squeezing
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (squeezeMode === "PEEL") startY.current = e.clientY;
          else scratch(e);
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (squeezeMode === "PEEL") drag(e.clientY);
          else if (e.buttons > 0) scratch(e);
        },
        onPointerUp: () => {
          startY.current = null;
          if (squeezeMode === "PEEL") setProgress(0);
        },
        onPointerCancel: () => {
          startY.current = null;
          if (squeezeMode === "PEEL") setProgress(0);
        },
        onDoubleClick: () => reveal(),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") reveal();
        },
        role: "button" as const,
        tabIndex: 0,
        "aria-label": "카드 쪼아보기",
      }
    : {};

  const scratchMask =
    squeezeMode === "SCRATCH" && scratches.length > 0
      ? scratches
          .map(
            (s) =>
              `radial-gradient(circle 16px at ${s.x}% ${s.y}%, transparent 0 92%, black 100%)`,
          )
          .join(", ")
      : undefined;

  return (
    <div
      className={cn(
        "animate-deal relative shrink-0 overflow-hidden rounded-lg bg-charcoal shadow-[0_10px_24px_-12px_oklch(0_0_0/0.9)] ring-1 ring-gold/25",
        SIZES[size],
        dimmed && "opacity-45 saturate-50",
        squeezing && "cursor-grab touch-none select-none ring-2 ring-gold/70",
        className,
      )}
      style={{ animationDelay: `${delayMs}ms` }}
      {...squeezeHandlers}
    >
      {/* 앞면 — 실제 화투패 이미지 파일만 렌더링한다 */}
      {(card || showFace) && (
        <img
          /* src 가 바뀌면 새 <img> 로 교체한다 — 이전 카드 이미지 프레임이 남지 않도록 */
          key={faceSrc}
          src={faceSrc}
          alt={card ? card.name : "카드"}
          className={cn("absolute inset-0 h-full w-full object-cover", missing && "invisible")}
          draggable={false}
          onError={() => setMissing(true)}
          onLoad={() => setMissing(false)}
        />
      )}

      {/* 에셋 누락 시 대체 이미지를 만들지 않고 오류를 노출한다 */}
      {missing && showFace && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/80 p-1 text-center">
          <span className="text-[8px] font-bold leading-tight text-crimson">
            CARD ASSET MISSING
          </span>
          <span className="break-all text-[7px] leading-tight text-muted-foreground">{faceSrc}</span>
        </div>
      )}

      {/* 광 배지 — isGwang 카드에만 노출 */}
      {showFace && !missing && card?.isGwang && (
        <span className="absolute bottom-1 right-1 rounded-full border border-gold/70 bg-crimson px-1.5 py-[1px] text-[9px] font-bold leading-tight text-gold-soft shadow-[0_2px_6px_-2px_oklch(0_0_0/0.9)]">
          광
        </span>
      )}

      {/* 뒷면 커버 레이어 — 카드 자체가 아니라 "덮고 있는 레이어"가 벗겨진다 */}
      {coverVisible && (
        <div
          className="absolute inset-0 origin-bottom will-change-transform"
          style={{
            transform:
              squeezeMode === "PEEL" && progress > 0
                ? `translateY(-${progress * 96}%) rotateX(${progress * 16}deg)`
                : undefined,
            transition: startY.current === null ? "transform 160ms ease-out" : "none",
            boxShadow: progress > 0 ? "0 10px 18px -6px oklch(0 0 0/0.85)" : undefined,
            ...(scratchMask
              ? {
                  maskImage: scratchMask,
                  WebkitMaskImage: scratchMask,
                  maskComposite: "intersect",
                  WebkitMaskComposite: "source-in",
                }
              : {}),
          }}
        >
          <img
            src={backSrc}
            alt="뒷면"
            className="h-full w-full object-cover"
            draggable={false}
          />
          {squeezing && (
            <span className="absolute inset-x-0 bottom-0 bg-black/55 py-[2px] text-center text-[8px] tracking-widest text-gold-soft">
              쪼기
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function CardRow({
  cards,
  size = "md",
  backSkin,
  faceSkin,
  dimmed,
  visuals,
  faceDown,
  squeezeMode,
  onRevealed,
  highlight,
}: {
  cards: readonly string[];
  size?: CardSize;
  backSkin?: string;
  faceSkin?: FaceSkinId | string;
  dimmed?: boolean;
  /** 카드별 시각 상태 (index 기준). 미지정 카드는 FACE_UP */
  visuals?: readonly CardVisual[];
  /** 전체 뒷면 고정 */
  faceDown?: boolean;
  squeezeMode?: SqueezeMode;
  onRevealed?: (cardId?: string) => void;
  /** 강조할 카드 id 목록 (승부패). 나머지는 어둡게 표시 */
  highlight?: readonly string[];
}) {
  return (
    <div className="flex gap-1.5">
      {cards.map((id, i) => (
        <HwatuCard
          key={`${id}-${i}`}
          cardId={id}
          visual={faceDown ? "FACE_DOWN" : (visuals?.[i] ?? "FACE_UP")}
          size={size}
          {...(backSkin ? { backSkin } : {})}
          {...(faceSkin ? { faceSkin } : {})}
          {...(squeezeMode ? { squeezeMode } : {})}
          {...(onRevealed ? { onRevealed } : {})}
          {...(dimmed || (highlight && !highlight.includes(id)) ? { dimmed: true } : {})}
          {...(highlight?.includes(id)
            ? { className: "ring-2 ring-gold shadow-[0_0_16px_-4px_var(--gold)]" }
            : {})}
          delayMs={i * 110}
        />
      ))}
    </div>
  );
}

/** 상대/관전자용 뒷면 전용 렌더러 — 카드 코드를 클라이언트로 내려주지 않는다. */
export function HiddenCardRow({
  count,
  size = "sm",
  backSkin,
  dimmed,
}: {
  count: number;
  size?: CardSize;
  backSkin?: string;
  dimmed?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: Math.max(0, count) }).map((_, i) => (
        <HwatuCard
          key={i}
          visual="FACE_DOWN"
          size={size}
          {...(backSkin ? { backSkin } : {})}
          {...(dimmed ? { dimmed: true } : {})}
          delayMs={i * 110}
        />
      ))}
    </div>
  );
}
