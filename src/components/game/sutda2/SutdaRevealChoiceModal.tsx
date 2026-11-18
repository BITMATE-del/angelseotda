/**
 * 상대 전원 다이 승리 시 "패 공개 / 패 비공개" 선택 모달 (프레젠테이션 전용).
 *
 * 표시 조건은 100% 서버 상태(get_round_state.foldWinChoice === 'PENDING' + iAmFoldWinner)다.
 * 이 모달은 선택만 받고 정산/진행에는 개입하지 않는다(게임판 클릭은 배경에서 막지 않는다).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function SutdaRevealChoiceModal({
  deadline,
  busy,
  onChoose,
}: {
  /** 서버 마감 시각 (ISO) */
  deadline: string | null;
  busy: boolean;
  onChoose: (reveal: boolean) => void;
}) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setLeft(null);
      return undefined;
    }
    const tick = () => {
      const ms = new Date(deadline).getTime() - Date.now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => window.clearInterval(t);
  }, [deadline]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="false"
        aria-label="패 공개 선택"
        className="panel-surface gold-frame pointer-events-auto w-[min(520px,94%)] rounded-2xl border border-gold/50 bg-black/90 px-8 py-7 text-center shadow-[0_0_40px_rgba(0,0,0,0.7)]"
      >
        <p className="font-display text-[26px] leading-tight tracking-[0.08em] text-gold">
          상대 전원 다이 승리
        </p>
        <p className="mt-4 text-[18px] leading-relaxed text-foreground">
          내 패를 공개하시겠습니까?
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            variant="gold"
            disabled={busy}
            className="h-[48px] min-w-[140px] text-[16px]"
            onClick={() => onChoose(true)}
          >
            패 공개
          </Button>
          <Button
            variant="table"
            disabled={busy}
            className="h-[48px] min-w-[140px] text-[16px]"
            onClick={() => onChoose(false)}
          >
            패 비공개
          </Button>
        </div>

        <p className="mt-5 text-[15px] text-foreground/70">
          {busy
            ? "선택을 처리하는 중입니다..."
            : left === null
              ? "선택하지 않으면 비공개로 확정됩니다."
              : `${left}초 후 자동으로 비공개됩니다.`}
        </p>
      </div>
    </div>
  );
}
