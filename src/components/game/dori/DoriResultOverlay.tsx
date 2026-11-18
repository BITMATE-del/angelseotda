/**
 * PHASE 4 / RULE PATCH 2 — 라운드 종료 결과 오버레이 (프레젠테이션 전용).
 *
 * 서버가 확정한 dori_round_result 값만 표시한다. 승자·족보·지급액·손익을
 * 클라이언트에서 재계산하지 않으며, 게임 진행(다음 판 시작)에도 개입하지 않는다.
 * 패/짓기 공개 여부도 서버 판정(revealed)만 따른다.
 */
import { formatPoints } from "@/lib/services/walletService";
import { formatDoriNet, type DoriResultView } from "@/lib/game/dori/doriResultView";
import { doriMonthOf } from "@/lib/game/dori/doriRules";
import { DoriAssetButton } from "./DoriAssetButton";
import { cn } from "@/lib/utils";

export const DORI_RESULT_FRAME = "/assets/game/result-panel-frame.png";

export function DoriResultOverlay({
  view,
  nextNotice,
  onReveal,
  revealBusy,
}: {
  view: DoriResultView;
  /** 다음 진행 안내 문구 (서버 상태 기반, 시각 안내용) */
  nextNotice: string;
  /** 폴드승 승자의 패 공개 선택 (서버가 허용한 경우에만 표시된다) */
  onReveal?: (reveal: boolean) => void;
  revealBusy?: boolean;
}) {
  const win = view.headline === "승 리";
  const rematch = view.rematch;

  return (
    // 게임 진행을 막지 않는 presentation layer — 클릭은 그대로 게임판에 전달된다.
    <div className="pointer-events-none absolute inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <div className="pointer-events-none relative h-[330px] w-[min(672px,94vw)] max-h-[92vh] animate-scale-in sm:h-[420px]">


        <img
          src={DORI_RESULT_FRAME}
          alt=""
          aria-hidden
          draggable={false}
          width={1024}
          height={640}
          className="pointer-events-none absolute inset-0 h-full w-full select-none"
        />

        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 flex flex-col items-center justify-center px-[28px] py-[30px] text-center sm:px-[68px] sm:py-[54px]"
        >
          <p
            className={cn(
              "font-display text-[27px] leading-none tracking-[0.2em] sm:text-[42px] sm:tracking-[0.35em]",
              rematch ? "text-jade" : win ? "text-gold" : "text-foreground/70",
            )}
          >
            {view.headline}
          </p>

          {rematch ? (
            <div className="mt-3 grid gap-1.5 sm:mt-4">
              <p className="font-display text-base text-gold-soft sm:text-lg">
                {view.rematchReason ?? "동점 · 재경기"}
              </p>
              <p className="font-display text-[22px] text-gold sm:text-[30px]">
                POT {formatPoints(view.carryPot)}
              </p>
              <p className="text-[12px] text-foreground/75 sm:text-sm">다음 판으로 이월됩니다.</p>
            </div>
          ) : (
            <div className="mt-4 grid w-full gap-2">
              <ul className="grid gap-1">
                {view.payouts.map((p, i) => (
                  <li
                    key={`${p.nickname}-${i}`}
                    className="flex min-w-0 items-center justify-center gap-1.5 text-[13px] sm:gap-2 sm:text-[15px]"
                  >
                    {view.payouts.length > 1 && (
                      <span className="shrink-0 font-display text-[11px] tracking-widest text-gold-soft/80">
                        {p.label}
                      </span>
                    )}
                    <span className="max-w-[120px] truncate font-display text-gold sm:max-w-[220px]">
                      {p.nickname}
                    </span>
                    <span className="font-display tabular-nums text-gold">
                      +{formatPoints(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>

              {view.winnerHand ? (
                <p className="truncate font-display text-base text-gold-soft sm:text-xl">
                  {view.winnerHand}
                </p>
              ) : view.foldWin ? (
                <p className="text-sm text-foreground/70">상대 전원 다이</p>
              ) : null}

              {view.myNet !== null && (
                <p
                  className={cn(
                    "font-display text-[25px] leading-none tabular-nums sm:text-[34px]",
                    view.myNet > 0 ? "text-gold" : view.myNet < 0 ? "text-destructive" : "text-foreground/70",
                  )}
                >
                  {formatDoriNet(view.myNet)}
                </p>
              )}
              <p className="text-[12px] text-foreground/60">
                이번 판 {win ? "획득" : "손익"}
                {view.myFinalPoints !== null && ` · 보유 ${formatPoints(view.myFinalPoints)}`}
              </p>
            </div>
          )}

          <ul className="mt-3 grid w-full max-w-full gap-1 text-[12px] text-foreground/70">
            {view.rows.map((r) => (
              <li key={r.userId} className="flex flex-wrap items-center justify-center gap-x-2">
                <span className={cn("max-w-[110px] truncate", r.isMe && "text-gold-soft")}>
                  {r.nickname}
                </span>
                <span className={cn(r.status === "승" ? "text-gold" : "text-foreground/50")}>
                  {r.status}
                </span>
                {r.revealed ? (
                  r.isHwang ? (
                    <span className="text-destructive">황 (짓기 실패)</span>
                  ) : (
                    <>
                      {r.selectedCards.length === 3 && (
                        <span className="text-foreground/55">
                          짓기 {r.selectedCards.map((c) => doriMonthOf(c)).join("+")}
                          {r.makeTotal !== null && `=${r.makeTotal}`}
                        </span>
                      )}
                      {r.remainingCards.length === 2 && (
                        <span className="text-foreground/55">
                          승부 {r.remainingCards.map((c) => doriMonthOf(c)).join("+")}
                        </span>
                      )}
                      {r.handLabel && <span className="text-gold-soft">{r.handLabel}</span>}
                    </>
                  )
                ) : (
                  <span className="text-foreground/35">패 비공개</span>
                )}
                <span className="tabular-nums text-foreground/55">{formatDoriNet(r.net)}</span>
              </li>
            ))}
          </ul>

          {/* 올다이(폴드승) 승자만 패 공개 여부를 선택한다 — 미선택 시 비공개 유지 */}
          {view.canChooseReveal && onReveal && (
            <div className="pointer-events-auto mt-3 flex items-center justify-center gap-2">
              <DoriAssetButton disabled={revealBusy} onClick={() => onReveal(true)}>
                패 공개
              </DoriAssetButton>
              <DoriAssetButton tone="red" disabled={revealBusy} onClick={() => onReveal(false)}>
                패 비공개
              </DoriAssetButton>
            </div>
          )}

          {view.zeroBalance ? (
            <p className="mt-3 text-[12px] text-destructive">
              보유 포인트가 없어 게임방에서 퇴장됩니다.
            </p>
          ) : view.leftRoom ? (
            <p className="mt-3 text-[12px] text-gold-soft/80">
              이번 판 종료 후 게임방에서 퇴장합니다.
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-gold-soft/80">{nextNotice}</p>
          )}
        </div>
      </div>
    </div>
  );
}
