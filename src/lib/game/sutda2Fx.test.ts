import { describe, expect, it } from "vitest";
import { planSutda2FxEvents, sutda2CoinCount, type Sutda2FxInput } from "./sutda2Fx";

const base: Sutda2FxInput = {
  roundId: "r1",
  status: "playing",
  rematch: false,
  pot: 10000,
  actions: [],
  seats: [],
};

describe("2장 섯다 FX 이벤트", () => {
  it("체크/다이는 코인 이동 이벤트를 만들지 않는다", () => {
    const events = planSutda2FxEvents(
      {
        ...base,
        actions: [
          { id: "a1", userId: "u1", type: "check" },
          { id: "a2", userId: "u2", type: "die" },
          { id: "a3", userId: "u1", type: "ante" },
        ],
      },
      new Set(),
    );
    expect(events).toEqual([]);
  });

  it("콜/따당/올인은 강도에 따라 코인 개수가 다르다", () => {
    expect(sutda2CoinCount("call")).toBe(3);
    expect(sutda2CoinCount("ping")).toBe(3);
    expect(sutda2CoinCount("ttadang")).toBe(5);
    expect(sutda2CoinCount("half")).toBe(5);
    expect(sutda2CoinCount("all_in")).toBe(7);
  });

  it("올인은 strong/allIn 플래그가 켜진다", () => {
    const [e] = planSutda2FxEvents(
      { ...base, actions: [{ id: "a1", userId: "u1", type: "all_in" }] },
      new Set(),
    );
    expect(e).toMatchObject({ kind: "BET", userId: "u1", strong: true, allIn: true, count: 7 });
  });

  it("같은 action id는 두 번 방출되지 않는다 (realtime 중복 0)", () => {
    const input = { ...base, actions: [{ id: "a1", userId: "u1", type: "call" }] };
    const first = planSutda2FxEvents(input, new Set());
    expect(first).toHaveLength(1);
    expect(planSutda2FxEvents(input, new Set(first.map((e) => e.key)))).toHaveLength(0);
  });

  it("정산 확정 시 서버 승자/획득 포인트만 사용한다", () => {
    const events = planSutda2FxEvents(
      {
        ...base,
        status: "finished",
        seats: [
          { userId: "u1", resultType: "WIN", initialPoints: 1000, finalPoints: 21000 },
          { userId: "u2", resultType: "LOSE", initialPoints: 5000, finalPoints: 1000 },
        ],
      },
      new Set(),
    );
    expect(events).toEqual([{ kind: "WIN", key: "win:r1:u1", userId: "u1", amount: 20000 }]);
  });

  it("재경기에서는 POT→승자 이동이 없고 이월 이벤트만 발생한다", () => {
    const events = planSutda2FxEvents(
      {
        ...base,
        status: "finished",
        rematch: true,
        seats: [{ userId: "u1", resultType: "WIN", initialPoints: 0, finalPoints: 100 }],
      },
      new Set(),
    );
    expect(events).toEqual([{ kind: "REMATCH", key: "rematch:r1", pot: 10000 }]);
  });

  it("라운드가 끝나지 않으면 결과 이벤트가 없다", () => {
    const events = planSutda2FxEvents(
      {
        ...base,
        seats: [{ userId: "u1", resultType: "WIN", initialPoints: 0, finalPoints: 100 }],
      },
      new Set(),
    );
    expect(events).toEqual([]);
  });
});
