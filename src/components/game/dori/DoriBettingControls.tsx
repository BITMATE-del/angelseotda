import { DoriAssetButton } from "./DoriAssetButton";
import { formatPoints } from "@/lib/services/walletService";
import type { DoriActionOption } from "@/lib/services/doriService";
import type { DoriBetAction } from "@/lib/game/dori/doriRules";

/** RULE PATCH 2 — 기존 섯다와 동일한 액션/명칭 체계 (BET·RAISE 제거) */
const LABEL: Record<DoriBetAction, string> = {
  die: "다이",
  check: "체크",
  call: "콜",
  ping: "삥",
  ttadang: "따당",
  quarter: "쿼터",
  half: "하프",
  all_in: "올인",
};

/** 도리 전용 베팅 컨트롤. 표시 금액 = 서버가 계산한 실제 추가 차감액. */
export function DoriBettingControls({
  options,
  myTurn,
  busy,
  onAction,
}: {
  options: DoriActionOption[];
  myTurn: boolean;
  busy?: boolean;
  onAction: (option: DoriActionOption) => void;
}) {
  return (
    <div
      className={
        myTurn
          ? "rounded-2xl border border-gold bg-black/65 p-2.5 shadow-[0_0_18px_-4px_var(--gold),inset_0_0_0_1px_rgba(212,175,55,0.12)]"
          : "rounded-2xl border border-gold/30 bg-black/65 p-2.5 shadow-[inset_0_0_0_1px_rgba(212,175,55,0.12)]"
      }
    >
      <div className="flex flex-wrap justify-end gap-1.5">
        {options.map((o) => (
          <DoriAssetButton
            key={o.action}
            tone={o.action === "die" ? "red" : "gold"}
            disabled={!myTurn || !o.enabled || busy}
            title={o.reason}
            className="h-[46px] min-w-[104px] flex-col gap-0 px-3 leading-none"
            onClick={() => onAction(o)}
          >
            <span className="leading-none">{LABEL[o.action]}</span>
            {o.amount > 0 && (
              <span className="mt-0.5 block text-[11px] leading-none opacity-80">
                {formatPoints(o.amount)}
              </span>
            )}
          </DoriAssetButton>
        ))}
      </div>
      <p
        className={
          myTurn
            ? "mt-1.5 text-right text-[11px] font-semibold text-gold [text-shadow:0_0_10px_var(--gold)]"
            : "mt-1.5 text-right text-[11px] text-foreground/60"
        }
      >
        {myTurn ? "내 차례입니다." : "상대의 선택을 기다리는 중입니다."}
      </p>
    </div>
  );
}
