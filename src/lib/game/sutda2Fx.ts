/**
 * 2장 섯다 시각효과(FX) 이벤트 계획 — 순수 함수 (PHASE 3).
 *
 * 원칙
 * - 서버가 확정한 값만 사용한다 (action id / status / resultType / initial·finalPoints).
 * - 클라이언트가 승자·금액을 계산하지 않는다.
 * - 같은 key는 한 번만 반환한다 → realtime refetch 에서 중복 연출 0.
 * - 게임 로직/베팅 계산/정산과 결합하지 않는다. 실패해도 진행에 영향이 없다.
 */

export type Sutda2FxEvent =
  | { kind: "BET"; key: string; userId: string; count: number; strong: boolean; allIn: boolean }
  | { kind: "WIN"; key: string; userId: string; amount: number }
  | { kind: "REMATCH"; key: string; pot: number };

export interface Sutda2FxInput {
  roundId: string | null;
  /** 서버 라운드 상태 ("finished" 이면 정산 확정) */
  status: string | null;
  rematch: boolean;
  pot: number;
  actions: readonly { id: string; userId: string; type: string }[];
  seats: readonly {
    userId: string;
    resultType: string | null;
    initialPoints: number | null;
    finalPoints: number | null;
  }[];
}

/** 코인이 POT으로 이동하는 액션 (체크/다이는 이동 없음) */
const COIN_ACTIONS = new Set(["call", "ping", "ttadang", "quarter", "half", "all_in", "allin"]);
/** 강조(파티클 +, glow 강함) 액션 */
const STRONG_ACTIONS = new Set(["ttadang", "quarter", "half", "all_in", "allin"]);
const ALL_IN_ACTIONS = new Set(["all_in", "allin"]);

/** 액션별 코인 개수 — 일반 3~5, 올인 6~8 범위 */
export function sutda2CoinCount(type: string): number {
  const t = type.toLowerCase();
  if (ALL_IN_ACTIONS.has(t)) return 7;
  if (STRONG_ACTIONS.has(t)) return 5;
  return 3;
}

export function planSutda2FxEvents(
  input: Sutda2FxInput,
  seen: ReadonlySet<string>,
): Sutda2FxEvent[] {
  const out: Sutda2FxEvent[] = [];

  for (const a of input.actions) {
    const type = String(a.type).toLowerCase();
    if (!COIN_ACTIONS.has(type)) continue;
    const key = `bet:${a.id}`;
    if (seen.has(key)) continue;
    out.push({
      kind: "BET",
      key,
      userId: a.userId,
      count: sutda2CoinCount(type),
      strong: STRONG_ACTIONS.has(type),
      allIn: ALL_IN_ACTIONS.has(type),
    });
  }

  const rid = input.roundId;
  if (rid && input.status === "finished") {
    if (input.rematch) {
      const key = `rematch:${rid}`;
      if (!seen.has(key)) out.push({ kind: "REMATCH", key, pot: input.pot });
    } else {
      for (const s of input.seats) {
        if (s.resultType !== "WIN") continue;
        const key = `win:${rid}:${s.userId}`;
        if (seen.has(key)) continue;
        const gained =
          s.finalPoints !== null && s.initialPoints !== null
            ? Number(s.finalPoints) - Number(s.initialPoints)
            : 0;
        out.push({ kind: "WIN", key, userId: s.userId, amount: Math.max(0, gained) });
      }
    }
  }

  return out;
}
