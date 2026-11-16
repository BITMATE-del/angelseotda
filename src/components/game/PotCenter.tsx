import { useEffect, useRef } from "react";
import type { SidePot } from "@/lib/services/serverGameService";
import { formatPoints } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";
import { potTier } from "./CashStack";
import { SUTDA_UI } from "@/lib/game/sutdaAssets";

/**
 * POT SAFE ZONE.
 * 이 컴포넌트 내부에는 POT 금액 / 현금다발 / 칩 / MAIN·SIDE POT만 존재한다.
 * 플레이어 · 캐릭터 · 카드 · 닉네임 · TURN badge는 절대 배치하지 않는다.
 */
export function PotCenter({
  pot,
  baseBet,
  pots = [],
  isRematchRound = false,
  carryIn = 0,
  cardIntegrityOk = true,
  callAmount = null,
  myContribution = null,
  currentBet = null,
  potSumOk = true,
  potAnchorRef,
  className,
}: {
  pot: number;
  baseBet: number;
  pots?: SidePot[];
  isRematchRound?: boolean;
  carryIn?: number;
  cardIntegrityOk?: boolean;
  /** 서버 availableActions 기준 내가 맞춰야 하는 최소 금액 (없으면 미표시) */
  callAmount?: number | null;
  /** 이번 판 내 총 투자액 (서버 total_bet) */
  myContribution?: number | null;
  /** 서버 state.currentBet (표시 전용) */
  currentBet?: number | null;
  /** MAIN+SIDE 합계 == POT 검증 결과 (서버 계산) */
  potSumOk?: boolean;
  potAnchorRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const prev = useRef(pot);
  const level = potTier(pot, baseBet);

  // POT 증가 시 금액 박스만 pulse (별도 absolute 연출 레이어를 만들지 않는다)
  useEffect(() => {
    if (pot > prev.current) {
      boxRef.current?.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
        { duration: 320, easing: "ease-out" },
      );
    }
    prev.current = pot;
  }, [pot]);

  return (
    <div
      className={cn(
        "pointer-events-none flex w-[420px] max-w-full flex-col items-center justify-start",
        className,
      )}
    >
      {/* 현금다발 이동 연출 도착점 — POT 액자 이미지가 금화를 포함하므로 별도 코인 레이어를 겹치지 않는다 */}
      <div ref={potAnchorRef ?? null} className="h-0 w-0" />

      {/* ── 중앙: 코인 + POT 프레임 + POT 금액 (이 블록 안에는 보조정보 금지) ── */}
      <div
        ref={boxRef}
        className={cn(
          "relative h-[210px] w-[420px] max-w-full shrink-0 text-center",
          level >= 3 && "drop-shadow-[0_0_20px_var(--gold)]",
          level >= 5 && "drop-shadow-[0_0_36px_var(--gold)]",
        )}
      >
        {/* POT 액자 — 실제 이미지 에셋 */}
        <img
          src={SUTDA_UI.potFrame}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
          draggable={false}
        />
        {/* 액자 명판 영역에 금액만 얹는다 (액자에 이미 POT 라벨/금화가 포함) */}
        <div className="absolute inset-x-0 bottom-[14%] z-20 px-[16%]">
          <p className="whitespace-nowrap font-display text-[26px] leading-[1.15] text-gold drop-shadow-[0_0_14px_var(--gold)]">
            {formatPoints(pot)}
          </p>
        </div>
      </div>

      {/* ── 하단: 보조정보 전용 info band (액자와 겹치지 않는 normal flow · 2~3줄) ── */}
      <div
        data-pot-info-band
        className="relative z-20 mt-3 flex w-full max-w-full flex-col items-center gap-1"
      >
        {/* 1줄 — 내 투자 / CALL / 현재 베팅 / 기본 베팅 */}
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-gold/25 bg-black/85 px-3 py-1 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="tracking-[0.16em] text-gold-soft/80">내 투자</span>
            <span className="font-display text-xs text-foreground" data-testid="pot-my-total">
              {myContribution == null ? "-" : formatPoints(myContribution)}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="tracking-[0.16em] text-gold-soft/80">CALL</span>
            <span
              className={cn("font-display text-xs", callAmount ? "text-gold" : "text-jade")}
              data-testid="pot-call"
            >
              {callAmount == null
                ? "-"
                : callAmount > 0
                  ? formatPoints(callAmount)
                  : "0 P · 체크 가능"}
            </span>
          </span>
          {currentBet != null && (
            <span className="flex items-center gap-1">
              <span className="tracking-[0.16em] text-gold-soft/80">현재 베팅</span>
              <span className="font-display text-xs text-foreground/80" data-testid="pot-current-bet">
                {formatPoints(currentBet)}
              </span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="tracking-[0.16em] text-gold-soft/80">기본 베팅</span>
            <span className="font-display text-xs text-foreground/70" data-testid="pot-base-bet">
              {formatPoints(baseBet)}
            </span>
          </span>
        </div>

        {/* 2줄 — MAIN / SIDE */}
        {pots.length > 1 && (
          <div className="flex max-w-full flex-wrap items-center justify-center gap-1">
            {pots.map((p, i) => (
              <span
                key={`${p.level}-${i}`}
                className="rounded-full border border-gold/20 bg-black/85 px-2 py-0.5 text-[10px] text-gold-soft"
              >
                {i === 0 ? "MAIN" : `SIDE ${i}`} {formatPoints(p.amount)} · {p.eligible.length}명
              </span>
            ))}
          </div>
        )}

        {/* 3줄 — 재경기 · 이월 / 무결성 / 합계 경고 */}
        {(isRematchRound || !potSumOk || !cardIntegrityOk) && (
          <div className="flex max-w-full flex-wrap items-center justify-center gap-1">
            {isRematchRound && (
              <span className="whitespace-nowrap rounded-full border border-crimson/50 bg-black/85 px-2.5 py-0.5 font-display text-[10px] tracking-widest text-gold">
                재경기 · 2장 승부{carryIn > 0 ? ` · 이월 ${formatPoints(carryIn)}` : ""}
              </span>
            )}
            {/* SUM(all pots) ≠ POT 이면 UI 문제가 아니라 서버 POT 계산 오류다 */}
            {!potSumOk && (
              <span
                className="rounded-full border border-destructive/50 bg-black/85 px-2 py-0.5 text-[10px] text-destructive"
                data-testid="pot-sum-mismatch"
              >
                POT 합계 불일치 · 서버 확인 중
              </span>
            )}
            {!cardIntegrityOk && (
              <span className="animate-pulse rounded-full border border-gold/25 bg-black/85 px-3 py-0.5 text-[10px] text-gold">
                카드 배분 중…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

