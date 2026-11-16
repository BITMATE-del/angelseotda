/**
 * PHASE 4 — 라운드 결과 오버레이 표시 데이터 (순수 함수).
 *
 * 게임 코어(정산·족보·사이드팟·재경기)는 전혀 계산하지 않는다.
 * dori_round_result 가 내려준 서버 확정값만 화면 문구로 바꾼다.
 */
import type { DoriRoundResult } from "@/lib/services/doriService";

export interface DoriResultView {
  /** 재경기(무승부) 여부 */
  rematch: boolean;
  /** 재경기 사유 (서버 확정 문구, 없으면 null) */
  rematchReason: string | null;
  /** 나의 결과 헤드라인 */
  headline: "승 리" | "패 배" | "무 승 부";
  /** 나의 손익 (서버 net) — null 이면 참가하지 않은 판 */
  myNet: number | null;
  /** 나의 정산 후 보유 포인트 */
  myFinalPoints: number | null;
  /** 0P 정산 → 퇴장 대상 */
  zeroBalance: boolean;
  /** 이번 판 종료 후 좌석에서 빠진 경우 (나가기 예약 등) */
  leftRoom: boolean;
  /** 이월 판돈 (재경기일 때만) */
  carryPot: number;
  /** 대표 승자들 (복수 payout 은 전부 표시) */
  payouts: { label: string; nickname: string; amount: number }[];
  /** 승자 족보 — 서버가 공개하지 않으면 null */
  winnerHand: string | null;
  /** 상대 전원 다이 승리 */
  foldWin: boolean;
  /** 좌석별 요약 행 */
  rows: {
    userId: string;
    seat: number;
    nickname: string;
    isMe: boolean;
    status: "승" | "패" | "다이" | "재경기";
    handLabel: string | null;
    net: number;
    /** 서버가 공개를 허용한 경우에만 패/짓기가 채워진다 */
    revealed: boolean;
    cards: string[];
    selectedCards: string[];
    remainingCards: string[];
    makeTotal: number | null;
    isHwang: boolean;
  }[];
  /** 서버가 결정한 공개 정책 */
  revealMode: "SHOWDOWN" | "REVEAL" | "HIDDEN" | null;
  revealChoice: "PENDING" | "REVEAL" | "HIDE" | null;
  /** 내가 폴드승 승자이고 아직 공개 여부를 선택하지 않았을 때만 true */
  canChooseReveal: boolean;
  /** 결과 조회 대상 라운드 */
  roundId: string | null;
}

export function buildDoriResultView(
  result: DoriRoundResult,
  myUserId: string | null,
): DoriResultView | null {
  if (!result?.ready || !result.players?.length) return null;
  const rematch = result.settlementStatus === "REMATCH";
  const players = result.players;
  const mine = players.find((p) => p.userId === myUserId) ?? null;
  const winners = players.filter((p) => p.resultType === "WIN");
  const showdown = !!result.showdown;

  const headline: DoriResultView["headline"] = rematch
    ? "무 승 부"
    : mine?.resultType === "WIN"
      ? "승 리"
      : "패 배";

  const rawPayouts = result.payouts ?? [];
  // 같은 사람에게 여러 레이어로 지급된 경우(사이드팟 레이어 분할)는 한 줄로 합친다.
  // 금액은 서버 지급액 합계이며 재계산하지 않는다.
  const single =
    rawPayouts.length > 0 && rawPayouts.every((x) => x.userId === rawPayouts[0]!.userId);
  const merged = single
    ? [
        {
          ordinal: 1,
          userId: rawPayouts[0]!.userId,
          nickname: rawPayouts[0]!.nickname,
          amount: rawPayouts.reduce((a, b) => a + b.amount, 0),
        },
      ]
    : rawPayouts;
  const payouts = merged.map((p, i) => ({
    label: merged.length > 1 ? (i === 0 ? "MAIN POT" : `SIDE POT ${i}`) : "POT",
    nickname: p.nickname,
    amount: p.amount,
  }));


  const winnerHand = winners.find((w) => w.handLabel)?.handLabel ?? null;

  return {
    rematch,
    rematchReason: result.rematchReason ?? null,
    headline,
    myNet: mine ? mine.net : null,
    myFinalPoints: mine?.finalPoints ?? null,
    zeroBalance: !rematch && !!mine && (mine.finalPoints ?? 1) <= 0,
    leftRoom: !!mine && !mine.stillSeated,
    carryPot: rematch ? (result.pot ?? 0) : 0,
    payouts,
    winnerHand,
    foldWin: !rematch && !showdown,
    rows: players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        userId: p.userId,
        seat: p.seat,
        nickname: p.nickname,
        isMe: p.userId === myUserId,
        status: rematch
          ? ("재경기" as const)
          : p.folded
            ? ("다이" as const)
            : p.resultType === "WIN"
              ? ("승" as const)
              : ("패" as const),
        handLabel: p.handLabel,
        net: p.net,
        revealed: !!p.revealed,
        cards: p.revealed ? (p.cards ?? []) : [],
        selectedCards: p.revealed ? (p.selectedCards ?? []) : [],
        remainingCards: p.revealed ? (p.remainingCards ?? []) : [],
        makeTotal: p.revealed ? (p.makeTotal ?? null) : null,
        isHwang: !!p.revealed && !!p.isHwang,
      })),
    revealMode: result.revealMode ?? null,
    revealChoice: result.revealChoice ?? null,
    canChooseReveal: !!result.canChooseReveal,
    roundId: result.roundId ?? null,
  };
}

/** 손익 표기 (+20,000 P / -4,000 P / 0 P) */
export function formatDoriNet(net: number): string {
  const abs = Math.abs(net).toLocaleString("ko-KR");
  if (net > 0) return `+${abs} P`;
  if (net < 0) return `-${abs} P`;
  return "0 P";
}
