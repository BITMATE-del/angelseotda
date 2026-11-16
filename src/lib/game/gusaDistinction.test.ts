/**
 * 구사 / 멍텅구리구사 전수 구분 회귀 테스트.
 * 서버(evaluate_sutda_hand / get_round_state / sutda_round_result)와 동일한 hand_code 체계를
 * 클라이언트 표시 경로(결과창·게임기록·현재 최고패)에서 잃어버리지 않는지 검증한다.
 */
import { describe, expect, it } from "vitest";
import { evaluateSutda2 } from "./sutda2Rules";
import { evaluateSutda3 } from "./sutda3Rules";
import { rematchReasonLabel } from "./gusaRematch";
import { buildSutda2ResultView, sutda2ResultLogLines } from "./sutda2Result";
import type { SutdaRoundResult } from "@/lib/services/serverGameService";
import { sutda2CurrentHandLabel, sutda3CurrentHandLabel } from "./currentHandLabel";

const GUSA = ["04-b", "09-b"] as const;
const MUNG = ["04-a", "09-a"] as const;

describe("구사 / 멍텅구리구사 — 카드 identity 기준 판정", () => {
  it("2장: 지정 조합만 멍텅구리구사", () => {
    expect(evaluateSutda2([...MUNG]).code).toBe("gusa_meongteong");
    expect(evaluateSutda2([...GUSA]).code).toBe("gusa");
    expect(evaluateSutda2(["04-a", "09-b"]).code).toBe("gusa");
    expect(evaluateSutda2(["04-b", "09-a"]).code).toBe("gusa");
  });

  it("2장: 비슷한 카드는 특수족보가 아니다", () => {
    expect(evaluateSutda2(["04-a", "08-normal"]).category).toBe("kkeut");
    expect(evaluateSutda2(["09-a", "09-b"]).code).toBe("ttaeng9");
    expect(evaluateSutda2(["04-a", "06-a"]).code).toBe("seryuk");
  });

  it("3장: 선택하지 않은 세 번째 카드는 판정에 쓰이지 않는다", () => {
    // 3장 중 최종 2장만 evaluator 에 전달 (FINAL_HAND_SUBMIT 기준)
    expect(evaluateSutda2([MUNG[0], MUNG[1]]).code).toBe("gusa_meongteong");
    expect(evaluateSutda2([GUSA[0], GUSA[1]]).code).toBe("gusa");
    // 09-a 를 제외한 2장을 제출하면 멍텅구리구사가 아니다
    expect(evaluateSutda2(["04-a", "10-a"]).code).toBe("jangsa");
    // 3장 자동 최선 조합도 반드시 실제 2장 조합의 판정 결과와 동일하다 (임의 판정 금지)
    const three = ["04-a", "09-a", "10-a"] as const;
    const pairs = [
      evaluateSutda2([three[0], three[1]]).code,
      evaluateSutda2([three[0], three[2]]).code,
      evaluateSutda2([three[1], three[2]]).code,
    ];
    expect(pairs).toContain(evaluateSutda3([...three]).code);
  });

  it("현재 최고패 라벨이 서로 다르다", () => {
    expect(sutda2CurrentHandLabel([...MUNG])).toBe("멍텅구리구사");
    expect(sutda2CurrentHandLabel([...GUSA])).toBe("구사");
    // 첫 장만 있는 단계에서는 확정하지 않는다
    expect(sutda2CurrentHandLabel(["04-a"])).toBe("판정 대기");
    expect(sutda3CurrentHandLabel(["04-a", "09-a", "10-a"], ["04-a"], true)).toBe(
      "1장 더 선택하세요",
    );
    expect(sutda3CurrentHandLabel(["04-a", "09-a", "10-a"], [...MUNG], true)).toBe("멍텅구리구사");
    expect(sutda3CurrentHandLabel(["04-b", "09-b", "10-a"], [...GUSA], true)).toBe("구사");
  });

  it("재경기 사유 라벨이 서로 다르다", () => {
    expect(rematchReasonLabel("GUSA")).toBe("구사");
    expect(rematchReasonLabel("GUSA_MEONGTEONG")).toBe("멍텅구리구사");
  });
});

const rematchResult = (reason: string) =>
  ({
  ready: true,
  roundId: "r1",
  roundNumber: 3,
  mode: "sutda2",
  pot: 4000,
  settlementStatus: "REMATCH",
  rematch: true,
  rematchReason: reason,
  carryPot: 4000,
  showdown: true,
  foldWin: false,
  revealMode: "SHOWDOWN",
  revealChoice: null,
  canChooseReveal: false,
  pots: [],
  payouts: [],
  players: [
    {
      userId: "u1",
      seat: 1,
      nickname: "test04",
      isMe: true,
      folded: false,
      resultType: "REMATCH",
      net: 0,
      finalPoints: 1000,
      totalBet: 2000,
      payout: 0,
      revealed: true,
      cards: ["04-a", "09-a"],
      handLabel: reason === "GUSA_MEONGTEONG" ? "멍텅구리구사" : "구사",
      stillSeated: true,
    },
  ],
  }) as unknown as SutdaRoundResult;

describe("결과창 / 게임기록 — 서버 hand_code 를 그대로 표시", () => {
  it("멍텅구리구사 재경기는 멍텅구리구사로 기록된다", () => {
    const view = buildSutda2ResultView(rematchResult("GUSA_MEONGTEONG"), "u1")!;
    expect(view.rematchReason).toBe("GUSA_MEONGTEONG");
    expect(sutda2ResultLogLines(view)[0]!.text).toContain("멍텅구리구사 발생");
  });

  it("일반 구사 재경기는 구사로 기록된다", () => {
    const view = buildSutda2ResultView(rematchResult("GUSA"), "u1")!;
    expect(view.rematchReason).toBe("GUSA");
    const text = sutda2ResultLogLines(view)[0]!.text;
    expect(text).toContain("구사 발생");
    expect(text).not.toContain("멍텅구리");
  });
});
