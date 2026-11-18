import { describe, expect, it } from "vitest";
import { planDoriFxEvents, type DoriFxInput } from "../doriFxEvents";

const seats: DoriFxInput["seats"] = [
  { seat: 1, userId: "u1", resultType: null, contribution: 3000 },
  { seat: 2, userId: "u2", resultType: null, contribution: 1000 },
];

describe("planDoriFxEvents (도리 FX — visual only)", () => {
  it("베팅/콜/레이즈/올인만 코인 이동 이벤트를 만든다", () => {
    const events = planDoriFxEvents(
      {
        round: { roundId: "r1", phase: "BETTING_1", pot: 4000, settlementStatus: "PENDING" },
        seats,
        actions: [
          { id: "a1", userId: "u1", type: "BET" },
          { id: "a2", userId: "u2", type: "CHECK" },
          { id: "a3", userId: "u2", type: "CALL" },
          { id: "a4", userId: "u1", type: "FOLD" },
          { id: "a5", userId: "u1", type: "ALL_IN" },
        ],
      },
      new Set(),
    );
    expect(events.map((e) => e.key)).toEqual(["bet:a1", "bet:a3", "bet:a5"]);
    expect(events.find((e) => e.key === "bet:a5")).toMatchObject({ strong: true, seat: 1 });
  });

  it("같은 action id 는 두 번 재생되지 않는다 (realtime rerender 중복 0)", () => {
    const input: DoriFxInput = {
      round: { roundId: "r1", phase: "BETTING_1", pot: 4000, settlementStatus: "PENDING" },
      seats,
      actions: [{ id: "a1", userId: "u1", type: "BET" }],
    };
    const first = planDoriFxEvents(input, new Set());
    expect(first).toHaveLength(1);
    expect(planDoriFxEvents(input, new Set(["bet:a1"]))).toHaveLength(0);
  });

  it("정산 확정 시 서버 승자/서버 금액으로만 POT→승자 이벤트를 만든다", () => {
    const events = planDoriFxEvents(
      {
        round: { roundId: "r9", phase: "FINISHED", pot: 10_000, settlementStatus: "DONE" },
        seats: [
          { seat: 1, userId: "u1", resultType: "WIN", contribution: 4000 },
          { seat: 2, userId: "u2", resultType: "LOSE", contribution: 6000 },
        ],
        actions: [],
      },
      new Set(),
    );
    expect(events).toEqual([{ kind: "WIN", key: "win:r9:u1", seat: 1, amount: 6000 }]);
  });

  it("동점 재경기는 승자 이동 없이 판돈 이월 이벤트만 만든다", () => {
    const events = planDoriFxEvents(
      {
        round: { roundId: "r9", phase: "FINISHED", pot: 10_000, settlementStatus: "REMATCH" },
        seats: [
          { seat: 1, userId: "u1", resultType: "REMATCH", contribution: 5000 },
          { seat: 2, userId: "u2", resultType: "REMATCH", contribution: 5000 },
        ],
        actions: [],
      },
      new Set(),
    );
    expect(events).toEqual([{ kind: "REMATCH", key: "rematch:r9", pot: 10_000 }]);
    expect(events.some((e) => e.kind === "WIN")).toBe(false);
  });

  it("진행 중에는 결과 이벤트를 만들지 않는다", () => {
    const events = planDoriFxEvents(
      {
        round: { roundId: "r9", phase: "SHOWDOWN", pot: 10_000, settlementStatus: "PENDING" },
        seats: [{ seat: 1, userId: "u1", resultType: "WIN", contribution: 4000 }],
        actions: [],
      },
      new Set(),
    );
    expect(events).toHaveLength(0);
  });
});
