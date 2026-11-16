import { describe, expect, it } from "vitest";
import {
  autoKickReason,
  buildPotLayers,
  potLayerInvariantOk,
  settleReference,
  settlementInvariantOk,
} from "./potInvariants";

/**
 * STABLE_1 게임코어 회귀 테스트.
 * TEST DRIVER 강제 시나리오에서 실제 서버가 통과한 규칙을 자동 회귀로 고정한다.
 */
describe("side pot layering", () => {
  it("숏스택 올인은 메인팟만, 딥스택은 사이드팟까지 자격을 가진다", () => {
    const c = [
      { userId: "a", amount: 100_000, folded: false },
      { userId: "b", amount: 250_000, folded: false },
      { userId: "c", amount: 250_000, folded: false },
    ];
    const { layers, potTotal } = buildPotLayers(c);
    expect(potTotal).toBe(600_000);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual({ amount: 300_000, eligible: ["a", "b", "c"] });
    expect(layers[1]).toEqual({ amount: 300_000, eligible: ["b", "c"] });
    expect(potLayerInvariantOk(c)).toBe(true);
  });

  it("3인 서로 다른 올인은 3층으로 분리된다", () => {
    const c = [
      { userId: "a", amount: 100_000, folded: false },
      { userId: "b", amount: 250_000, folded: false },
      { userId: "c", amount: 600_000, folded: false },
    ];
    const { layers, refunds } = buildPotLayers(c);
    // 최상단 미대결 초과분은 반환된다
    expect(refunds).toEqual({ c: 350_000 });
    expect(layers.map((l) => l.amount)).toEqual([300_000, 300_000]);
    expect(potLayerInvariantOk(c)).toBe(true);
  });

  it("폴드 플레이어 금액(dead money)은 팟에 남지만 수령 자격에서 제외된다", () => {
    const c = [
      { userId: "a", amount: 100_000, folded: false },
      { userId: "b", amount: 100_000, folded: false },
      { userId: "c", amount: 2_000, folded: true },
    ];
    const { layers, potTotal } = buildPotLayers(c);
    expect(potTotal).toBe(202_000);
    expect(layers[0]!.eligible).toEqual(["a", "b"]);
    expect(layers.flatMap((l) => l.eligible)).not.toContain("c");
    expect(layers.reduce((s, l) => s + l.amount, 0)).toBe(202_000);
  });
});

describe("settlement invariants", () => {
  it("정산 합계는 분배 대상 POT과 일치한다", () => {
    const input = {
      contributions: [
        { userId: "a", amount: 100_000, folded: false },
        { userId: "b", amount: 250_000, folded: false },
        { userId: "c", amount: 250_000, folded: false },
      ],
      ranking: { a: 90, b: 80, c: 70 },
    };
    const r = settleReference(input);
    expect(r.status).toBe("SETTLED");
    expect(r.payouts["a"]).toBe(300_000);
    expect(r.payouts["b"]).toBe(300_000);
    expect(settlementInvariantOk(input)).toBe(true);
  });

  it("폴드 dead money는 승자에게 지급된다", () => {
    const input = {
      contributions: [
        { userId: "a", amount: 100_000, folded: false },
        { userId: "b", amount: 100_000, folded: false },
        { userId: "c", amount: 2_000, folded: true },
      ],
      ranking: { a: 90, b: 10, c: 99 },
    };
    const r = settleReference(input);
    expect(r.payouts["a"]).toBe(202_000);
    expect(r.payouts["c"]).toBeUndefined();
    expect(settlementInvariantOk(input)).toBe(true);
  });

  it("동일 최고 족보는 REMATCH이며 POT을 분배하지 않고 이월한다", () => {
    const input = {
      contributions: [
        { userId: "a", amount: 100_500, folded: false },
        { userId: "b", amount: 100_500, folded: false },
      ],
      ranking: { a: 50, b: 50 },
    };
    const r = settleReference(input);
    expect(r.status).toBe("REMATCH");
    expect(Object.keys(r.payouts)).toHaveLength(0);
    expect(r.carryOut).toBe(201_000);
    expect(settlementInvariantOk(input)).toBe(true);
  });

  it("carry pot은 다음 판 정산에 포함된다", () => {
    const input = {
      contributions: [
        { userId: "a", amount: 5_000, folded: false },
        { userId: "b", amount: 5_000, folded: false },
      ],
      ranking: { a: 90, b: 10 },
      carryIn: 201_000,
    };
    const r = settleReference(input);
    expect(r.pot).toBe(211_000);
    expect(r.payouts["a"]).toBe(211_000);
    expect(settlementInvariantOk(input)).toBe(true);
  });
});

describe("auto kick", () => {
  it("0P는 ZERO_BALANCE, 최소입장 미달은 BELOW_ROOM_MINIMUM, 충족은 유지", () => {
    expect(autoKickReason(0, 300_000)).toBe("ZERO_BALANCE");
    expect(autoKickReason(299_999, 300_000)).toBe("BELOW_ROOM_MINIMUM");
    expect(autoKickReason(300_000, 300_000)).toBeNull();
  });
});
