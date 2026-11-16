/**
 * ANGEL SUTDA 기본 카드 매니페스트.
 * 실제 전통 화투패 이미지 파일(/public/cards/hwatu/base/*.png) 20장을 1:1로 가리킨다.
 * 이미지는 절대 코드/CSS/SVG로 재현하지 않고, 이 파일의 assetUrl만 렌더링에 사용한다.
 */

export type SutdaMonth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type SutdaVariant = "gwang" | "normal" | "a" | "b";

export interface SutdaCard {
  id: string;
  month: SutdaMonth;
  variant: SutdaVariant;
  assetUrl: string;
  isGwang: boolean;
  name: string;
}

export const CARD_BASE_DIR = "/cards/hwatu/base";
export const CARD_SKIN_DIR = "/cards/hwatu/skins";
export const CARD_BACK_DIR = "/cards/hwatu/backs";

/** 광 카드는 정확히 이 3장만 존재한다. */
export const GWANG_IDS = ["01-gwang", "03-gwang", "08-gwang"] as const;

function make(
  id: string,
  month: SutdaMonth,
  variant: SutdaVariant,
  name: string,
): SutdaCard {
  return {
    id,
    month,
    variant,
    name,
    assetUrl: `${CARD_BASE_DIR}/${id}.png`,
    isGwang: (GWANG_IDS as readonly string[]).includes(id),
  };
}

export const SUTDA_CARDS: SutdaCard[] = [
  make("01-gwang", 1, "gwang", "1월 광"),
  make("01-normal", 1, "normal", "1월 일반"),
  make("02-a", 2, "a", "2월 매조"),
  make("02-b", 2, "b", "2월 일반"),
  make("03-gwang", 3, "gwang", "3월 광"),
  make("03-normal", 3, "normal", "3월 일반"),
  make("04-a", 4, "a", "4월 흑싸리"),
  make("04-b", 4, "b", "4월 일반"),
  make("05-a", 5, "a", "5월 난초"),
  make("05-b", 5, "b", "5월 일반"),
  make("06-a", 6, "a", "6월 모란"),
  make("06-b", 6, "b", "6월 일반"),
  make("07-a", 7, "a", "7월 홍싸리"),
  make("07-b", 7, "b", "7월 일반"),
  make("08-gwang", 8, "gwang", "8월 광"),
  make("08-normal", 8, "normal", "8월 일반"),
  make("09-a", 9, "a", "9월 국화"),
  make("09-b", 9, "b", "9월 일반"),
  make("10-a", 10, "a", "10월 단풍"),
  make("10-b", 10, "b", "10월 일반"),
];

/** 레거시 id(m01-gwang 등) 호환용 정규화 */
export function normalizeCardId(id: string): string {
  return id.replace(/^m/, "");
}

export const SUTDA_CARD_MAP = new Map(SUTDA_CARDS.map((c) => [c.id, c]));
