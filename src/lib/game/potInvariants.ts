/**
 * potInvariants — STABLE_1 게임코어의 POT/정산 불변식을 코드로 고정한 순수 참조 구현.
 *
 * 목적
 * - 서버(DB RPC)가 authoritative 하다는 원칙은 그대로 유지한다. 이 모듈은 서버를 대체하지 않는다.
 * - 검증 완료된 규칙(사이드팟 층 분리 · unmatched excess 반환 · fold dead money 유지 ·
 *   무승부 REMATCH carry · 최소입장 미달 AUTO KICK)을 자동 회귀 테스트로 고정하기 위한 참조식이다.
 * - 서버 로직 변경 없이, 규칙이 흔들렸는지 Vitest로 즉시 감지하는 용도다.
 */

export interface Contribution {
  userId: string;
  /** 이번 라운드 총 베팅액 (game_round_players.total_bet) */
  amount: number;
  /** 다이(폴드) 여부 — dead money는 팟에 남지만 수령 자격은 없다 */
  folded: boolean;
}

export interface PotLayer {
  /** 이 층의 총액 */
  amount: number;
  /** 이 층을 수령할 자격이 있는 userId (폴드 제외) */
  eligible: string[];
}

/**
 * contribution 기반 MAIN/SIDE POT 층 분리.
 * - 층 경계는 서로 다른 contribution 금액이다.
 * - 폴드 플레이어의 금액은 층에 그대로 남지만 eligible에는 포함되지 않는다.
 * - 아무도 대결하지 않는 최상단 초과분(unmatched excess)은 층으로 만들지 않고 해당 플레이어에게 반환한다.
 */
export function buildPotLayers(contributions: readonly Contribution[]): {
  layers: PotLayer[];
  refunds: Record<string, number>;
  potTotal: number;
} {
  const potTotal = contributions.reduce((sum, c) => sum + c.amount, 0);
  const refunds: Record<string, number> = {};
  const live = contributions.filter((c) => !c.folded && c.amount > 0);

  // unmatched excess: 생존자 중 최고 금액이 단독이면 2위와의 차액을 반환한다.
  const liveAmounts = [...live].sort((x, y) => y.amount - x.amount);
  let working = contributions.map((c) => ({ ...c }));
  if (liveAmounts.length >= 2 && liveAmounts[0]!.amount > liveAmounts[1]!.amount) {
    const top = liveAmounts[0]!;
    const second = liveAmounts[1]!.amount;
    const others = working.filter((c) => c.userId !== top.userId);
    const maxOther = others.reduce((m, c) => Math.max(m, c.amount), 0);
    const matched = Math.max(second, maxOther);
    const excess = top.amount - matched;
    if (excess > 0) {
      refunds[top.userId] = excess;
      working = working.map((c) =>
        c.userId === top.userId ? { ...c, amount: c.amount - excess } : c,
      );
    }
  }

  const boundaries = [...new Set(working.filter((c) => c.amount > 0).map((c) => c.amount))].sort(
    (x, y) => x - y,
  );

  const layers: PotLayer[] = [];
  let prev = 0;
  for (const bound of boundaries) {
    const step = bound - prev;
    const participants = working.filter((c) => c.amount >= bound);
    const amount = step * participants.length;
    if (amount > 0) {
      layers.push({
        amount,
        eligible: participants.filter((c) => !c.folded).map((c) => c.userId),
      });
    }
    prev = bound;
  }
  return { layers, refunds, potTotal };
}

/** 층 합계 + 반환액 = 총 contribution (POT 불변식) */
export function potLayerInvariantOk(contributions: readonly Contribution[]): boolean {
  const { layers, refunds, potTotal } = buildPotLayers(contributions);
  const layerSum = layers.reduce((s, l) => s + l.amount, 0);
  const refundSum = Object.values(refunds).reduce((s, v) => s + v, 0);
  return layerSum + refundSum === potTotal;
}

export interface SettleInput {
  contributions: readonly Contribution[];
  /** 승자 판정 결과 — 동일 최고 족보가 2명 이상이면 무승부(REMATCH) */
  ranking: Record<string, number>;
  /** 이전 판에서 이월된 carry pot */
  carryIn?: number;
}

export interface SettleResult {
  status: "SETTLED" | "REMATCH";
  payouts: Record<string, number>;
  /** 다음 판으로 이월되는 POT */
  carryOut: number;
  pot: number;
}

/**
 * 참조 정산.
 * - 무승부(동일 최고 족보 2명 이상): 지급 0, POT 전액 carry.
 * - 정상 승부: 각 층은 자격자 중 최고 족보가 수령한다. unmatched excess는 반환된다.
 */
export function settleReference(input: SettleInput): SettleResult {
  const carryIn = input.carryIn ?? 0;
  const { layers, refunds, potTotal } = buildPotLayers(input.contributions);
  const pot = potTotal + carryIn;

  const liveIds = input.contributions.filter((c) => !c.folded).map((c) => c.userId);
  const best = Math.max(...liveIds.map((id) => input.ranking[id] ?? -1));
  const bestCount = liveIds.filter((id) => (input.ranking[id] ?? -1) === best).length;

  if (liveIds.length >= 2 && bestCount >= 2) {
    return { status: "REMATCH", payouts: {}, carryOut: pot, pot };
  }

  const payouts: Record<string, number> = {};
  for (const [id, amount] of Object.entries(refunds)) {
    payouts[id] = (payouts[id] ?? 0) + amount;
  }
  // carry pot은 최상단(마지막) 층 자격자와 동일하게 승부 결과로 배정한다.
  const carryTargetLayer = layers.length - 1;
  layers.forEach((layer, index) => {
    const pool = layer.eligible.length ? layer.eligible : liveIds;
    const layerBest = Math.max(...pool.map((id) => input.ranking[id] ?? -1));
    const winners = pool.filter((id) => (input.ranking[id] ?? -1) === layerBest);
    const bonus = index === carryTargetLayer ? carryIn : 0;
    const share = Math.floor((layer.amount + bonus) / winners.length);
    winners.forEach((id) => {
      payouts[id] = (payouts[id] ?? 0) + share;
    });
  });

  return { status: "SETTLED", payouts, carryOut: 0, pot };
}

/** 정산 합계 = 분배 대상 POT (반환 포함) */
export function settlementInvariantOk(input: SettleInput): boolean {
  const result = settleReference(input);
  const paid = Object.values(result.payouts).reduce((s, v) => s + v, 0);
  if (result.status === "REMATCH") return paid === 0 && result.carryOut === result.pot;
  return paid === result.pot;
}

export type KickReason = "ZERO_BALANCE" | "BELOW_ROOM_MINIMUM" | null;

/** 정산 후 좌석 유지 판정 — 0P는 ZERO_BALANCE, 최소입장 미달은 BELOW_ROOM_MINIMUM */
export function autoKickReason(finalPoints: number, roomMinimum: number): KickReason {
  if (finalPoints <= 0) return "ZERO_BALANCE";
  if (finalPoints < roomMinimum) return "BELOW_ROOM_MINIMUM";
  return null;
}
