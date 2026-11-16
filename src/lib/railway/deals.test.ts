import { describe, expect, it } from "vitest";
import { SUTDA_CARDS } from "@/data/sutdaCards";
import { canPrepareRound, cryptographicShuffle, dealPrivateHands } from "./rounds.server";

describe("Railway private preview deal", () => {
  it("preserves every original 20-card identifier without duplicates", () => {
    const source = SUTDA_CARDS.map(c=>c.id);
    const shuffled = cryptographicShuffle(source, max=>max-1);
    expect(shuffled).toHaveLength(20);
    expect(new Set(shuffled).size).toBe(20);
    expect([...shuffled].sort()).toEqual([...source].sort());
  });
  it("rejects invalid random indexes", () => {
    expect(()=>cryptographicShuffle(["a","b"],()=>-1)).toThrow("INVALID_RANDOM_INDEX");
    expect(()=>cryptographicShuffle(["a","b"],()=>2)).toThrow("INVALID_RANDOM_INDEX");
  });
  it.each([
    ["SUTDA2",[1,2],2],
    ["SUTDA3",[1,2,3],3],
    ["DORI",[1,2,3,4],5],
  ] as const)("deals mode %s with unique cards", (mode,seats,perPlayer) => {
    const hands = dealPrivateHands(mode,seats);
    expect(hands.map(h=>h.cards.length)).toEqual(seats.map(()=>perPlayer));
    expect(new Set(hands.flatMap(h=>h.cards)).size).toBe(seats.length*perPlayer);
    expect(hands.map(h=>h.seat)).toEqual([...seats]);
  });
  it("rejects impossible player counts and duplicate seats", () => {
    expect(canPrepareRound(7,"SUTDA3")).toBe(false);
    expect(canPrepareRound(6,"SUTDA3")).toBe(true);
    expect(()=>dealPrivateHands("DORI",[1,2,3,4,5])).toThrow();
    expect(()=>dealPrivateHands("SUTDA2",[1,1])).toThrow();
  });
});
