export type GameMode = "sutda2" | "sutda3";

export const GAME_MODE_LABEL: Record<GameMode, string> = {
  sutda2: "2장 섯다",
  sutda3: "3장 섯다",
};

export type BetAction =
  | "die"
  | "call"
  | "ping"
  | "ttadang"
  | "half"
  | "quarter"
  | "check"
  | "jjol"
  | "all_in";

export const ACTION_LABEL: Record<BetAction, string> = {
  die: "다이",
  call: "콜",
  ping: "삥",
  ttadang: "따당",
  half: "하프",
  quarter: "쿼터",
  check: "체크",
  jjol: "쫄",
  all_in: "올인",
};

export type SeatStatus = "waiting" | "playing" | "folded" | "winner" | "loser";

export interface SeatState {
  seat: number;
  userId: string;
  nickname: string;
  level: number;
  points: number;
  avatarUrl?: string | null;
  cards: string[];
  revealed: boolean;
  bet: number;
  status: SeatStatus;
  isMe: boolean;
  isDealer: boolean;
  lastAction?: BetAction | null;
}

export interface RoundState {
  roundId: string;
  roomId: string;
  mode: GameMode;
  pot: number;
  phase: "dealing" | "betting" | "third-card" | "showdown" | "finished";
  turnSeat: number | null;
  turnNumber: number;
  currentBet: number;
  seats: SeatState[];
  log: string[];
}
