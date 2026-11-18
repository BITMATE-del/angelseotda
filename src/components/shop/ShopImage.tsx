import { cn } from "@/lib/utils";
import { useShopImage } from "@/lib/shop/shopImage";

/** 이미지가 없거나 로딩 실패한 경우의 기본 카드 (깨진 이미지/alt 노출 금지) */
export function ShopImagePlaceholder({
  label = "이미지 준비중",
  className,
}: {
  label?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border border-gold/20 bg-gradient-to-b from-charcoal to-black/80 px-2 text-center",
        className,
      )}
    >
      <span className="font-display text-[10px] tracking-widest text-gold/70">ANGEL SUTDA</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

/** 상점 상품 이미지 — storage 경로를 조회 URL로 변환하고, 실패 시 placeholder를 표시한다. */
export function ShopImage({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderLabel,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderLabel?: string;
}) {
  const { url, onError } = useShopImage(src);
  if (!url) {
    return (
      <ShopImagePlaceholder
        className={placeholderClassName ?? className}
        label={placeholderLabel ?? "이미지 준비중"}
      />
    );
  }
  return <img src={url} alt={alt} loading="lazy" onError={onError} className={className} />;
}
