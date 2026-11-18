/**
 * 도리짓고땡 (DORI_JITGO_DDAENG) V1 전용 규칙 모듈.
 *
 * 기존 섯다(STABLE_1 / GAME_SECURITY_1) 규칙 코드와 완전히 분리된 신규 모듈이다.
 * 이 파일은 순수 계산 전용이며, 실제 카드 셔플/배분/정산은 서버(DB RPC)에서만 수행한다.
 * (브라우저에서 deck 생성은 금지 — 아래 dealDori는 서버/테스트 전용 유틸이다.)
 */
import { SUTDA_CARDS, type SutdaMonth } from "@/data/sutdaCards";
import { evaluateSutda2, type Hand as SutdaHand } from "@/lib/game/sutda2Rules";


export const DORI_GAME_TYPE = "DORI_JITGO_DDAENG" as const;

/** 도리 좌석은 1~4번만 존재한다 (5번 좌석 없음). */
export const DORI_MIN_SEAT = 1;
export const DORI_MAX_SEAT = 4;
export const DORI_MAX_PLAYERS = 4;
export const DORI_MIN_PLAYERS = 2;
export const DORI_CARDS_PER_PLAYER = 5;
/**
 * RULE PATCH 2 — 도리 베팅 횟수/레이즈 횟수 제한은 완전히 제거되었다.
 * 한 betting round는 "모든 생존자의 베팅 상태가 정리되었을 때"만 종료한다.
 */
export const DORI_BET_ROUND_LIMIT_REMOVED = true;


export type DoriCardId = string;

/** 1월~10월 각 2장, 총 20장 고정 (11월/12월 미사용) */
export const DORI_DECK: DoriCardId[] = SUTDA_CARDS.map((c) => c.id);

const MONTH_BY_ID = new Map<string, SutdaMonth>(SUTDA_CARDS.map((c) => [c.id, c.month]));

/** 카드 id → 월 숫자. 알 수 없는 카드는 0. */
export function doriMonthOf(cardId: DoriCardId): number {
  return MONTH_BY_ID.get(cardId) ?? 0;
}

export function doriShuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export interface DoriDealResult {
  hands: DoriCardId[][];
  rest: DoriCardId[];
}

/** 플레이어 수 × 5장 배분 (2인 10장 / 3인 15장 / 4인 20장). 서버 전용. */
export function dealDori(playerCount: number, random?: () => number): DoriDealResult {
  if (playerCount < DORI_MIN_PLAYERS || playerCount > DORI_MAX_PLAYERS) {
    throw new Error("DORI_PLAYER_COUNT_OUT_OF_RANGE");
  }
  const deck = doriShuffle(DORI_DECK, random);
  const hands: DoriCardId[][] = Array.from({ length: playerCount }, () => []);
  let cursor = 0;
  for (let n = 0; n < DORI_CARDS_PER_PLAYER; n++) {
    for (let p = 0; p < playerCount; p++) hands[p]!.push(deck[cursor++]!);
  }
  return { hands, rest: deck.slice(cursor) };
}

/* ------------------------------------------------------------------ */
/* 족보 (짓기 후 남은 승부패 2장만 — 2장 섯다 evaluator 재사용)         */
/* ------------------------------------------------------------------ */

export type DoriHandType =
  | "DDAENG"
  | "GGUT"
  | "HWANG"
  | "TTAENGJABI"
  | "AMHAENG"
  | "GUSA"
  | "GWANGDDAENG"
  | "SPECIAL";

export interface DoriHand {
  type: DoriHandType;
  /** 땡: 월 숫자, 끗: 0~9, 그 외 0 */
  value: number;
  /** 섯다 score 와 동일한 스케일 (황 0 / 망통 100 … 장땡 910 / 38광땡 1000) */
  rank: number;
  label: string;
  code: string;
}

export const DORI_HWANG: DoriHand = {
  type: "HWANG",
  value: 0,
  rank: 0,
  label: "황",
  code: "HWANG",
};

/** 섯다 Hand → 도리 Hand 매핑 (서버 public.dori_eval_pair_cards 와 동일) */
function fromSutdaHand(h: SutdaHand): DoriHand {
  const { code, name, category, score } = h;
  if (category === "kwangttaeng") {
    return { type: "GWANGDDAENG", value: 0, rank: score, label: name, code: `GWANG_${code.replace("kwang", "")}` };
  }
  if (category === "ttaeng") {
    const value = Number(code.replace("ttaeng", ""));
    return { type: "DDAENG", value, rank: score, label: name, code: `DDAENG_${value}` };
  }
  if (category === "special") {
    return { type: "SPECIAL", value: 0, rank: score, label: name, code: code.toUpperCase() };
  }
  if (category === "gusa") {
    return {
      type: "GUSA",
      value: 0,
      rank: score,
      label: name,
      code: code === "gusa_meongteong" ? "MUNG_GUSA" : "GUSA",
    };
  }
  if (category === "amhaeng") {
    return { type: "AMHAENG", value: 0, rank: score, label: name, code: "AMHAENG" };
  }
  if (category === "ttaengjabi") {
    return { type: "TTAENGJABI", value: 0, rank: score, label: name, code: "TTAENGJABI" };
  }
  const value = Number(code.replace("kkeut", ""));
  return { type: "GGUT", value, rank: score, label: name, code: `GGUT_${value}` };
}

/** 월(variant 정보 없음) 기준 판정 — 광땡/암행어사/땡잡이/멍텅구리구사는 판별 불가 */
export function evaluateDoriPair(a: number, b: number): DoriHand {
  const plain = (m: number, skipFirst = false) => {
    const list = SUTDA_CARDS.filter((c) => c.month === m && !c.isGwang);
    return (skipFirst ? (list[1] ?? list[0]!) : list[0]!).id;
  };
  const c1 = plain(a);
  const c2 = plain(b, a === b);
  return fromSutdaHand(evaluateSutda2([c1, c2]));
}

/**
 * 짓기 후 남은 승부패 2장 판정 — 검증 완료된 2장 섯다 evaluator를 그대로 재사용한다.
 * (광땡 / 땡 / 알리·독사·구삥·장삥·장사·세륙 / 갑오·끗·망통 / 땡잡이·암행어사·구사·멍텅구리구사)
 * 최종 승패·정산은 항상 서버가 확정하고, 이 함수는 표시/테스트용 미러다.
 */
export function evaluateDoriPairCards(c1: DoriCardId, c2: DoriCardId): DoriHand {
  return fromSutdaHand(evaluateSutda2([c1, c2]));
}


/* ------------------------------------------------------------------ */
/* 짓기 (5장 중 3장 합이 정확히 10 / 20 / 30)                          */
/* ------------------------------------------------------------------ */

export const DORI_MAKE_TOTALS = [10, 20, 30] as const;

export function isDoriMakeTotal(total: number): boolean {
  return (DORI_MAKE_TOTALS as readonly number[]).includes(total);
}

export interface DoriMakeCombo {
  selected: DoriCardId[];
  remaining: DoriCardId[];
  makeTotal: number;
  hand: DoriHand;
}

function combinations3(n: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n - 2; i++)
    for (let j = i + 1; j < n - 1; j++) for (let k = j + 1; k < n; k++) out.push([i, j, k]);
  return out;
}

/** 5장에서 가능한 모든 짓기 조합(최대 C(5,3)=10개 중 성공 조합)을 강한 순서로 반환. */
export function doriMakeCombos(cards: readonly DoriCardId[]): DoriMakeCombo[] {
  const out: DoriMakeCombo[] = [];
  for (const idx of combinations3(cards.length)) {
    const selected = idx.map((i) => cards[i]!);
    const total = selected.reduce((s, c) => s + doriMonthOf(c), 0);
    if (!isDoriMakeTotal(total)) continue;
    const remaining = cards.filter((_, i) => !idx.includes(i));
    const [x, y] = remaining;
    out.push({
      selected,
      remaining: [...remaining],
      makeTotal: total,
      hand: evaluateDoriPairCards(x!, y!),
    });
  }
  // 자동 짓기 우선순위는 섯다 sutda_best_pair 와 동일하게 조건부 특수패를 후순위로 둔다.
  const order = (h: DoriHand) =>
    h.code === "GUSA" || h.code === "MUNG_GUSA" || h.code === "TTAENGJABI" ? 0 : h.rank;
  return out.sort((a, b) => order(b.hand) - order(a.hand));

}

/** 짓기 가능 여부 + 최선 조합. 실패면 황. */
export function doriBestMake(cards: readonly DoriCardId[]): {
  made: boolean;
  hand: DoriHand;
  combo: DoriMakeCombo | null;
  combos: DoriMakeCombo[];
} {
  const combos = doriMakeCombos(cards);
  const best = combos[0] ?? null;
  return { made: !!best, hand: best ? best.hand : DORI_HWANG, combo: best, combos };
}

export type DoriMakeError =
  | "DORI_MAKE_NOT_THREE_CARDS"
  | "DORI_MAKE_DUPLICATE_CARD"
  | "DORI_MAKE_CARD_NOT_OWNED"
  | "DORI_MAKE_INVALID_TOTAL";

export interface DoriMakeValidation {
  ok: boolean;
  errorCode?: DoriMakeError;
  makeTotal?: number;
  remaining?: DoriCardId[];
  hand?: DoriHand;
}

/**
 * 제출된 짓기 3장을 검증한다 (서버 dori_submit_make와 동일 규칙).
 * 클라이언트 선택값은 신뢰하지 않고 항상 본인에게 지급된 5장 기준으로 재계산한다.
 */
export function validateDoriMake(
  myCards: readonly DoriCardId[],
  selected: readonly DoriCardId[],
): DoriMakeValidation {
  if (selected.length !== 3) return { ok: false, errorCode: "DORI_MAKE_NOT_THREE_CARDS" };
  if (new Set(selected).size !== 3) return { ok: false, errorCode: "DORI_MAKE_DUPLICATE_CARD" };

  const pool = [...myCards];
  for (const c of selected) {
    const at = pool.indexOf(c);
    if (at < 0) return { ok: false, errorCode: "DORI_MAKE_CARD_NOT_OWNED" };
    pool.splice(at, 1);
  }
  const makeTotal = selected.reduce((s, c) => s + doriMonthOf(c), 0);
  if (!isDoriMakeTotal(makeTotal)) return { ok: false, errorCode: "DORI_MAKE_INVALID_TOTAL" };
  if (pool.length !== 2) return { ok: false, errorCode: "DORI_MAKE_NOT_THREE_CARDS" };

  return {
    ok: true,
    makeTotal,
    remaining: pool,
    hand: evaluateDoriPairCards(pool[0]!, pool[1]!),
  };
}

/** 족보 비교(조건부 상성 제외): 양수면 a 승, 음수면 b 승, 0이면 동일 등급. */
export function compareDoriHands(a: DoriHand, b: DoriHand): number {
  return a.rank - b.rank;
}

/** 최종 비교 입력: 승부패 족보 + (선택) 짓기 합계 10 / 20 / 30 */
export type DoriFinalHand = DoriHand & { makeTotal?: number | null };

/**
 * 조건부 상성(암행어사 / 땡잡이 / 구사 · 멍텅구리구사)을 반영한 비교용 등급.
 * 서버 public.dori_settle_round 의 effective_rank 계산과 동일한 미러다(표시/테스트 전용).
 *
 * DORI FINAL TIE COMPARATOR — 승부패 족보가 완전히 동일할 때만 짓기 합계(30 > 20 > 10)를
 * tie-breaker 로 더한다. 보너스는 최대 3 이고 족보 간격은 10 이라 족보 우선순위를 뒤집지 않는다.
 */
export function doriEffectiveRanks(hands: readonly DoriFinalHand[]): number[] {
  const codes = hands.map((h) => h.code);
  const makeBonus = (h: DoriFinalHand) => Math.floor((h.makeTotal ?? 0) / 10);
  return hands.map((h, i) => {
    const base = (() => {
      if (h.code === "AMHAENG") {
        return codes.some((c, j) => j !== i && (c === "GWANG_18" || c === "GWANG_13")) ? 9955 : 1010;
      }
      if (h.code === "TTAENGJABI") {
        return codes.some((c, j) => j !== i && /^DDAENG_[1-9]$/.test(c)) ? 9095 : 1000;
      }
      if (h.code === "GUSA" || h.code === "MUNG_GUSA") {
        const otherBest = hands.reduce(
          (best, o, j) =>
            j === i || o.code === "GUSA" || o.code === "MUNG_GUSA" ? best : Math.max(best, o.rank),
          0,
        );
        const qualifies = h.code === "MUNG_GUSA" ? otherBest <= 909 : otherBest <= 806;
        if (!qualifies) return 1030;
      }
      return h.rank * 10;
    })();
    return base + makeBonus(h);
  });
}

/** 조건부 상성 + 짓기 합계까지 반영한 승자 index 목록 (복수면 동점 = 재경기 후보) */
export function doriWinners(hands: readonly DoriFinalHand[]): number[] {
  const ranks = doriEffectiveRanks(hands);
  const best = Math.max(...ranks);
  return ranks.reduce<number[]>((acc, r, i) => (r === best ? [...acc, i] : acc), []);
}


/* ------------------------------------------------------------------ */
/* 좌석 / 선(先) / 베팅 보조 규칙                                      */
/* ------------------------------------------------------------------ */

export function isValidDoriSeat(seat: number): boolean {
  return Number.isInteger(seat) && seat >= DORI_MIN_SEAT && seat <= DORI_MAX_SEAT;
}

/** 첫 판은 가장 낮은 착석 좌석, 이후 1→2→3→4→1 순환(빈자리 skip). */
export function nextDoriDealerSeat(
  occupiedSeats: readonly number[],
  prevDealerSeat: number | null,
): number | null {
  const seats = [...new Set(occupiedSeats.filter(isValidDoriSeat))].sort((a, b) => a - b);
  if (seats.length === 0) return null;
  if (prevDealerSeat == null) return seats[0]!;
  for (let step = 1; step <= DORI_MAX_SEAT; step++) {
    const candidate = ((prevDealerSeat - 1 + step) % DORI_MAX_SEAT) + 1;
    if (seats.includes(candidate)) return candidate;
  }
  return seats[0]!;
}

/** 선부터 시작하는 액션 순서 (빈자리 skip) */
export function doriActionOrder(
  occupiedSeats: readonly number[],
  dealerSeat: number,
): number[] {
  const seats = [...new Set(occupiedSeats.filter(isValidDoriSeat))].sort((a, b) => a - b);
  const start = seats.findIndex((s) => s >= dealerSeat);
  const at = start < 0 ? 0 : start;
  return [...seats.slice(at), ...seats.slice(0, at)];
}

/**
 * RULE PATCH 2 — 도리 베팅 액션은 기존 섯다와 완전히 동일하다.
 * BET / RAISE 개념은 제거되었다.
 */
export type DoriBetAction =
  | "die"
  | "check"
  | "call"
  | "ping"
  | "ttadang"
  | "quarter"
  | "half"
  | "all_in";

/** 액션바 표시 순서 (섯다와 동일) */
export const DORI_BET_ACTIONS: DoriBetAction[] = [
  "die",
  "check",
  "call",
  "ping",
  "ttadang",
  "quarter",
  "half",
  "all_in",
];

export interface DoriBetContext {
  /** 서버 기준 현재 POT */
  pot: number;
  /** 이번 betting round의 최고 베팅액 */
  currentBet: number;
  /** 내가 이번 betting round에 이미 넣은 금액 */
  myBet: number;
  /** 기본 베팅(ante) */
  baseBet: number;
  /** 내 잔액 */
  balance: number;
}

export type DoriBetError =
  | "DORI_CHECK_NOT_ALLOWED"
  | "DORI_NOTHING_TO_CALL"
  | "DORI_INSUFFICIENT_BALANCE"
  | "DORI_UNKNOWN_ACTION";

export interface DoriBetResult {
  ok: boolean;
  errorCode?: DoriBetError;
  /** 실제 잔액에서 추가 차감되는 금액 = POT 증가량 = dori_actions.amount */
  additionalAmount?: number;
  allIn?: boolean;
}

/**
 * 서버 helper `public.bet_additional_amount`(섯다와 공유)의 순수 미러.
 * 표시용 계산이며 최종 금액은 항상 서버가 다시 계산한다.
 */
export function doriBetAdditionalAmount(
  action: DoriBetAction,
  ctx: DoriBetContext,
): number | null {
  const owed = Math.max(0, ctx.currentBet - ctx.myBet);
  const pot = Math.max(0, ctx.pot);
  const base = Math.max(0, ctx.baseBet);
  let amount: number;

  if (action === "die" || action === "check") amount = 0;
  else if (action === "call") amount = owed;
  else if (action === "ping") amount = owed + base;
  else if (action === "ttadang") {
    const target = Math.max(ctx.currentBet, base) * 2;
    amount = Math.max(target - ctx.myBet, owed + base);
  } else if (action === "half") amount = owed + Math.max(Math.floor(pot / 2), base);
  else if (action === "quarter") amount = owed + Math.max(Math.floor(pot / 4), base);
  else if (action === "all_in") amount = Math.max(0, ctx.balance);
  else return null;

  if (amount > Math.max(0, ctx.balance)) amount = Math.max(0, ctx.balance);
  return Math.max(0, amount);
}

/**
 * 액션 가능 여부와 "실제 추가 차감액"을 계산한다.
 * 버튼 표시금액 = 잔액 감소 = dori_actions.amount = POT 증가량 불변식의 기준.
 * 베팅 횟수 제한은 존재하지 않는다.
 */
export function resolveDoriBet(action: DoriBetAction, ctx: DoriBetContext): DoriBetResult {
  const owed = Math.max(0, ctx.currentBet - ctx.myBet);
  const amount = doriBetAdditionalAmount(action, ctx);
  if (amount === null) return { ok: false, errorCode: "DORI_UNKNOWN_ACTION" };

  if (action === "die") return { ok: true, additionalAmount: 0 };
  if (action === "check") {
    if (owed > 0 || ctx.currentBet > 0) return { ok: false, errorCode: "DORI_CHECK_NOT_ALLOWED" };
    return { ok: true, additionalAmount: 0 };
  }
  if (action === "call" && owed <= 0) return { ok: false, errorCode: "DORI_NOTHING_TO_CALL" };
  if (amount <= 0) return { ok: false, errorCode: "DORI_INSUFFICIENT_BALANCE" };
  if (action !== "call" && action !== "all_in") {
    // 클램프 이전 원금액이 잔액을 넘으면 해당 버튼은 사용할 수 없다 (올인 사용).
    const raw = rawDoriAmount(action, ctx);
    if (raw > ctx.balance) return { ok: false, errorCode: "DORI_INSUFFICIENT_BALANCE" };
  }
  return { ok: true, additionalAmount: amount, allIn: amount === ctx.balance };
}

function rawDoriAmount(action: DoriBetAction, ctx: DoriBetContext): number {
  const owed = Math.max(0, ctx.currentBet - ctx.myBet);
  const base = Math.max(0, ctx.baseBet);
  const pot = Math.max(0, ctx.pot);
  if (action === "ping") return owed + base;
  if (action === "ttadang")
    return Math.max(Math.max(ctx.currentBet, base) * 2 - ctx.myBet, owed + base);
  if (action === "half") return owed + Math.max(Math.floor(pot / 2), base);
  if (action === "quarter") return owed + Math.max(Math.floor(pot / 4), base);
  return owed;
}

/* ------------------------------------------------------------------ */
/* SIDE POT                                                            */
/* ------------------------------------------------------------------ */

export interface DoriContribution {
  userId: string;
  /** 이 판에 실제 투입한 총액 */
  contribution: number;
  folded: boolean;
}

export interface DoriPotLayer {
  level: number;
  amount: number;
  eligible: string[];
}

/**
 * ALL-IN 한도 기준 MAIN/SIDE POT 분리.
 * 각 플레이어는 자기가 실제 투입한 한도까지만 수령 자격을 갖는다.
 * (다이한 플레이어의 투입금은 POT에 남지만 수령 자격은 없다.)
 */
export function buildDoriSidePots(rows: readonly DoriContribution[]): DoriPotLayer[] {
  const levels = [...new Set(rows.filter((r) => r.contribution > 0).map((r) => r.contribution))].sort(
    (a, b) => a - b,
  );
  const layers: DoriPotLayer[] = [];
  let prev = 0;
  for (const [i, level] of levels.entries()) {
    const slice = level - prev;
    let amount = 0;
    for (const r of rows) amount += Math.max(0, Math.min(r.contribution, level) - prev);
    const eligible = rows.filter((r) => !r.folded && r.contribution >= level).map((r) => r.userId);
    if (amount > 0) layers.push({ level: i + 1, amount, eligible });
    prev = level;
    void slice;
  }
  return layers;
}
