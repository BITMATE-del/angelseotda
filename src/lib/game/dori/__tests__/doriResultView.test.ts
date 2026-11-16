import { describe, expect, it } from "vitest";
import { buildDoriResultView, formatDoriNet } from "../doriResultView";
import type { DoriResultPlayer, DoriRoundResult } from "@/lib/services/doriService";

function p(o: Partial<DoriResultPlayer>): DoriResultPlayer {
  return {
    userId: "u1",
    nickname: "천사",
    seat: 1,
    resultType: "LOSE",
    folded: false,
    handLabel: null,
    contribution: 4000,
    payout: 0,
    net: -4000,
    finalPoints: 96_000,
    stillSeated: true,
    ...o,
  };
}

const base: DoriRoundResult = {
  ready: true,
  roundId: "r1",
  settlementStatus: "DONE",
  pot: 20_000,
  showdown: true,
  players: [],
  payouts: [],
};

describe("buildDoriResultView (도리 결과 표시 — 서버 결과만 사용)", () => {
  it("WIN — 승리/획득 포인트/족보를 서버값으로 표시한다", () => {
    const v = buildDoriResultView(
      {
        ...base,
        players: [
          p({ userId: "me", resultType: "WIN", handLabel: "6땡", contribution: 4000, payout: 20_000, net: 16_000 }),
          p({ userId: "u2", nickname: "wkwl", seat: 2, handLabel: "갑오" }),
        ],
        payouts: [{ ordinal: 1, userId: "me", nickname: "천사", amount: 20_000 }],
      },
      "me",
    )!;
    expect(v.headline).toBe("승 리");
    expect(v.myNet).toBe(16_000);
    expect(v.winnerHand).toBe("6땡");
    expect(v.payouts).toEqual([{ label: "POT", nickname: "천사", amount: 20_000 }]);
    expect(v.rematch).toBe(false);
  });

  it("LOSE — 패배와 내 실제 손익, 승자 정보를 표시한다", () => {
    const v = buildDoriResultView(
      {
        ...base,
        players: [
          p({ userId: "w", nickname: "천사", resultType: "WIN", handLabel: "6땡", payout: 20_000, net: 16_000 }),
          p({ userId: "me", nickname: "나", seat: 2, net: -4000 }),
        ],
        payouts: [{ ordinal: 1, userId: "w", nickname: "천사", amount: 20_000 }],
      },
      "me",
    )!;
    expect(v.headline).toBe("패 배");
    expect(v.myNet).toBe(-4000);
    expect(formatDoriNet(v.myNet!)).toBe("-4,000 P");
    expect(v.payouts[0]!.nickname).toBe("천사");
  });

  it("전원 다이 승리 — 족보를 공개하지 않는다", () => {
    const v = buildDoriResultView(
      {
        ...base,
        showdown: false,
        players: [
          p({ userId: "me", resultType: "WIN", handLabel: null, payout: 12_000, net: 8000 }),
          p({ userId: "u2", nickname: "wkwl", seat: 2, folded: true, resultType: "FOLD" }),
        ],
        payouts: [{ ordinal: 1, userId: "me", nickname: "천사", amount: 12_000 }],
      },
      "me",
    )!;
    expect(v.winnerHand).toBeNull();
    expect(v.foldWin).toBe(true);
    expect(v.rows.find((r) => r.seat === 2)!.status).toBe("다이");
  });

  it("황은 쇼다운 결과에서만 표시된다 (서버가 준 값만 사용)", () => {
    const v = buildDoriResultView(
      {
        ...base,
        players: [
          p({ userId: "w", resultType: "WIN", handLabel: "장땡", payout: 20_000, net: 16_000 }),
          p({ userId: "me", nickname: "나", seat: 2, handLabel: "황", net: -4000 }),
        ],
      },
      "me",
    )!;
    expect(v.rows.find((r) => r.isMe)!.handLabel).toBe("황");
  });

  it("REMATCH — 무승부/이월만 표시하고 승자를 만들지 않는다", () => {
    const v = buildDoriResultView(
      {
        ...base,
        settlementStatus: "REMATCH",
        players: [
          p({ userId: "me", resultType: "REMATCH", handLabel: "갑오", net: -10_000 }),
          p({ userId: "u2", nickname: "wkwl", seat: 2, resultType: "REMATCH", handLabel: "갑오", net: -10_000 }),
        ],
        payouts: [],
      },
      "me",
    )!;
    expect(v.headline).toBe("무 승 부");
    expect(v.rematch).toBe(true);
    expect(v.carryPot).toBe(20_000);
    expect(v.payouts).toHaveLength(0);
    expect(v.rows.every((r) => r.status === "재경기")).toBe(true);
  });

  it("복수 payout(사이드팟) — MAIN/SIDE 를 모두 표시한다", () => {
    const v = buildDoriResultView(
      {
        ...base,
        players: [
          p({ userId: "me", resultType: "WIN", handLabel: "6땡", payout: 10_000, net: 6000 }),
          p({ userId: "u2", nickname: "wkwl", seat: 2, resultType: "WIN", handLabel: "갑오", payout: 4000, net: 1000 }),
        ],
        payouts: [
          { ordinal: 1, userId: "me", nickname: "천사", amount: 10_000 },
          { ordinal: 2, userId: "u2", nickname: "wkwl", amount: 4000 },
        ],
      },
      "me",
    )!;
    expect(v.payouts.map((x) => x.label)).toEqual(["MAIN POT", "SIDE POT 1"]);
    expect(v.payouts[1]).toMatchObject({ nickname: "wkwl", amount: 4000 });
  });

  it("ZERO_BALANCE — 0P 정산 시 퇴장 안내를 표시한다", () => {
    const v = buildDoriResultView(
      {
        ...base,
        players: [
          p({ userId: "w", resultType: "WIN", payout: 20_000, net: 16_000, handLabel: "6땡" }),
          p({ userId: "me", nickname: "나", seat: 2, net: -4000, finalPoints: 0, stillSeated: false }),
        ],
      },
      "me",
    )!;
    expect(v.zeroBalance).toBe(true);
  });

  it("정산 전/미참가 상태에서는 결과를 만들지 않는다 (중복·유령 표시 방지)", () => {
    expect(buildDoriResultView({ ready: false }, "me")).toBeNull();
    const v = buildDoriResultView(
      { ...base, players: [p({ userId: "u2", resultType: "WIN", payout: 20_000, net: 16_000 })] },
      "me",
    )!;
    expect(v.myNet).toBeNull();
    expect(v.zeroBalance).toBe(false);
  });
});

describe("payout 표시 합치기", () => {
  it("한 사람이 여러 레이어로 받은 경우 한 줄(POT)로 합치고 금액은 서버 합계", () => {
    const v = buildDoriResultView(
      {
        ready: true,
        settlementStatus: "DONE",
        pot: 3000,
        showdown: false,
        players: [p({ userId: "me", resultType: "WIN", payout: 3000, net: 2000 })],
        payouts: [
          { ordinal: 1, userId: "me", nickname: "천사", amount: 2000 },
          { ordinal: 2, userId: "me", nickname: "천사", amount: 1000 },
        ],
      },
      "me",
    )!;
    expect(v.payouts).toEqual([{ label: "POT", nickname: "천사", amount: 3000 }]);
  });
});
