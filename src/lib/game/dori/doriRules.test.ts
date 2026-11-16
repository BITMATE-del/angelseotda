/**
 * 도리짓고땡 V1 규칙 회귀 테스트 (기존 섯다 테스트와 완전 분리).
 */
import { describe, expect, it } from "vitest";
import { SUTDA_CARDS } from "@/data/sutdaCards";
import {
  DORI_DECK,
  DORI_MAX_PLAYERS,
  buildDoriSidePots,
  compareDoriHands,
  dealDori,
  doriActionOrder,
  doriBestMake,
  doriMakeCombos,
  doriMonthOf,
  evaluateDoriPair,
  isDoriMakeTotal,
  isValidDoriSeat,
  nextDoriDealerSeat,
  resolveDoriBet,
  validateDoriMake,
} from "./doriRules";

/** 월 숫자 목록을 실제 카드 id 목록으로 변환 (같은 월은 서로 다른 카드 2장까지) */
function hand(months: number[]): string[] {
  const used = new Map<number, number>();
  return months.map((m) => {
    const list = SUTDA_CARDS.filter((c) => c.month === m);
    const i = used.get(m) ?? 0;
    used.set(m, i + 1);
    const card = list[i];
    if (!card) throw new Error(`no card for month ${m} #${i}`);
    return card.id;
  });
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("도리 덱", () => {
  it("1. 20장 고정", () => {
    expect(DORI_DECK).toHaveLength(20);
  });

  it("2. 1~10월 각 2장 (11·12월 없음)", () => {
    const counts = new Map<number, number>();
    for (const id of DORI_DECK) counts.set(doriMonthOf(id), (counts.get(doriMonthOf(id)) ?? 0) + 1);
    for (let m = 1; m <= 10; m++) expect(counts.get(m)).toBe(2);
    expect(counts.get(11)).toBeUndefined();
    expect(counts.get(12)).toBeUndefined();
  });

  it("3~7. 인원별 5장 지급 / 4인 20장 정확 / 중복 0", () => {
    for (const n of [2, 3, DORI_MAX_PLAYERS]) {
      const { hands, rest } = dealDori(n, seeded(n + 7));
      expect(hands).toHaveLength(n);
      for (const h of hands) expect(h).toHaveLength(5);
      const all = hands.flat();
      expect(new Set(all).size).toBe(n * 5);
      expect(rest).toHaveLength(20 - n * 5);
    }
    const four = dealDori(4, seeded(99));
    expect(four.rest).toHaveLength(0);
  });

  it("8~9. 5번째 입장 / seat 5 거부", () => {
    expect(isValidDoriSeat(5)).toBe(false);
    expect(isValidDoriSeat(0)).toBe(false);
    expect([1, 2, 3, 4].every(isValidDoriSeat)).toBe(true);
    expect(() => dealDori(5)).toThrow();
  });
});

describe("짓기", () => {
  it("10~12. 10 / 20 / 30 만 허용", () => {
    expect(isDoriMakeTotal(10)).toBe(true);
    expect(isDoriMakeTotal(20)).toBe(true);
    expect(isDoriMakeTotal(30)).toBe(true);
    for (const n of [0, 5, 9, 11, 15, 19, 40]) expect(isDoriMakeTotal(n)).toBe(false);
  });

  it("13. 황 — 어떤 3장으로도 불가", () => {
    const r = doriBestMake(hand([9, 10, 9, 4, 3]));
    expect(r.made).toBe(false);
    expect(r.hand.label).toBe("황");
  });

  it("14. 다중 짓기 — 1/3/6/7/7 은 두 조합 (13광땡, 7땡)", () => {
    const combos = doriMakeCombos(hand([1, 3, 6, 7, 7]));
    expect(combos).toHaveLength(2);
    // 남은 2장은 2장 섯다 evaluator로 판정한다 (1월광+3월광 = 13광땡)
    expect(combos[0]!.hand.label).toBe("13광땡");
    expect(combos[0]!.makeTotal).toBe(20);
    expect(combos[1]!.hand.label).toBe("7땡");
    expect(combos[1]!.makeTotal).toBe(10);
  });

  it("15~18. 6땡 / 장땡 / 갑오 / 세륙(4월+6월)", () => {
    expect(doriBestMake(hand([6, 7, 6, 2, 1])).hand.label).toBe("6땡");
    expect(doriBestMake(hand([10, 10, 1, 2, 7])).hand.label).toBe("장땡");
    expect(doriBestMake(hand([2, 10, 5, 8, 4])).hand.label).toBe("갑오");
    expect(doriBestMake(hand([5, 7, 8, 4, 6])).hand.label).toBe("세륙");
    expect(doriBestMake(hand([3, 7, 10, 2, 8])).hand.label).toBe("망통");
  });

  it("필수 예시 A/B/C/D — A(13광땡) 승리", () => {
    const a = doriBestMake(hand([5, 1, 3, 8, 7]));
    const b = doriBestMake(hand([9, 10, 9, 4, 3]));
    const c = doriBestMake(hand([6, 7, 6, 2, 1]));
    const d = doriBestMake(hand([2, 10, 5, 8, 4]));
    expect(a.hand.label).toBe("13광땡");
    expect(b.hand.label).toBe("황");
    expect(c.hand.label).toBe("6땡");
    expect(d.hand.label).toBe("갑오");
    const winner = [a, b, c, d].reduce((best, cur) =>
      compareDoriHands(cur.hand, best.hand) > 0 ? cur : best,
    );
    expect(winner.hand.label).toBe("13광땡");
  });

  it("19~20. 땡 > 끗 > 망통 > 황", () => {
    expect(compareDoriHands(evaluateDoriPair(1, 1), evaluateDoriPair(5, 4))).toBeGreaterThan(0);
    expect(compareDoriHands(evaluateDoriPair(5, 4), evaluateDoriPair(5, 5))).toBeLessThan(0);
    expect(compareDoriHands(evaluateDoriPair(4, 6), doriBestMake(hand([9, 10, 9, 4, 3])).hand)).toBeGreaterThan(0);
    expect(evaluateDoriPair(10, 10).label).toBe("장땡");
    expect(evaluateDoriPair(4, 6).label).toBe("세륙");
    expect(evaluateDoriPair(2, 8).label).toBe("망통");
  });

  it("10/20/30 사이 우열 없음 — 남은 2장 족보로만 판정", () => {
    const ten = doriMakeCombos(hand([1, 2, 7, 6, 6]))[0]!;
    const twenty = doriMakeCombos(hand([5, 7, 8, 6, 6]))[0]!;
    expect(ten.makeTotal).toBe(10);
    expect(twenty.makeTotal).toBe(20);
    expect(compareDoriHands(ten.hand, twenty.hand)).toBe(0);
  });

  it("21~23. 잘못된 3장 / 중복 카드 / 타인 카드 거부", () => {
    const my = hand([1, 2, 7, 6, 6]);
    expect(validateDoriMake(my, [my[0]!, my[1]!]).errorCode).toBe("DORI_MAKE_NOT_THREE_CARDS");
    expect(validateDoriMake(my, [my[0]!, my[0]!, my[1]!]).errorCode).toBe("DORI_MAKE_DUPLICATE_CARD");
    expect(validateDoriMake(my, [my[0]!, my[1]!, "10-a"]).errorCode).toBe("DORI_MAKE_CARD_NOT_OWNED");
    expect(validateDoriMake(my, [my[0]!, my[1]!, my[3]!]).errorCode).toBe("DORI_MAKE_INVALID_TOTAL");
    const ok = validateDoriMake(my, [my[0]!, my[1]!, my[2]!]);
    expect(ok.ok).toBe(true);
    expect(ok.makeTotal).toBe(10);
    expect(ok.hand!.label).toBe("6땡");
    expect(ok.remaining).toHaveLength(2);
  });
});

describe("베팅 (RULE PATCH 2 — 섯다 동일 체계 · 횟수 제한 없음)", () => {
  const base = { pot: 4000, currentBet: 0, myBet: 0, baseBet: 1000, balance: 1_000_000 };

  it("24. 체크 — 아무도 베팅하지 않았을 때만", () => {
    expect(resolveDoriBet("check", base).ok).toBe(true);
    expect(resolveDoriBet("check", { ...base, currentBet: 1000 }).errorCode).toBe(
      "DORI_CHECK_NOT_ALLOWED",
    );
  });

  it("25. 삥 — 콜금액 + 기본 베팅", () => {
    const r = resolveDoriBet("ping", { ...base, currentBet: 3000 });
    expect(r.ok).toBe(true);
    expect(r.additionalAmount).toBe(4000);
  });

  it("26. 콜 — 추가 차감액만 계산", () => {
    const r = resolveDoriBet("call", { ...base, currentBet: 5000, myBet: 2000 });
    expect(r.additionalAmount).toBe(3000);
    expect(resolveDoriBet("call", base).errorCode).toBe("DORI_NOTHING_TO_CALL");
  });

  it("27. 따당 / 하프 / 쿼터 — 서버 공식과 동일", () => {
    const ctx = { ...base, pot: 40_000, currentBet: 5000, myBet: 1000 };
    expect(resolveDoriBet("ttadang", ctx).additionalAmount).toBe(9000);
    expect(resolveDoriBet("half", ctx).additionalAmount).toBe(24_000);
    expect(resolveDoriBet("quarter", ctx).additionalAmount).toBe(14_000);
  });

  it("28~31. 베팅 횟수 제한 없음 — 같은 액션을 반복해도 계속 허용", () => {
    let currentBet = 1000;
    for (let i = 0; i < 8; i++) {
      const r = resolveDoriBet("ttadang", { ...base, currentBet, myBet: 0 });
      expect(r.ok, `ttadang #${i + 1}`).toBe(true);
      currentBet = Math.max(currentBet, r.additionalAmount!);
    }
  });

  it("32. 다이 — 추가 차감 0", () => {
    const r = resolveDoriBet("die", { ...base, currentBet: 5000 });
    expect(r.ok).toBe(true);
    expect(r.additionalAmount).toBe(0);
  });

  it("33. 부족콜 — 보유 전액까지만 차감된다", () => {
    const r = resolveDoriBet("call", { ...base, currentBet: 100_000, balance: 40_000 });
    expect(r.ok).toBe(true);
    expect(r.allIn).toBe(true);
    expect(r.additionalAmount).toBe(40_000);
  });

  it("28. 베팅 불변식 — 추가금액 = POT 증가량", () => {
    let pot = 4000;
    let balance = 50_000;
    let currentBet = 0;
    let myBet = 0;
    for (const action of ["ping", "ttadang"] as const) {
      const r = resolveDoriBet(action, { pot, currentBet, myBet, baseBet: 1000, balance });
      expect(r.ok).toBe(true);
      balance -= r.additionalAmount!;
      pot += r.additionalAmount!;
      myBet += r.additionalAmount!;
      currentBet = myBet;
    }
    expect(pot - 4000).toBe(myBet);
    expect(balance).toBe(50_000 - myBet);
  });
});

describe("SIDE POT", () => {
  it("34. 투입 한도까지만 수령 자격", () => {
    const layers = buildDoriSidePots([
      { userId: "a", contribution: 40_000, folded: false },
      { userId: "b", contribution: 100_000, folded: false },
      { userId: "c", contribution: 100_000, folded: false },
    ]);
    expect(layers).toHaveLength(2);
    expect(layers[0]!.amount).toBe(120_000);
    expect(layers[0]!.eligible).toEqual(["a", "b", "c"]);
    expect(layers[1]!.amount).toBe(120_000);
    expect(layers[1]!.eligible).toEqual(["b", "c"]);
    const total = layers.reduce((s, l) => s + l.amount, 0);
    expect(total).toBe(240_000);
  });

  it("다이한 플레이어 투입금은 POT에 남지만 수령 자격 없음", () => {
    const layers = buildDoriSidePots([
      { userId: "a", contribution: 10_000, folded: true },
      { userId: "b", contribution: 30_000, folded: false },
      { userId: "c", contribution: 30_000, folded: false },
    ]);
    expect(layers.reduce((s, l) => s + l.amount, 0)).toBe(70_000);
    expect(layers[0]!.eligible).toEqual(["b", "c"]);
  });
});

describe("선(先) / 좌석", () => {
  it("35. 선 1→2→3→4→1", () => {
    const seats = [1, 2, 3, 4];
    expect(nextDoriDealerSeat(seats, null)).toBe(1);
    expect(nextDoriDealerSeat(seats, 1)).toBe(2);
    expect(nextDoriDealerSeat(seats, 2)).toBe(3);
    expect(nextDoriDealerSeat(seats, 3)).toBe(4);
    expect(nextDoriDealerSeat(seats, 4)).toBe(1);
  });

  it("36. 빈좌석 skip", () => {
    expect(nextDoriDealerSeat([1, 3], 1)).toBe(3);
    expect(nextDoriDealerSeat([1, 3], 3)).toBe(1);
    expect(nextDoriDealerSeat([2, 4], null)).toBe(2);
    expect(nextDoriDealerSeat([], null)).toBeNull();
  });

  it("33/38. 선부터 액션 순서 (선 seat2 → 2,3,4,1)", () => {
    expect(doriActionOrder([1, 2, 3, 4], 2)).toEqual([2, 3, 4, 1]);
    expect(doriActionOrder([1, 3, 4], 2)).toEqual([3, 4, 1]);
  });
});
