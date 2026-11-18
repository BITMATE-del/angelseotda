import { describe, expect, it } from "vitest";
import {
  buildSutda2ResultView,
  formatSutda2Net,
  sutda2ResultLogLines,
} from "@/lib/game/sutda2Result";
import type { SutdaRoundResult } from "@/lib/services/serverGameService";

function base(over: Partial<SutdaRoundResult> = {}): SutdaRoundResult {
  return {
    ready: true,
    roundId: "r1",
    roundNumber: 3,
    mode: "sutda2",
    pot: 20000,
    settlementStatus: "SETTLED",
    rematch: false,
    rematchReason: null,
    carryPot: 0,
    showdown: true,
    foldWin: false,
    revealMode: "SHOWDOWN",
    revealChoice: null,
    canChooseReveal: false,
    pots: [],
    payouts: [{ userId: "a", nickname: "천사", amount: 20000 }],
    players: [
      {
        userId: "a",
        seat: 1,
        nickname: "천사",
        isMe: true,
        folded: false,
        resultType: "WIN",
        net: 10000,
        finalPoints: 2183081,
        totalBet: 10000,
        payout: 20000,
        revealed: true,
        cards: ["10-a", "10-b"],
        handLabel: "장땡",
        stillSeated: true,
      },
      {
        userId: "b",
        seat: 2,
        nickname: "wkwl",
        isMe: false,
        folded: false,
        resultType: "LOSE",
        net: -10000,
        finalPoints: 500000,
        totalBet: 10000,
        payout: 0,
        revealed: true,
        cards: ["05-a", "04-b"],
        handLabel: "갑오",
        stillSeated: true,
      },
    ],
    ...over,
  };
}

describe("sutda2 결과 표시 (서버 확정값 전용)", () => {
  it("정상 SHOWDOWN 은 생존자 패/족보/손익을 서버값으로 표시한다", () => {
    const v = buildSutda2ResultView(base(), "a")!;
    expect(v.headline).toBe("승 리");
    expect(v.myNet).toBe(10000);
    expect(v.myPayout).toBe(20000);
    expect(v.myFinalPoints).toBe(2183081);
    expect(v.payouts).toEqual([{ label: "POT", nickname: "천사", amount: 20000 }]);
    expect(v.rows[0]!.cards).toEqual(["10-a", "10-b"]);
    expect(v.rows[1]!.handLabel).toBe("갑오");
  });

  it("패자 시점에서는 패배 헤드라인과 자신의 손익을 표시한다", () => {
    const v = buildSutda2ResultView(base(), "b")!;
    expect(v.headline).toBe("패 배");
    expect(v.myNet).toBe(-10000);
  });

  it("서버가 공개하지 않은(다이) 플레이어는 패/족보를 만들지 않는다", () => {
    const v = buildSutda2ResultView(
      base({
        showdown: false,
        foldWin: true,
        revealMode: "HIDDEN",
        revealChoice: "HIDDEN",
        players: base().players.map((p) =>
          p.userId === "b"
            ? { ...p, folded: true, revealed: false, cards: [], handLabel: null }
            : { ...p, revealed: false, cards: [], handLabel: null },
        ),
      }),
      "a",
    )!;
    expect(v.foldWin).toBe(true);
    expect(v.rows.every((r) => r.cards.length === 0 && r.handLabel === null)).toBe(true);
    expect(v.winnerHand).toBeNull();
    expect(v.rows.find((r) => r.userId === "b")!.status).toBe("다이");
  });

  it("폴드승 승자에게만 공개 선택을 허용한다 (서버 판정)", () => {
    const pending = base({ foldWin: true, showdown: false, revealChoice: "PENDING", canChooseReveal: true });
    expect(buildSutda2ResultView(pending, "a")!.canChooseReveal).toBe(true);
    expect(buildSutda2ResultView({ ...pending, canChooseReveal: false }, "b")!.canChooseReveal).toBe(
      false,
    );
  });

  it("같은 승자에게 지급된 사이드팟 레이어는 서버 금액 합계 한 줄로 표시한다", () => {
    const v = buildSutda2ResultView(
      base({
        payouts: [
          { userId: "a", nickname: "천사", amount: 12000 },
          { userId: "a", nickname: "천사", amount: 4000 },
        ],
      }),
      "a",
    )!;
    expect(v.payouts).toEqual([{ label: "POT", nickname: "천사", amount: 16000 }]);
  });

  it("서로 다른 승자의 사이드팟은 MAIN/SIDE 로 각각 표시한다", () => {
    const v = buildSutda2ResultView(
      base({
        payouts: [
          { userId: "a", nickname: "천사", amount: 12000 },
          { userId: "b", nickname: "wkwl", amount: 4000 },
        ],
      }),
      "a",
    )!;
    expect(v.payouts.map((p) => p.label)).toEqual(["MAIN POT", "SIDE POT 1"]);
  });

  it("재경기는 승패 대신 이월 판돈을 표시한다", () => {
    const v = buildSutda2ResultView(
      base({ rematch: true, settlementStatus: "REMATCH", rematchReason: "GUSA", carryPot: 24000 }),
      "a",
    )!;
    expect(v.headline).toBe("재 경 기");
    expect(v.carryPot).toBe(24000);
    expect(v.rows.every((r) => r.status === "재경기")).toBe(true);
  });

  it("정산 전 결과는 표시하지 않는다", () => {
    expect(buildSutda2ResultView(null, "a")).toBeNull();
    expect(buildSutda2ResultView({ ...base(), ready: false }, "a")).toBeNull();
  });

  it("게임기록 상세는 공개/비공개 여부를 그대로 문장에 담는다", () => {
    const lines = sutda2ResultLogLines(buildSutda2ResultView(base(), "a")!);
    expect(lines.some((l) => l.text.includes("천사 승리 · 장땡 · 패 10-a 10-b"))).toBe(true);
    expect(lines.some((l) => l.text.includes("POT 20,000P"))).toBe(true);

    const hidden = sutda2ResultLogLines(
      buildSutda2ResultView(
        base({
          foldWin: true,
          showdown: false,
          players: base().players.map((p) =>
            p.userId === "b"
              ? { ...p, folded: true, revealed: false, cards: [], handLabel: null }
              : { ...p, revealed: false, cards: [], handLabel: null },
          ),
        }),
        "a",
      )!,
    );
    expect(hidden.some((l) => l.text.includes("상대 전원 다이 승리 · 패 비공개"))).toBe(true);
    expect(hidden.some((l) => l.text.includes("wkwl 다이 · 패 비공개"))).toBe(true);
  });

  it("손익 표기", () => {
    expect(formatSutda2Net(12500)).toBe("+12,500 P");
    expect(formatSutda2Net(-10000)).toBe("-10,000 P");
    expect(formatSutda2Net(0)).toBe("0 P");
  });
});
