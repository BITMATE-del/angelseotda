/**
 * SUTDA 2 CARD PHASE 4 — 라운드 결과 오버레이 (프레젠테이션 전용).
 *
 * 서버 확정값(sutda_round_result)만 표시한다. 승자·족보·지급액·손익·잔액을
 * 클라이언트에서 재계산하지 않고, 게임 진행(다음 판 시작)에도 개입하지 않는다.
 * 배경/본문은 pointer-events:none 이고, 폴드승 공개 선택 버튼만 클릭을 받는다.
 */
import { Button } from "@/components/ui/button";
import { HwatuCard } from "@/components/game/HwatuCard";
import { formatSutda2Net, type Sutda2ResultView } from "@/lib/game/sutda2Result";
import { formatPoints } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";
import { rematchReasonLabel } from "@/lib/game/gusaRematch";

const RESULT_FRAME = "/assets/game/result-panel-frame.png";

export function Sutda2ResultOverlay({
  view,
  nextNotice,
  onReveal,
  revealBusy,
}: {
  view: Sutda2ResultView;
  /** 다음 진행 안내 (서버 상태 기반 · 안내 문구 전용) */
  nextNotice?: string | undefined;
  /** 폴드승 승자의 패 공개 선택 (서버가 허용한 경우에만 표시) */
  onReveal?: ((reveal: boolean) => void) | undefined;
  revealBusy?: boolean | undefined;
}) {
  const win = view.headline === "승 리";
  const rematch = view.rematch;
  const revealedRows = view.rows.filter((r) => r.revealed && r.cards.length > 0);

  return (
    // presentation layer — 클릭은 그대로 게임판/상단 버튼에 전달된다.
    <div className="pointer-events-none absolute inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      <div className="pointer-events-none relative w-[min(720px,94vw)] max-h-[92vh] animate-scale-in">
        <img
          src={RESULT_FRAME}
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
          className="relative z-10 flex min-h-[300px] flex-col items-center justify-center px-[26px] pb-[34px] pt-[40px] text-center sm:min-h-[430px] sm:px-[62px] sm:pb-[58px] sm:pt-[70px]"
        >
          <p
            className={cn(
              "relative z-10 pb-1 font-display text-[26px] leading-[1.25] tracking-[0.2em] sm:text-[38px] sm:leading-[1.3] sm:tracking-[0.32em]",
              rematch ? "text-jade" : win ? "text-gold" : "text-foreground/70",
            )}
          >
            {view.headline}
          </p>

          {rematch ? (
            <div className="mt-4 grid gap-1.5">
              <p className="font-display text-base text-gold-soft">
                {`${rematchReasonLabel(view.rematchReason)} · 2장 재경기`}
              </p>
              <p className="font-display text-[21px] text-gold sm:text-[28px]">
                판돈 이월 {formatPoints(view.carryPot)}
              </p>
              <p className="text-[12px] text-foreground/70">다음 판으로 이월됩니다.</p>
            </div>
          ) : (
            <div className="mt-3 grid w-full gap-1.5">
              {view.winnerHand ? (
                <p className="truncate font-display text-base text-gold-soft sm:text-xl">
                  {view.winnerHand}
                </p>
              ) : view.foldWin ? (
                <p className="text-[13px] text-foreground/70">상대 전원 다이</p>
              ) : null}

              <ul className="grid gap-0.5">
                {view.payouts.map((p, i) => (
                  <li
                    key={`${p.nickname}-${i}`}
                    className="flex min-w-0 items-center justify-center gap-1.5 text-[13px] sm:gap-2 sm:text-[14px]"
                  >
                    {view.payouts.length > 1 && (
                      <span className="shrink-0 font-display text-[10px] tracking-widest text-gold-soft/80">
                        {p.label}
                      </span>
                    )}
                    <span className="max-w-[120px] truncate font-display text-gold sm:max-w-[190px]">
                      {p.nickname}
                    </span>
                    <span className="font-display tabular-nums text-gold">
                      +{formatPoints(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>

              {view.myNet !== null && (
                <p
                  className={cn(
                    "font-display text-[24px] leading-none tabular-nums sm:text-[30px]",
                    view.myNet > 0
                      ? "text-gold"
                      : view.myNet < 0
                        ? "text-destructive"
                        : "text-foreground/70",
                  )}
                  data-testid="sutda2-result-net"
                >
                  {formatSutda2Net(view.myNet)}
                </p>
              )}
              <p className="text-[11px] text-foreground/60">
                이번 판 손익
                {view.myFinalPoints !== null && ` · 현재 보유 ${formatPoints(view.myFinalPoints)}`}
              </p>
            </div>
          )}

          {/* 공개된 패 — 서버가 공개를 허용한 생존자만 (다이한 패는 애초에 오지 않는다) */}
          {revealedRows.length > 0 && (
            <div className="mt-2 flex max-w-full flex-wrap items-start justify-center gap-x-5 gap-y-1">
              {revealedRows.map((r) => (
                <div key={r.userId} className="flex flex-col items-center gap-0.5">
                  <span
                    className={cn(
                      "max-w-[120px] truncate text-[11px]",
                      r.status === "승" ? "text-gold" : "text-foreground/65",
                    )}
                  >
                    {r.nickname}
                  </span>
                  <span
                    className={cn(
                      "max-w-[120px] truncate font-display text-[12px]",
                      r.status === "승" ? "text-gold-soft" : "text-foreground/55",
                    )}
                  >
                    {r.handLabel ?? "-"}
                  </span>
                  <div className={cn("flex gap-1", r.status === "승" && "drop-shadow-[0_0_10px_var(--gold)]")}>
                    {r.cards.map((c) => (
                      <HwatuCard key={`${r.userId}-${c}`} cardId={c} visual="FACE_UP" size="sm" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 좌석별 요약 — 다이한 플레이어는 "패 비공개" 로만 표시 */}
          <ul className="mt-2 grid w-full gap-0.5 text-[11px] text-foreground/70">
            {view.rows.map((r) => (
              <li key={r.userId} className="flex flex-wrap items-center justify-center gap-x-2">
                <span className={cn("max-w-[110px] truncate", r.isMe && "text-gold-soft")}>
                  {r.nickname}
                </span>
                <span className={r.status === "승" ? "text-gold" : "text-foreground/50"}>
                  {r.status}
                </span>
                {!r.revealed && !rematch && <span className="text-foreground/35">패 비공개</span>}
                <span className="tabular-nums text-foreground/55">{formatSutda2Net(r.net)}</span>
              </li>
            ))}
          </ul>

          {/* 폴드승 승자만 공개 여부를 선택한다 — 미선택 시 서버 기준 비공개 유지 */}
          {view.canChooseReveal && onReveal && (
            <div className="pointer-events-auto mt-2.5 flex items-center justify-center gap-2">
              <Button variant="gold" size="sm" disabled={revealBusy} onClick={() => onReveal(true)}>
                패 공개
              </Button>
              <Button variant="table" size="sm" disabled={revealBusy} onClick={() => onReveal(false)}>
                패 비공개
              </Button>
            </div>
          )}

          {nextNotice && <p className="mt-2 text-[11px] text-gold-soft/80">{nextNotice}</p>}
        </div>
      </div>
    </div>
  );
}
