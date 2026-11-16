import { describe, expect, it } from "vitest";
import { canPrepareRound, MAX_DORI_PLAYERS, MIN_PREPARE_PLAYERS } from "./rounds.server";

describe("Railway staging round preparation safety limits", () => {
  it("requires at least two seated participants", () => {
    expect(MIN_PREPARE_PLAYERS).toBe(2);
    for (const mode of ["SUTDA2", "SUTDA3", "DORI"]) {
      expect(canPrepareRound(0, mode)).toBe(false);
      expect(canPrepareRound(1, mode)).toBe(false);
      expect(canPrepareRound(2, mode)).toBe(true);
    }
  });

  it("enforces four Dori seats", () => {
    expect(MAX_DORI_PLAYERS).toBe(4);
    expect(canPrepareRound(4, "DORI")).toBe(true);
    expect(canPrepareRound(5, "DORI")).toBe(false);
  });

  it("does not accept fractional, negative, or over-capacity player counts", () => {
    expect(canPrepareRound(2.5, "SUTDA2")).toBe(false);
    expect(canPrepareRound(-1, "SUTDA3")).toBe(false);
    expect(canPrepareRound(11, "SUTDA2")).toBe(false);
    expect(canPrepareRound(10, "SUTDA3")).toBe(true);
  });
});
