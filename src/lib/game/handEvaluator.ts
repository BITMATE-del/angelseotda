import type { GameMode } from "./types";
import { evaluateSutda2, compareHands, type Hand } from "./sutda2Rules";
import { evaluateSutda3 } from "./sutda3Rules";

/** 모드별 족보 판정 진입점 */
export function evaluateHand(mode: GameMode, cardIds: readonly string[]): Hand {
  return mode === "sutda3" ? evaluateSutda3(cardIds) : evaluateSutda2(cardIds);
}

export interface Showdown {
  winners: number[];
  hands: Hand[];
}

export function resolveShowdown(mode: GameMode, hands: readonly string[][]): Showdown {
  const evaluated = hands.map((cards) => evaluateHand(mode, cards));
  return { winners: compareHands(evaluated), hands: evaluated };
}

export { compareHands };
export type { Hand };
