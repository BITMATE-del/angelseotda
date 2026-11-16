/**
 * 도리짓고땡 2단계(실제 대국) 회귀 테스트.
 * 기존 섯다 테스트/코드와 완전히 분리되어 있으며, 서버 규칙(dori_* RPC)과 동일한
 * 순수 규칙 계산 + 클라이언트 버튼 표시 규칙을 검증한다.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SUTDA_CARDS } from "@/data/sutdaCards";
import {
  DORI_DECK,
  DORI_MAX_PLAYERS,
  buildDoriSidePots,
  compareDoriHands,
  dealDori,
  doriBestMake,
  doriMakeCombos,
  doriMonthOf,
  isValidDoriSeat,
  nextDoriDealerSeat,
  resolveDoriBet,
  validateDoriMake,
} from "./doriRules";
import { doriActionOptions, type DoriRoomState, type DoriSeatState } from "@/lib/services/doriService";

function hand(months: number[]): string[] {
  const used = new Map<number, number>();
  return months.map((m) => {
    const list = SUTDA_CARDS.filter((c) => c.month === m);
    const i = used.get(m) ?? 0;
    used.set(m, i + 1);
    return list[i]!.id;
  });
}

function seat(over: Partial<DoriSeatState> & { seat: number; userId: string }): DoriSeatState {
  return {
    nickname: "P" + over.seat,
    rank: null,
    level: 1,
    avatarUrl: null,
    points: 100_000,
    isMe: false,
    isReady: true,
    leavePending: false,
    connection: "CONNECTED",
    inRound: true,
    folded: false,
    isAllIn: false,
    acted: false,
    roundBet: 0,
    contribution: 1000,
    makeStatus: "PENDING",
    resultType: null,
    cardCount: 5,
    handLabel: null,
    handRank: null,
    makeTotal: null,
    selectedCards: null,
    remainingCards: null,
    ...over,
  };
}

function state(over: {
  phase?: DoriRoomState["round"] extends null ? never : string;
  currentBet?: number;
  raiseCount?: number;
  myBet?: number;
  myPoints?: number;
}): DoriRoomState {
  return {
    room: {
      id: "room",
      roomNumber: 200001,
      title: "도리",
      ante: 1000,
      minPoints: 0,
      status: "PLAYING",
      maxPlayers: 4,
      isPrivate: false,
      carryPot: 0,
      readyRequired: false,
      lastDealerSeat: 1,
    },
    round: {
      roundId: "r1",
      roundNumber: 1,
      status: "PLAYING",
      phase: (over.phase as never) ?? "BETTING_1",
      dealerSeat: 1,
      pot: 4000,
      currentBet: over.currentBet ?? 0,
      raiseCount: over.raiseCount ?? 0,
      ante: 1000,
      turnUserId: "me",
      turnDeadline: null,
      winnerId: null,
      settlementStatus: "PENDING",
    },
    seats: [
      seat({ seat: 1, userId: "me", isMe: true, roundBet: over.myBet ?? 0, points: over.myPoints ?? 100_000 }),
      seat({ seat: 2, userId: "b" }),
    ],
    myCards: hand([1, 2, 7, 6, 6]),
    makeOptions: [],
    actions: [],
  };
}

function pick(s: DoriRoomState, action: string) {
  return doriActionOptions(s, "me").find((o) => o.action === action)!;
}

describe("도리 방 / 좌석", () => {
  it("좌석은 1~4번만 존재하고 5번은 거부된다", () => {
    expect([1, 2, 3, 4].every(isValidDoriSeat)).toBe(true);
    expect(isValidDoriSeat(5)).toBe(false);
    expect(isValidDoriSeat(0)).toBe(false);
    expect(DORI_MAX_PLAYERS).toBe(4);
  });

  it("4인 착석 시 20장 덱이 정확히 소진되고 중복이 없다", () => {
    const { hands, rest } = dealDori(4);
    expect(hands.flat()).toHaveLength(20);
    expect(new Set(hands.flat()).size).toBe(20);
    expect(rest).toHaveLength(0);
    expect(DORI_DECK).toHaveLength(20);
  });

  it("선(先)은 1→2→3→4→1 순환하고 빈 좌석은 건너뛴다", () => {
    expect(nextDoriDealerSeat([1, 2, 3, 4], null)).toBe(1);
    expect(nextDoriDealerSeat([1, 2, 3, 4], 4)).toBe(1);
    expect(nextDoriDealerSeat([2, 4], 2)).toBe(4);
    expect(nextDoriDealerSeat([2], 2)).toBe(2);
  });

  it("4→3→2→1 인원 감소 시 남은 좌석만 대상이 된다", () => {
    expect(nextDoriDealerSeat([1, 2, 3], 3)).toBe(1);
    expect(nextDoriDealerSeat([1, 2], 1)).toBe(2);
    expect(nextDoriDealerSeat([2], 1)).toBe(2);
    expect(nextDoriDealerSeat([], 1)).toBeNull();
  });
});

describe("도리 베팅 버튼 표시 규칙 (섯다 동일 체계)", () => {
  it("아무도 베팅하지 않았으면 체크 가능, 콜 불가", () => {
    const s = state({});
    expect(pick(s, "check").enabled).toBe(true);
    expect(pick(s, "ping").enabled).toBe(true);
    expect(pick(s, "ping").amount).toBe(1000);
    expect(pick(s, "call").enabled).toBe(false);
  });

  it("베팅이 열린 뒤에는 체크 불가, 콜 금액은 추가 차감액만 표시", () => {
    const s = state({ currentBet: 5000, myBet: 2000 });
    expect(pick(s, "check").enabled).toBe(false);
    expect(pick(s, "call").enabled).toBe(true);
    expect(pick(s, "call").amount).toBe(3000);
  });

  it("베팅 횟수 제한이 없다 — 삥/따당/하프/쿼터는 잔액만 충분하면 항상 가능", () => {
    for (const bet of [1000, 5000, 20_000, 50_000]) {
      const s = state({ currentBet: bet });
      for (const a of ["ping", "ttadang", "half", "quarter"] as const) {
        expect(pick(s, a).enabled, `${a}@${bet}`).toBe(true);
      }
    }
  });

  it("보유 포인트가 있으면 올인은 항상 가능하다", () => {
    expect(pick(state({ currentBet: 100_000, myPoints: 40_000 }), "all_in").amount).toBe(40_000);
    expect(pick(state({ currentBet: 100_000, myPoints: 40_000 }), "all_in").enabled).toBe(true);
  });

  it("다이는 언제나 가능하고 추가 차감이 없다", () => {
    const f = pick(state({ currentBet: 5000 }), "die");
    expect(f.enabled).toBe(true);
    expect(f.amount).toBe(0);
  });

  it("짓기/쇼다운 단계에서는 베팅 버튼이 표시되지 않는다", () => {
    expect(doriActionOptions(state({ phase: "MAKE_SELECTION" as never }), "me")).toHaveLength(0);
    expect(doriActionOptions(state({ phase: "SHOWDOWN" as never }), "me")).toHaveLength(0);
  });

  it("서버 규칙과 동일한 추가 차감액을 계산한다 (POT 증가량 불변식)", () => {
    const r = resolveDoriBet("call", {
      pot: 10_000,
      currentBet: 7000,
      myBet: 1000,
      baseBet: 1000,
      balance: 50_000,
    });
    expect(r.additionalAmount).toBe(6000);
  });

  it("서버가 내려준 actionOptions를 그대로 표시한다", () => {
    const s = state({ currentBet: 5000 });
    s.actionOptions = [{ action: "call", amount: 12_345, enabled: true }];
    expect(pick(s, "call").amount).toBe(12_345);
    expect(pick(s, "half").enabled).toBe(false);
  });
});

describe("도리 짓기 제출 검증", () => {
  const my = hand([1, 2, 7, 6, 6]);

  it("정상 제출: 합 10 · 남은 2장 6땡", () => {
    const r = validateDoriMake(my, [my[0]!, my[1]!, my[2]!]);
    expect(r.ok).toBe(true);
    expect(r.makeTotal).toBe(10);
    expect(r.hand!.label).toBe("6땡");
    expect(r.remaining).toHaveLength(2);
  });

  it("3장이 아니면 거부", () => {
    expect(validateDoriMake(my, [my[0]!, my[1]!]).errorCode).toBe("DORI_MAKE_NOT_THREE_CARDS");
  });

  it("중복 카드 거부", () => {
    expect(validateDoriMake(my, [my[0]!, my[0]!, my[1]!]).errorCode).toBe("DORI_MAKE_DUPLICATE_CARD");
  });

  it("타인 카드 거부", () => {
    expect(validateDoriMake(my, [my[0]!, my[1]!, "10-a"]).errorCode).toBe("DORI_MAKE_CARD_NOT_OWNED");
  });

  it("합이 10·20·30이 아니면 거부 (%10 판정 아님)", () => {
    expect(validateDoriMake(my, [my[0]!, my[1]!, my[3]!]).errorCode).toBe("DORI_MAKE_INVALID_TOTAL");
    expect(validateDoriMake(hand([1, 2, 3, 4, 5]), hand([1, 2, 3, 4, 5]).slice(0, 3)).ok).toBe(false);
  });

  it("다중 짓기: 사용자가 7땡 또는 13광땡을 직접 선택할 수 있다", () => {
    const multi = hand([1, 3, 6, 7, 7]);
    const combos = doriMakeCombos(multi);
    expect(combos).toHaveLength(2);
    const labels = combos.map((c) => c.hand.label);
    expect(labels).toContain("7땡");
    expect(labels).toContain("13광땡");
    const chosen = combos.find((c) => c.hand.label === "7땡")!;
    const submitted = validateDoriMake(multi, chosen.selected);
    expect(submitted.ok).toBe(true);
    expect(submitted.hand!.label).toBe("7땡");
  });

  it("황: 어떤 3장으로도 10·20·30을 만들 수 없다", () => {
    const r = doriBestMake(hand([9, 10, 9, 4, 3]));
    expect(r.made).toBe(false);
    expect(r.hand.label).toBe("황");
    expect(doriMakeCombos(hand([9, 10, 9, 4, 3]))).toHaveLength(0);
  });
});

describe("도리 쇼다운 / 정산", () => {
  it("땡 > 끗 > 망통 > 황 순위", () => {
    const ddaeng = doriBestMake(hand([6, 7, 6, 2, 1])).hand;
    const gapo = doriBestMake(hand([2, 10, 5, 8, 4])).hand;
    const mangtong = doriBestMake(hand([3, 7, 10, 2, 8])).hand;
    const hwang = doriBestMake(hand([9, 10, 9, 4, 3])).hand;
    expect(ddaeng.label).toBe("6땡");
    expect(gapo.label).toBe("갑오");
    expect(mangtong.label).toBe("망통");
    expect(compareDoriHands(ddaeng, gapo)).toBeGreaterThan(0);
    expect(compareDoriHands(gapo, mangtong)).toBeGreaterThan(0);
    expect(compareDoriHands(mangtong, hwang)).toBeGreaterThan(0);
  });

  it("동일 족보는 동점(재경기 대상)으로 판정된다", () => {
    const a = doriBestMake(hand([1, 2, 7, 6, 6])).hand;
    const b = doriBestMake(hand([3, 4, 3, 6, 6])).hand;
    expect(a.label).toBe("6땡");
    expect(b.label).toBe("6땡");
    expect(compareDoriHands(a, b)).toBe(0);
  });

  it("사이드팟: 투입 한도까지만 수령 자격, 총액 보존", () => {
    const layers = buildDoriSidePots([
      { userId: "a", contribution: 40_000, folded: false },
      { userId: "b", contribution: 100_000, folded: false },
      { userId: "c", contribution: 100_000, folded: false },
    ]);
    expect(layers).toHaveLength(2);
    expect(layers[0]!.eligible).toEqual(["a", "b", "c"]);
    expect(layers[1]!.eligible).toEqual(["b", "c"]);
    expect(layers.reduce((s, l) => s + l.amount, 0)).toBe(240_000);
  });

  it("다이한 플레이어 투입금은 POT에 남지만 수령 자격이 없다", () => {
    const layers = buildDoriSidePots([
      { userId: "a", contribution: 10_000, folded: true },
      { userId: "b", contribution: 30_000, folded: false },
    ]);
    expect(layers.reduce((s, l) => s + l.amount, 0)).toBe(40_000);
    expect(layers.every((l) => !l.eligible.includes("a"))).toBe(true);
  });

  it("카드 월 숫자 파싱은 서버(dori_month)와 동일하다", () => {
    expect(doriMonthOf("01-gwang")).toBe(1);
    expect(doriMonthOf("10-b")).toBe(10);
    expect(doriMonthOf("unknown")).toBe(0);
  });
});

describe("도리 카드 보안 경계 (클라이언트 번들 감사)", () => {
  const SRC = join(process.cwd(), "src");
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(p) && !p.endsWith("types.ts") && !/\.test\.tsx?$/.test(p)) out.push(p);
    }
    return out;
  }
  const CODE = walk(SRC).map((p) => ({ p, s: readFileSync(p, "utf8") }));

  it("dori_cards / dori_rounds / dori_hand_submissions 를 직접 조회하지 않는다", () => {
    for (const table of ["dori_cards", "dori_rounds", "dori_round_players", "dori_hand_submissions"]) {
      const hits = CODE.filter((f) => new RegExp(`from\\(\\s*["'\`]${table}["'\`]`).test(f.s));
      expect(hits.map((h) => h.p), table).toEqual([]);
    }
  });

  it("Realtime 구독은 방/좌석 테이블만 사용한다 (hidden card broadcast 금지)", () => {
    const hits: string[] = [];
    for (const f of CODE) {
      for (const m of f.s.matchAll(/table:\s*["'`](dori_[a-z_]+)["'`]/g)) hits.push(m[1]!);
    }
    // 채팅 테이블은 카드/족보 정보를 담지 않는 표시용 텍스트 전용이다.
    expect([...new Set(hits)].sort()).toEqual([
      "dori_chat_messages",
      "dori_room_players",
      "dori_rooms",
    ]);
  });

  it("카드 원본을 localStorage / sessionStorage 에 저장하지 않는다", () => {
    const hits = CODE.filter((f) =>
      /(local|session)Storage\.setItem\([^)]*(card|dori_cards|myCards)/i.test(f.s),
    );
    expect(hits.map((h) => h.p)).toEqual([]);
  });
});
