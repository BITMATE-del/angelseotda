/**
 * ANGEL SUTDA 게임 룰 설정 (단일 원천).
 *
 * - 족보 우선순위, 동점(DRAW) 처리 규칙, 턴 제한, 재접속 유예, 이펙트 등급을
 *   이 파일 한 곳에서만 정의한다.
 * - 화면 텍스트나 이미지 파일 이름으로 승패를 판정하지 않는다.
 *   판정은 반드시 카드 id + isGwang 데이터를 사용하는 룰 모듈(sutda2Rules / sutda3Rules)에서만 수행한다.
 * - 실제 포인트 정산은 서버(DB RPC settle_round)에서만 이루어진다.
 */

/** 강한 순서(위 → 아래). 변경 시 이 배열만 수정한다. */
export const RANK_ORDER = [
  "kwang38",
  "kwang18",
  "kwang13",
  "ttaeng10",
  "ttaeng9",
  "ttaeng8",
  "ttaeng7",
  "ttaeng6",
  "ttaeng5",
  "ttaeng4",
  "ttaeng3",
  "ttaeng2",
  "ttaeng1",
  "ali",
  "doksa",
  "gupping",
  "jangping",
  "jangsa",
  "seryuk",
  "kkeut9", // 갑오
  "kkeut8",
  "kkeut7",
  "kkeut6",
  "kkeut5",
  "kkeut4",
  "kkeut3",
  "kkeut2",
  "kkeut1",
  "kkeut0", // 망통
] as const;

export type RankCode = (typeof RANK_ORDER)[number];

/** 낮을수록 강한 순위(0 = 최강). 알 수 없는 코드는 최하위. */
export function rankIndex(code: string): number {
  const i = (RANK_ORDER as readonly string[]).indexOf(code);
  return i === -1 ? RANK_ORDER.length : i;
}

/** 결과 타입 — 서버 game_round_players.result_type 과 동일한 값. */
export type ResultType = "WIN" | "LOSE" | "DRAW";

/** 플레이어 라운드 상태 — 서버 game_round_players.player_status 와 동일한 값. */
export type PlayerRoundStatus =
  | "ACTIVE"
  | "FOLDED"
  | "SQUEEZING"
  | "HAND_SELECTED"
  | "ALL_IN"
  | "DISCONNECTED"
  | "FINISHED";

export type ConnectionStatus = "CONNECTED" | "DISCONNECTED";

export type SeatSlotStatus = "EMPTY" | "RESERVED" | "OCCUPIED" | "DISCONNECTED";

export const GAME_RULES = {
  /** 동점 처리: 동일 족보는 무승부로 POT 균등 분배 */
  tie: {
    allowDraw: true,
    /** 균등 분배 후 나누어 떨어지지 않는 잔여 포인트 귀속 규칙 (서버 settle_round와 동일) */
    remainder: "lowest_seat_winner" as const,
  },
  /** 턴 제한 (서버 시간 기준. 프론트 타이머는 표시용) */
  turn: {
    seconds: 15,
    /** 시간 초과 시 서버 자동 행동 */
    timeoutAction: { whenCheckable: "check", otherwise: "die" } as const,
  },
  /** 접속 끊김 재접속 유예 */
  reconnect: {
    graceSeconds: 30,
    heartbeatSeconds: 8,
    /** 유예 초과 시 자동 다이 */
    onExpire: "die" as const,
  },
  /** 베팅: 보유(가용) 포인트를 초과하는 베팅은 서버에서 절삭/거부 */
  betting: {
    allowAllInTruncate: true,
  },
} as const;

/** 족보 등급별 연출 강도 (설정으로 ON/OFF) */
export const EFFECT_TIERS: Record<string, "legendary" | "epic" | "rare" | "normal"> = {
  kwang38: "legendary",
  kwang18: "epic",
  kwang13: "epic",
  ali: "rare",
  doksa: "rare",
  gupping: "rare",
  jangping: "rare",
  jangsa: "rare",
  seryuk: "rare",
};

export function effectTier(code: string): "legendary" | "epic" | "rare" | "normal" {
  if (EFFECT_TIERS[code]) return EFFECT_TIERS[code]!;
  if (code.startsWith("ttaeng") || code.startsWith("samttaeng")) return "epic";
  return "normal";
}

export const EFFECTS_ENABLED_DEFAULT = true;
