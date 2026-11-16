import { HwatuCard } from "@/components/game/HwatuCard";
import { ShopImage, ShopImagePlaceholder } from "@/components/shop/ShopImage";
import { EFFECT_CATEGORY_LABEL } from "@/lib/game/rankTiers";
import { cn } from "@/lib/utils";
import { useShopImage } from "@/lib/shop/shopImage";
import {
  itemImage,
  itemKind,
  itemTableBackground,
  type ShopItemLike,
} from "@/lib/shop/itemVisuals";

/** 상점/인벤토리 카드 썸네일 — 카테고리별로 실제 착용 느낌이 보이도록 렌더한다. */
export function ItemThumb({
  item,
  size = "md",
  className,
}: {
  item: ShopItemLike;
  size?: "md" | "lg";
  className?: string;
}) {
  const kind = itemKind(item.category);
  const raw = itemImage(item);
  const { url: resolved } = useShopImage(raw);
  const box = size === "lg" ? "h-44 w-32" : "h-36 w-24";

  if (kind === "card_back") {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <HwatuCard
          visual="FACE_DOWN"
          backSkin={resolved ?? "classic-red"}
          size={size === "lg" ? "xl" : "lg"}
        />
      </div>
    );
  }

  if (kind === "frame") {
    return (
      <div className={cn("relative", box, className)}>
        <div className="absolute inset-3 rounded-lg bg-gradient-to-b from-charcoal to-black/70" />
        {raw && (
          <ShopImage
            src={raw}
            alt={item.name}
            className="absolute inset-0 h-full w-full object-contain"
            placeholderClassName="absolute inset-0 h-full w-full"
          />
        )}
      </div>
    );
  }

  if (kind === "table_skin") {
    return (
      <div
        className={cn("rounded-xl border border-gold/25", box, className)}
        style={{ background: itemTableBackground(item) }}
      >
        <div className="m-3 h-[70%] rounded-full border border-gold/20 bg-black/20" />
      </div>
    );
  }

  if (raw) {
    return (
      <ShopImage
        src={raw}
        alt={item.name}
        className={cn("rounded-lg border border-gold/25 object-cover", box, className)}
        placeholderClassName={cn(box, className)}
      />
    );
  }

  if (kind === "title") {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-gold/20 bg-black/40 px-2 text-center text-xs text-gold-soft",
          box,
          className,
        )}
      >
        {`「 ${item.name} 」`}
      </div>
    );
  }

  return (
    <ShopImagePlaceholder
      className={cn(box, className)}
      label={EFFECT_CATEGORY_LABEL[item.category] ?? item.name}
    />
  );
}
