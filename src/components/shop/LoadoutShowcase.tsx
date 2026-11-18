import { HwatuCard } from "@/components/game/HwatuCard";
import { RankBadge } from "@/components/rank/RankBadge";
import type { AppRank } from "@/lib/game/rankTiers";
import { ShopImage } from "@/components/shop/ShopImage";
import { useResolvedAvatar } from "@/lib/profile/resolveAvatar";
import { useShopImage } from "@/lib/shop/shopImage";
import { cn } from "@/lib/utils";
import {
  itemImage,
  itemKind,
  itemTableBackground,
  KIND_LABEL,
  type ItemKind,
  type ShopItemLike,
} from "@/lib/shop/itemVisuals";

interface Props {
  /** 활성 커스텀 프로필 판정을 위한 회원 id */
  userId?: string | null;
  nickname: string;
  rank: AppRank | null | undefined;
  equipped: ShopItemLike[];
  /** 선택(미리보기) 아이템 — 장착 전 결과를 즉시 확인한다. */
  preview?: ShopItemLike | null;
  /** 서버 공통 조회(my_equipped_title)로 판정된 현재 장착 칭호 (커스텀 칭호 포함) */
  equippedTitleText?: string | null;
}

function pick(items: ShopItemLike[], kind: ItemKind) {
  return items.find((i) => itemKind(i.category) === kind) ?? null;
}

/** 내 캐릭터 / 장착 아이템 프리뷰 — 장착 전·후를 같은 화면에서 비교한다. */
export function LoadoutShowcase({
  userId = null,
  nickname,
  rank,
  equipped,
  preview,
  equippedTitleText = null,
}: Props) {
  const previewKind = preview ? itemKind(preview.category) : null;
  const resolve = (kind: ItemKind) =>
    previewKind === kind ? preview! : pick(equipped, kind);

  const character = resolve("character");
  const frame = resolve("frame");
  const cardBack = resolve("card_back");
  const effect = resolve("effect");
  /** 커스텀 칭호는 user_items 가 아니라 custom_titles 에 있으므로 서버 공통값을 우선한다 */
  const previewTitle = previewKind === "title" ? preview!.name : null;
  const titleText = previewTitle ?? equippedTitleText ?? pick(equipped, "title")?.name ?? null;
  const table = resolve("table_skin");

  const changed = (kind: ItemKind) => previewKind === kind;
  /** 프로필 이미지는 공통 resolver 로 결정한다 (커스텀 → 장착 캐릭터 → 기본) */
  const equippedCharacterUrl = character ? itemImage(character) : null;
  const avatarSrc = useResolvedAvatar(userId, { equippedCharacterUrl });
  const customProfileActive = !!avatarSrc && avatarSrc !== equippedCharacterUrl;
  const { url: cardBackUrl } = useShopImage(cardBack ? itemImage(cardBack) : null);

  return (
    <div
      className="panel-surface relative overflow-hidden rounded-2xl p-5"
      style={{ background: table ? itemTableBackground(table) : undefined }}
    >
      <div className="relative flex flex-wrap items-start gap-6">
        {/* 캐릭터 + 프레임 */}
        <div className="relative h-52 w-40 shrink-0">
          <div className="absolute inset-4 overflow-hidden rounded-xl border border-gold/20 bg-black/50">
            {avatarSrc ? (
              customProfileActive ? (
                <img
                  src={avatarSrc}
                  alt="커스텀 프로필"
                  className="h-full w-full object-cover object-center"
                />
              ) : (
                <ShopImage
                  src={avatarSrc}
                  alt={character?.name ?? "장착 캐릭터"}
                  className="h-full w-full object-cover object-center"
                  placeholderClassName="h-full w-full"
                />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                기본 캐릭터
              </div>
            )}
          </div>
          {frame && itemImage(frame) && (
            <ShopImage
              src={itemImage(frame)}
              alt={frame.name}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              placeholderClassName="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            />
          )}
        </div>

        <div className="min-w-[220px] flex-1 space-y-3">
          {/* 1줄 — 칭호 | 닉네임 (계급은 칭호 자리에 오지 않는다) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm text-gold">{titleText ?? "칭호없음"}</span>
            <span className="text-gold-soft">|</span>
            <span className="text-sm font-semibold text-foreground">{nickname}</span>
          </div>
          {/* 2줄 — 계급 (한 번만 표시) */}
          <div className="flex items-center gap-2">
            <RankBadge rank={rank} size="sm" />
          </div>


          <div className="flex flex-wrap gap-3">
            <SlotBox label={KIND_LABEL.card_back} changed={changed("card_back")}>
              <HwatuCard
                visual="FACE_DOWN"
                backSkin={cardBackUrl || "classic-red"}
                size="sm"
              />
            </SlotBox>
            <SlotBox label={KIND_LABEL.effect} changed={changed("effect")}>
              {effect && itemImage(effect) ? (
                <ShopImage
                  src={itemImage(effect)}
                  alt={effect.name}
                  className="h-[66px] w-[66px] rounded-md object-cover"
                  placeholderClassName="h-[66px] w-[66px] rounded-md"
                />
              ) : (
                <span className="text-[10px] text-muted-foreground">없음</span>
              )}
            </SlotBox>
            <SlotBox label={KIND_LABEL.frame} changed={changed("frame")}>
              <span className="px-2 text-center text-[10px] text-gold-soft">
                {frame ? frame.name : "없음"}
              </span>
            </SlotBox>
            <SlotBox label={KIND_LABEL.table_skin} changed={changed("table_skin")}>
              <span className="px-2 text-center text-[10px] text-gold-soft">
                {table ? table.name : "기본"}
              </span>
            </SlotBox>
          </div>

          {preview && (
            <p className="text-xs text-gold-soft">
              미리보기: {preview.name} ({KIND_LABEL[itemKind(preview.category)]}) — 장착하면 위 프리뷰로
              적용됩니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SlotBox({
  label,
  changed,
  children,
}: {
  label: string;
  changed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <div
        className={cn(
          "flex h-[74px] w-[74px] items-center justify-center rounded-lg border bg-black/40",
          changed ? "border-gold/70 shadow-[0_0_16px_-6px_hsl(var(--gold)/0.9)]" : "border-gold/15",
        )}
      >
        {children}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
