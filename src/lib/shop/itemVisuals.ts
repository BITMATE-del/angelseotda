import frameBronze from "@/assets/frames/frame-bronze.png";
import frameSilver from "@/assets/frames/frame-silver.png";
import frameGold from "@/assets/frames/frame-gold.png";
import frameDiamond from "@/assets/frames/frame-diamond.png";
import frameChallenger from "@/assets/frames/frame-challenger.png";
import backSilver from "@/assets/cardbacks/back-silver.jpg";
import backGold from "@/assets/cardbacks/back-gold.jpg";
import backDiamond from "@/assets/cardbacks/back-diamond.jpg";
import backChallenger from "@/assets/cardbacks/back-challenger.jpg";
import effectGold from "@/assets/effects/effect-gold-win.jpg";
import effectDiamond from "@/assets/effects/effect-diamond-aura.jpg";
import effectChallenger from "@/assets/effects/effect-challenger-win.jpg";
import type { AppRank } from "@/lib/game/rankTiers";

/**
 * 상점/인벤토리 표시용 에셋 매핑.
 * 서버 items.asset_url이 등록되어 있으면 항상 그 값을 우선한다.
 * 등록 전(공백) 아이템은 계급 기준 기본 에셋으로 대체해 "실제 보상"처럼 보이게 한다.
 */

export type ItemKind =
  | "character"
  | "card_back"
  | "frame"
  | "effect"
  | "title"
  | "table_skin"
  | "emote";

export interface ShopItemLike {
  category: string;
  name: string;
  rarity?: string | null;
  asset_url?: string | null;
  rank_required?: AppRank | null;
}

const CATEGORY_KIND: Record<string, ItemKind> = {
  character: "character",
  card_back: "card_back",
  card_skin: "card_back",
  profile_frame: "frame",
  win_effect: "effect",
  entry_effect: "effect",
  showdown_effect: "effect",
  name_effect: "effect",
  pot_effect: "effect",
  title: "title",
  table_skin: "table_skin",
  emote: "emote",
  emoticon: "emote",
};

export const KIND_LABEL: Record<ItemKind, string> = {
  character: "캐릭터",
  card_back: "카드 뒷면",
  frame: "프레임",
  effect: "이펙트",
  title: "칭호",
  table_skin: "테이블 스킨",
  emote: "감정표현",
};

export const RANK_FRAME: Partial<Record<AppRank, string>> = {
  BRONZE: frameBronze,
  SILVER: frameSilver,
  GOLD: frameGold,
  DIAMOND: frameDiamond,
  CHALLENGER: frameChallenger,
};

export const RANK_CARD_BACK: Partial<Record<AppRank, string>> = {
  SILVER: backSilver,
  GOLD: backGold,
  DIAMOND: backDiamond,
  CHALLENGER: backChallenger,
};

export const RANK_EFFECT: Partial<Record<AppRank, string>> = {
  GOLD: effectGold,
  DIAMOND: effectDiamond,
  CHALLENGER: effectChallenger,
};

/** 테이블 스킨 미리보기 그라데이션 (계급/이름 기준) */
export const RANK_TABLE: Partial<Record<AppRank, string>> = {
  BRONZE: "linear-gradient(140deg,#4a2f1d,#2b1a10)",
  SILVER: "linear-gradient(140deg,#3a4450,#181d24)",
  GOLD: "linear-gradient(140deg,#5a4415,#241a06)",
  DIAMOND: "linear-gradient(140deg,#1d3a52,#0b1a26)",
  CHALLENGER: "linear-gradient(140deg,#4a0f16,#150407)",
};

const NAME_RANK: [RegExp, AppRank][] = [
  [/브론즈|BRONZE/i, "BRONZE"],
  [/실버|SILVER/i, "SILVER"],
  [/골드|GOLD|황금/i, "GOLD"],
  [/다이아|DIAMOND/i, "DIAMOND"],
  [/챌린저|CHALLENGER/i, "CHALLENGER"],
];

export function itemKind(category: string): ItemKind {
  return CATEGORY_KIND[category] ?? "effect";
}

/** 아이템의 계급 성향 추정 — rank_required가 없으면 이름 키워드로 판단 */
export function itemRank(item: ShopItemLike): AppRank | null {
  if (item.rank_required) return item.rank_required;
  for (const [re, rank] of NAME_RANK) if (re.test(item.name)) return rank;
  return null;
}

/** 썸네일/프리뷰에 사용할 이미지 (없으면 null → 토큰 기반 플레이스홀더) */
export function itemImage(item: ShopItemLike): string | null {
  if (item.asset_url) return item.asset_url;
  const kind = itemKind(item.category);
  const rank = itemRank(item);
  if (!rank) return null;
  if (kind === "frame") return RANK_FRAME[rank] ?? null;
  if (kind === "card_back") return RANK_CARD_BACK[rank] ?? null;
  if (kind === "effect") return RANK_EFFECT[rank] ?? null;
  return null;
}

/** 테이블 스킨 프리뷰 배경 */
export function itemTableBackground(item: ShopItemLike): string {
  const rank = itemRank(item);
  return (rank && RANK_TABLE[rank]) || "linear-gradient(140deg,#123024,#08140f)";
}

/** RARE 아이템 강조 링 클래스 */
export function rarityRing(rarity: string | null | undefined, equipped: boolean) {
  if (rarity === "RARE") return "border-crimson/70 shadow-[0_0_22px_-6px_hsl(var(--crimson)/0.8)]";
  if (equipped) return "border-gold/60 shadow-[0_0_18px_-8px_hsl(var(--gold)/0.9)]";
  return "border-gold/12";
}
