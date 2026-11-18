import { cn } from "@/lib/utils";
import { DORI_UI } from "./doriAssets";

/**
 * 도리 전용 이미지 버튼 — 배경은 실제 에셋(button-gold / button-red)이고
 * 라벨 텍스트만 오버레이한다. 게임 로직은 onClick 전달만 담당한다.
 */
export function DoriAssetButton({
  tone = "gold",
  disabled,
  onClick,
  title,
  className,
  children,
}: {
  tone?: "gold" | "red" | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  title?: string | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-[36px] min-w-[104px] items-center justify-center px-4",
        "font-display text-[13px] tracking-wide transition-transform",
        disabled ? "cursor-not-allowed opacity-45" : "hover:scale-[1.03] active:scale-[0.98]",
        tone === "gold" ? "text-[#3a2408]" : "text-[#fff2e2]",
        className,
      )}
    >
      <img
        src={tone === "gold" ? DORI_UI.buttonGold : DORI_UI.buttonRed}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
        draggable={false}
      />
      <span className="relative z-10 drop-shadow-[0_1px_0_rgba(255,255,255,0.25)]">{children}</span>
    </button>
  );
}
