/**
 * 섯다 라운드 상태 타입 정의 (TYPE ONLY).
 *
 * 보안 원칙: 카드 셔플/배분/족보 확정/정산은 100% 서버(DB RPC)에서만 수행한다.
 * 과거 브라우저 로컬 엔진(로컬 셔플·배분·봇 액션)은 치팅 표면이므로 제거했다.
 * 이 모듈은 UI가 서버 상태를 표현하기 위한 타입만 제공한다.
 */
import type { Hand } from "./sutda2Rules";
import type { BetAction, GameMode } from "./types";

export interface EnginePlayer {
  userId: string;
  seat: number;
  nickname: string;
  level: number;
  points: number;
  avatarUrl?: string | null;
  isBot?: boolean;
  /** 계급 (UNRANKED ~ CHALLENGER) — 레벨 대신 좌석에 노출한다 */
  rank?: string | null;
  /** 장착 칭호 */
  title?: string | null;
  /** 장착 캐릭터 이미지 */
  characterUrl?: string | null;
  /** 판 시작 시점 포인트 / 정산 후 포인트 (서버값) */
  initialPoints?: number | null;
  finalPoints?: number | null;
  /** 이번 판 총 베팅액 (서버값) */
  totalBet?: number;
  connection?: string;
  /** 올인 여부 (서버값) */
  allIn?: boolean;
}

export interface EnginePlayerState extends EnginePlayer {
  /** 서버가 공개를 허용한 카드만 담긴다. 상대 hidden card는 애초에 전달되지 않는다. */
  cards: string[];
  bet: number;
  folded: boolean;
  acted: boolean;
  lastAction: BetAction | null;
  hand: Hand | null;
  result: "win" | "lose" | null;
  /** 3장 섯다 최종 승부패 (본인 또는 공개 허용 이후에만 서버가 내려준다) */
  selectedCards: string[] | null;
}

export type EnginePhase = "betting" | "hand-select" | "final-betting" | "showdown";

export interface EngineState {
  roundId: string;
  mode: GameMode;
  baseBet: number;
  pot: number;
  currentBet: number;
  phase: EnginePhase;
  stage: 1 | 2;
  turnSeat: number | null;
  dealerSeat: number;
  players: EnginePlayerState[];
  log: string[];
  winners: string[];
}
