/**
 * 도리 전용 시각효과(FX) 이벤트 계획 — 순수 함수.
 *
 * 원칙
 * - 서버가 확정한 상태(actions.id / round.settlementStatus / seats.resultType)만 사용한다.
 * - 클라이언트가 승자·금액을 계산하지 않는다. (로그 패널과 동일한 서버값 사용)
 * - 같은 event key는 한 번만 반환한다 → realtime rerender에서 중복 재생 0.
 * - 게임 로직/DB와 결합하지 않는다. 실패해도 게임 진행에 영향이 없다.
 */

export type DoriFxEvent =
  | { kind: "BET"; key: string; seat: number; strong: boolean }
  | { kind: "WIN"; key: string; seat: number; amount: number }
  | { kind: "REMATCH"; key: string; pot: number };

export interface DoriFxInput {
  round: {
    roundId: string;
    phase: string;
    pot: number;
    settlementStatus: string;
  } | null;
  seats: { seat: number; userId: string; resultType: string | null; contribution: number }[];
  actions: { id: string; userId: string; type: string }[];
}

/** 코인이 이동하는 베팅 액션 (체크/다이는 코인 이동 없음) */
const COIN_ACTIONS = new Set([
  "CALL",
  "PING",
  "TTADANG",
  "QUARTER",
  "HALF",
  "ALL_IN",
  "ALLIN",
  "ANTE",
  // legacy(구 액션명) 기록 호환
  "BET",
  "RAISE",
]);
const STRONG_ACTIONS = new Set(["ALL_IN", "ALLIN", "TTADANG", "HALF", "RAISE"]);

export function planDoriFxEvents(input: DoriFxInput, seen: ReadonlySet<string>): DoriFxEvent[] {
  const out: DoriFxEvent[] = [];
  const seatOf = new Map(input.seats.map((s) => [s.userId, s.seat]));

  for (const a of input.actions) {
    const type = a.type.toUpperCase();
    if (!COIN_ACTIONS.has(type)) continue;
    const seat = seatOf.get(a.userId);
    if (!seat) continue;
    const key = `bet:${a.id}`;
    if (seen.has(key)) continue;
    out.push({ kind: "BET", key, seat, strong: STRONG_ACTIONS.has(type) });
  }

  const round = input.round;
  if (round && round.phase === "FINISHED") {
    if (round.settlementStatus === "REMATCH") {
      const key = `rematch:${round.roundId}`;
      if (!seen.has(key)) out.push({ kind: "REMATCH", key, pot: round.pot });
    } else {
      const winner = input.seats.find((s) => s.resultType === "WIN");
      if (winner) {
        const key = `win:${round.roundId}:${winner.userId}`;
        if (!seen.has(key)) {
          out.push({
            kind: "WIN",
            key,
            seat: winner.seat,
            // 로그 패널과 동일한 서버 확정값
            amount: Math.max(0, round.pot - winner.contribution),
          });
        }
      }
    }
  }

  return out;
}
