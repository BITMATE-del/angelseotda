/**
 * ANGEL SUTDA 화투 덱 정의.
 * 기본 카드 20장은 src/data/sutdaCards.ts 매니페스트(실제 이미지 파일)를 그대로 사용한다.
 * 화려한 스타일은 기본 카드가 아니라 "프리미엄 스킨"으로만 제공한다.
 */
import {
  CARD_BACK_DIR,
  CARD_BASE_DIR,
  CARD_SKIN_DIR,
  SUTDA_CARDS,
  SUTDA_CARD_MAP,
  normalizeCardId,
  type SutdaCard,
  type SutdaMonth,
  type SutdaVariant,
} from "@/data/sutdaCards";

export type CardId = string;
export type Month = SutdaMonth;
export type CardVariant = SutdaVariant;
export type HwatuCard = SutdaCard;

export const CARD_IMAGE_BASE = "/cards/hwatu";
export const CARD_FACE_BASE = CARD_BASE_DIR;

/** 카드 앞면 스킨 — 기본은 전통 화투(실제 에셋), 나머지는 상점 프리미엄 스킨 */
export const FACE_SKINS = [
  { id: "base", name: "전통 화투 (기본)", path: CARD_BASE_DIR, premium: false },
  {
    id: "premium-red",
    name: "프리미엄 레드",
    path: `${CARD_SKIN_DIR}/premium-red`,
    premium: true,
  },
] as const;

export type FaceSkinId = (typeof FACE_SKINS)[number]["id"];

export function faceSkinPath(skin: FaceSkinId | string | undefined): string {
  return (FACE_SKINS.find((s) => s.id === skin) ?? FACE_SKINS[0]).path;
}

/** 카드 파일명 (레거시 m 접두사 제거) */
export function cardFileName(id: CardId): string {
  return `${normalizeCardId(id)}.png`;
}

/** 선택된 앞면 스킨의 카드 이미지 경로 (스킨이 바뀌어도 id·족보는 불변) */
export function cardFaceUrl(id: CardId, skin?: FaceSkinId | string): string {
  return `${faceSkinPath(skin)}/${cardFileName(id)}`;
}

/** 1월~10월 각 2장, 총 20장 실제 에셋 */
export const DECK: HwatuCard[] = SUTDA_CARDS;

/** 알 수 없는 id는 null. 렌더링이 깨지지 않도록 예외를 던지지 않는다. */
export function findCard(id: string): HwatuCard | null {
  return SUTDA_CARD_MAP.get(normalizeCardId(id)) ?? null;
}

/** 알 수 없는 id는 안전한 플레이스홀더 카드를 반환한다. */
export function getCard(id: string): HwatuCard {
  return (
    findCard(id) ?? {
      id,
      month: 1,
      variant: "normal",
      assetUrl: `${CARD_BACK_DIR}/back-classic-red.svg`,
      isGwang: false,
      name: "알 수 없는 카드",
    }
  );
}


/** 월별 카드 조회 (족보표 등 UI 용도) */
export function cardsOfMonth(month: Month): HwatuCard[] {
  return DECK.filter((c) => c.month === month);
}

/** 해당 월의 대표 카드 (광이 있으면 광) */
export function monthLead(month: Month): HwatuCard {
  const list = cardsOfMonth(month);
  return list.find((c) => c.isGwang) ?? list[0]!;
}

/** Fisher-Yates. 실제 서비스에서는 서버에서만 호출한다. */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export interface DealResult {
  hands: CardId[][];
  rest: CardId[];
}

/** 플레이어 수 × 장수만큼 배분한다. */
export function deal(playerCount: number, perPlayer: number, random?: () => number): DealResult {
  const deck = shuffle(DECK, random).map((c) => c.id);
  const hands: CardId[][] = Array.from({ length: playerCount }, () => []);
  let cursor = 0;
  for (let round = 0; round < perPlayer; round++) {
    for (let p = 0; p < playerCount; p++) hands[p]!.push(deck[cursor++]!);
  }
  return { hands, rest: deck.slice(cursor) };
}

export const CARD_SKINS = [
  {
    id: "classic-red",
    name: "클래식 레드",
    back: `${CARD_IMAGE_BASE}/backs/back-classic-red.svg`,
  },
  {
    id: "midnight-blue",
    name: "미드나잇 블루",
    back: `${CARD_IMAGE_BASE}/backs/back-midnight-blue.svg`,
  },
  {
    id: "emerald-green",
    name: "에메랄드 그린",
    back: `${CARD_IMAGE_BASE}/backs/back-emerald-green.svg`,
  },
  {
    id: "royal-purple",
    name: "로열 퍼플",
    back: `${CARD_IMAGE_BASE}/backs/back-royal-purple.svg`,
  },
] as const;

export type CardSkinId = (typeof CARD_SKINS)[number]["id"];

export function skinBack(skin: CardSkinId | string): string {
  // 상점 장착 아이템은 실제 이미지 URL/경로가 그대로 전달된다
  if (skin && (skin.startsWith("/") || skin.startsWith("http") || skin.startsWith("data:"))) {
    return skin;
  }
  return (CARD_SKINS.find((s) => s.id === skin) ?? CARD_SKINS[0]).back;
}
