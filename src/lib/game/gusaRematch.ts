/**
 * 구사 / 멍텅구리구사 재경기 조건 (BUGFIX REGRESSION).
 * 서버 public.gusa_rematch_required / apply_contextual_rules 와 동일한 규칙을 가진 순수 모듈.
 *
 * - 일반 구사: 최고 정상 족보가 "알리(806) 이하"일 때만 재경기
 * - 멍텅구리구사: 최고 정상 족보가 "9땡(909) 이하"일 때만 재경기
 * - 재경기 조건을 충족하지 못한 구사는 3끗(103)으로 계산한다
 */
/** 재경기 사유 코드 (서버 get_round_state rematchReason 과 동일) */
export type RematchReason = "DRAW" | "GUSA" | "GUSA_MEONGTEONG";

/** 재경기 사유 표시 문구 — 일반 구사와 멍텅구리구사를 구분한다 */
export function rematchReasonLabel(reason: RematchReason | null | undefined): string {
  if (reason === "GUSA") return "구사";
  if (reason === "GUSA_MEONGTEONG") return "멍텅구리구사";
  return "무승부";
}

export interface GusaEntry {
  /** 족보 code (gusa / gusa_meongteong / ttaeng10 / ali ...) */
  code: string;
  /** 기본 족보 점수 */
  score: number;
}

export const ALI_SCORE = 806;
export const TTAENG9_SCORE = 909;
const KKEUT3_SCORE = 103;

const isGusa = (code: string) => code === "gusa" || code === "gusa_meongteong";

/** 구사가 아닌 플레이어들의 최고 점수 */
export function bestNormalScore(hands: readonly GusaEntry[], selfIndex?: number): number {
  return hands.reduce(
    (best, h, i) => (isGusa(h.code) || i === selfIndex ? best : Math.max(best, h.score)),
    0,
  );
}

/** 이 구사가 재경기 조건을 충족하는지 */
export function gusaQualifies(code: string, bestOther: number): boolean {
  if (code === "gusa_meongteong") return bestOther <= TTAENG9_SCORE;
  if (code === "gusa") return bestOther <= ALI_SCORE;
  return false;
}

/** 라운드 전체 기준 재경기 발동 여부 */
export function gusaRematchRequired(hands: readonly GusaEntry[]): boolean {
  if (hands.length < 2) return false;
  const bestOther = bestNormalScore(hands);
  return hands.some((h) => gusaQualifies(h.code, bestOther));
}

/** 재경기가 발생하지 않는 경우의 유효 점수 (구사는 3끗 처리) */
export function effectiveScores(hands: readonly GusaEntry[]): number[] {
  return hands.map((h, i) =>
    isGusa(h.code) && !gusaQualifies(h.code, bestNormalScore(hands, i)) ? KKEUT3_SCORE : h.score,
  );
}
