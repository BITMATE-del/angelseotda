import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import type { BetAction } from "@/lib/game/types";
import type { ServerActionOption } from "@/lib/services/serverGameService";
import { formatPoints } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";


/** 표시 순서 — 아이콘/글리프 없이 한글 텍스트만 사용한다. */
const ORDER: BetAction[] = [
  "die",
  "jjol",
  "check",
  "call",
  "ping",
  "ttadang",
  "quarter",
  "half",
  "all_in",
];

const LABEL: Record<BetAction, string> = {
  die: "다이",
  jjol: "쫄",
  check: "체크",
  call: "콜",
  ping: "삥",
  ttadang: "따당",
  quarter: "쿼터",
  half: "하프",
  all_in: "올인",
};

/**
 * GameActionBar — 하단 고정 액션바. 항상 한 줄 정렬이며 사용 불가 행동은 disabled 처리한다.
 * 금액은 100% 서버(availableActions) 값을 그대로 표시한다 (프론트 재계산 금지).
 */
export function GameActionBar({
  options,
  myTurn,
  disabled,
  allInLocked,
  onAction,
}: {
  options: ServerActionOption[];
  myTurn: boolean;
  disabled?: boolean;
  /** 올인이 아직 열리지 않은 상태 (실질 베팅 2회 미만) */
  allInLocked?: boolean;
  onAction: (action: BetAction) => void;
}) {
  const [confirmAllIn, setConfirmAllIn] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 방금 누른 행동 — 클릭 즉시 "처리 중" 표시용 (결과는 서버가 확정한다) */
  const [pending, setPending] = useState<BetAction | null>(null);
  const sentRef = useRef(false);
  const byAction = new Map(options.map((o) => [o.action, o.amount] as const));
  const visible = ORDER.filter((a) => a !== "jjol" || byAction.has("jjol"));

  // 서버 처리(disabled)가 끝나면 처리 중 표시를 해제한다
  useEffect(() => {
    if (!disabled) setPending(null);
  }, [disabled]);

  // ESC = 취소 (모달이 열려 있고 아직 전송하지 않은 경우에만)
  useEffect(() => {
    if (confirmAllIn === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        setConfirmAllIn(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmAllIn, submitting]);

  // 올인 전송 후 서버 상태가 갱신되면(내 차례 종료) 모달을 닫는다
  useEffect(() => {
    if (!submitting) return;
    if (!myTurn) {
      setSubmitting(false);
      sentRef.current = false;
      setConfirmAllIn(null);
    }
  }, [submitting, myTurn]);

  const confirmAllInSend = () => {
    if (sentRef.current) return; // 더블클릭으로 RPC 2회 호출 금지
    sentRef.current = true;
    setSubmitting(true);
    onAction("all_in");
  };


  return (
    <div className="rounded-2xl border border-gold/25 bg-charcoal/95 px-2 py-2 backdrop-blur">
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {visible.map((action) => {
          const amount = byAction.get(action);
          const available = myTurn && amount !== undefined && !disabled;
          const isRisk = action === "die" || action === "jjol";
          const isAllIn = action === "all_in";
          const isPending = pending === action;
          return (
            <Button
              key={action}
              variant={isAllIn ? "danger" : isRisk ? "danger" : action === "call" ? "gold" : "table"}
              size="lg"
              disabled={!available}
              title={
                isAllIn && allInLocked
                  ? "올인은 베팅이 2회 이상 진행된 후에 사용할 수 있습니다."
                  : undefined
              }
              className={cn(
                "h-auto flex-col gap-0 py-2",
                !available && !isPending && "opacity-40",
                // 클릭 직후 눌린 상태를 즉시 보여준다 (서버 응답 대기 중에도 무반응처럼 보이지 않도록)
                isPending && "scale-[0.97] opacity-100 ring-2 ring-gold",
                isAllIn && available && "shadow-[0_0_18px_-4px_var(--gold)]",
              )}
              onClick={() => {
                if (isAllIn) {
                  setConfirmAllIn(amount ?? 0);
                  return;
                }
                setPending(action);
                onAction(action);
              }}
            >
              <span className="font-display text-[15px] leading-tight">{LABEL[action]}</span>
              <span className="text-[10px] leading-tight opacity-80">
                {isPending
                  ? "처리 중"
                  : amount !== undefined && amount > 0
                    ? formatPoints(amount)
                    : "\u00A0"}
              </span>
            </Button>
          );
        })}
      </div>

      {/* ALL-IN 확인 — 전역 modal layer(portal). 게임판 스크롤/높이와 무관하게 viewport 정중앙 고정 */}
      {confirmAllIn !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="올인 확인"
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!submitting) setConfirmAllIn(null);
            }}
          >
            <div
              className="gold-frame w-full max-w-sm rounded-2xl bg-charcoal px-6 py-5 text-center shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-display text-2xl tracking-widest text-gold">ALL-IN</p>
              <p className="mt-3 text-sm text-foreground">
                보유 포인트 전액 {formatPoints(confirmAllIn)}을 베팅합니다.
              </p>
              <p className="mt-1 text-sm text-foreground">정말 올인하시겠습니까?</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                올인 후에는 추가 베팅을 할 수 없고, 내가 넣은 금액까지만 상금을 받습니다.
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button
                  variant="table"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setConfirmAllIn(null)}
                >
                  취소
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={submitting || disabled}
                  onClick={confirmAllInSend}
                >
                  {submitting ? "처리 중..." : "올인"}
                </Button>
              </div>
            </div>
          </div>,
          // 전체화면에서는 게임 wrapper 만 fullscreen element 이므로 그 내부로 렌더링한다.
          document.fullscreenElement ?? document.body,
        )}

    </div>
  );
}
