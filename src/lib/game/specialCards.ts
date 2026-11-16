/**
 * SPECIAL CARD IDENTITY — 특수족보 지정 카드 (표시 전용 mirror).
 *
 * 실제 판정의 source of truth 는 서버(public.sutda_special_cards / app_settings.special_cards)이며,
 * 이 파일은 동일한 기본값을 그대로 복제해 "현재 최고패" 라벨 표시에만 사용한다.
 * 월(month) 숫자만으로 추측하지 않고 반드시 카드 id(variant) 를 정확히 비교한다.
 */
export const SPECIAL_CARD_PAIRS = {
  /** 암행어사 — 4월 흑싸리 + 7월 홍싸리 */
  amhaeng: ["04-a", "07-a"] as const,
  /** 땡잡이 — 3월 벚꽃 광 + 7월 홍싸리 */
  ttaengjabi: ["03-gwang", "07-a"] as const,
  /** 멍텅구리구사 — 4월 흑싸리 + 9월 국화 */
  gusa_meongteong: ["04-a", "09-a"] as const,
} as const;

export type SpecialPairKey = keyof typeof SPECIAL_CARD_PAIRS;

/** 두 카드가 지정된 특수족보 카드 조합과 정확히 일치하는지 (순서 무관) */
export function isSpecialPair(c1: string, c2: string, key: SpecialPairKey): boolean {
  const [a, b] = SPECIAL_CARD_PAIRS[key];
  return (c1 === a && c2 === b) || (c1 === b && c2 === a);
}
