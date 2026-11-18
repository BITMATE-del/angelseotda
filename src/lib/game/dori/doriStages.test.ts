import { describe, expect, it } from "vitest";
import {
  DORI_BETTING_PHASES,
  doriVisibleCardCount,
  isDoriBettingPhase,
  type DoriPhase,
} from "@/lib/services/doriService";
import { DORI_GRADES, doriGrade, doriGradeName } from "@/lib/game/dori/doriRooms";

describe("도리 단계별 카드 지급 (3 → 4 → 5)", () => {
  it("1차 베팅에서는 3장만 보인다", () => {
    expect(doriVisibleCardCount("BETTING_1")).toBe(3);
  });
  it("2차 베팅에서는 4장이 보인다", () => {
    expect(doriVisibleCardCount("BETTING_2")).toBe(4);
  });
  it("짓기 이후에는 5장 전부 보인다", () => {
    for (const phase of ["MAKE_SELECTION", "BETTING_FINAL", "SHOWDOWN", "FINISHED"] as DoriPhase[]) {
      expect(doriVisibleCardCount(phase)).toBe(5);
    }
  });
  it("배분 전에는 아무 카드도 보이지 않는다", () => {
    expect(doriVisibleCardCount("DEALING")).toBe(0);
    expect(doriVisibleCardCount(null)).toBe(0);
  });
  it("베팅 단계는 정확히 3개(3장·4장·최종)이다", () => {
    expect(DORI_BETTING_PHASES).toEqual(["BETTING_1", "BETTING_2", "BETTING_FINAL"]);
    expect(isDoriBettingPhase("BETTING_2")).toBe(true);
    expect(isDoriBettingPhase("MAKE_SELECTION")).toBe(false);
    expect(isDoriBettingPhase("DEALING")).toBe(false);
    expect(isDoriBettingPhase(null)).toBe(false);
  });
});

describe("도리 방 등급", () => {
  it("초보/일반/고수 3등급만 존재한다", () => {
    expect(DORI_GRADES.map((g) => g.id)).toEqual(["beginner", "normal", "expert"]);
  });
  it("등급별 최소 입장 포인트와 기본 베팅이 고정되어 있다", () => {
    expect(doriGrade("beginner")).toMatchObject({ minPoints: 100_000, ante: 1_000 });
    expect(doriGrade("normal")).toMatchObject({ minPoints: 300_000, ante: 2_000 });
    expect(doriGrade("expert")).toMatchObject({ minPoints: 800_000, ante: 3_500 });
  });
  it("알 수 없는 등급은 null 이고 표시명은 기본값이다", () => {
    expect(doriGrade("vip")).toBeNull();
    expect(doriGradeName("vip")).toBe("일반방");
    expect(doriGradeName("expert")).toBe("고수방");
  });
});
