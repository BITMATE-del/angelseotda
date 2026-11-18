/**
 * SUTDA 2 CARD PHASE 4 — 라운드 결과 표시 데이터 (순수 함수 · 표시 전용).
 *
 * 게임 코어는 전혀 계산하지 않는다. 승자·족보·지급액·손익·잔액은 모두
 * 서버 RPC(sutda_round_result)가 확정한 값이며 여기서는 문구로만 바꾼다.
 * 공개 여부(revealed)도 서버 판정만 따르고, 클라이언트에서 되살리지 않는다.
 */
import type { SutdaRoundResult } from "@/lib/services/serverGameService";
import { rematchReasonLabel, type RematchReason } from "@/lib/game/gusaRematch";

export interface Sutda2ResultRow {
  userId: string;
  seat: number;
  nickname: string;
  isMe: boolean;
  status: "승" | "패" | "다이" | "재경기";
  /** 서버가 공개를 허용한 경우에만 채워진다 */
  revealed: boolean;
  cards: string[];
  handLabel: string | null;
  net: number;
  payout: number;
}

export interface Sutda2ResultView {
  roundId: string;
  roundNumber: number;
  rematch: boolean;
  rematchReason: RematchReason | null;
  headline: "승 리" | "패 배" | "재 경 기";
  /** 이월 판돈 (재경기일 때만) */
  carryPot: number;
  pot: number;
  /** 내가 실제로 받은 지급액 (서버값) */
  myPayout: number;
  /** 이번 판 손익 (서버 확정 initial/final 차이) */
  myNet: number | null;
  /** 정산 후 보유 포인트 (서버값) */
  myFinalPoints: number | null;
  /** 대표 지급 내역 — 같은 사람의 사이드팟 레이어는 한 줄로 합친다 */
  payouts: { label: string; nickname: string; amount: number }[];
  /** 승자 족보 (공개된 경우만) */
  winnerHand: string | null;
  /** 상대 전원 다이 승리 */
  foldWin: boolean;
  /** 정상 쇼다운 여부 */
  showdown: boolean;
  revealMode: "SHOWDOWN" | "REVEALED" | "HIDDEN" | null;
  revealChoice: string | null;
  /** 내가 폴드승 승자이고 아직 공개 여부를 선택하지 않은 경우만 true */
  canChooseReveal: boolean;
  rows: Sutda2ResultRow[];
}

export function buildSutda2ResultView(
  result: SutdaRoundResult | null,
  myUserId: string | null,
): Sutda2ResultView | null {
  if (!result?.ready || !result.players?.length) return null;
  const rematch = !!result.rematch;
  const players = result.players;
  const mine = players.find((p) => p.userId === myUserId) ?? null;

  const raw = (result.payouts ?? []).filter((p) => Number(p.amount) > 0);
  const single = raw.length > 0 && raw.every((p) => p.userId === raw[0]!.userId);
  const merged = single
    ? [
        {
          userId: raw[0]!.userId,
          nickname: raw[0]!.nickname,
          amount: raw.reduce((a, b) => a + Number(b.amount), 0),
        },
      ]
    : raw.map((p) => ({ userId: p.userId, nickname: p.nickname, amount: Number(p.amount) }));
  const payouts = merged.map((p, i) => ({
    label: merged.length > 1 ? (i === 0 ? "MAIN POT" : `SIDE POT ${i}`) : "POT",
    nickname: p.nickname,
    amount: p.amount,
  }));

  const rows: Sutda2ResultRow[] = players
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
      revealed: !!p.revealed,
      cards: p.revealed ? (p.cards ?? []) : [],
      handLabel: p.revealed ? (p.handLabel ?? null) : null,
      net: Number(p.net ?? 0),
      payout: Number(p.payout ?? 0),
    }));

  return {
    roundId: result.roundId,
    roundNumber: Number(result.roundNumber ?? 0),
    rematch,
    rematchReason: result.rematchReason ?? null,
    headline: rematch ? "재 경 기" : mine?.resultType === "WIN" ? "승 리" : "패 배",
    carryPot: rematch ? Number(result.carryPot ?? result.pot ?? 0) : 0,
    pot: Number(result.pot ?? 0),
    myPayout: Number(mine?.payout ?? 0),
    myNet: mine ? Number(mine.net ?? 0) : null,
    myFinalPoints: mine?.finalPoints == null ? null : Number(mine.finalPoints),
    payouts,
    winnerHand: rows.find((r) => r.status === "승" && r.handLabel)?.handLabel ?? null,
    foldWin: !rematch && !!result.foldWin,
    showdown: !!result.showdown,
    revealMode: result.revealMode ?? null,
    revealChoice: result.revealChoice ?? null,
    canChooseReveal: !!result.canChooseReveal,
    rows,
  };
}

/** 손익 표기 (+20,000 P / -10,000 P / 0 P) */
export function formatSutda2Net(net: number): string {
  const abs = Math.abs(net).toLocaleString("ko-KR");
  if (net > 0) return `+${abs} P`;
  if (net < 0) return `-${abs} P`;
  return "0 P";
}

/** 게임기록용 결과 상세 문장 (서버 확정값만 사용) */
export function sutda2ResultLogLines(view: Sutda2ResultView): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const rid = view.roundId;
  if (view.rematch) {
    out.push({
      id: `res:${rid}:rematch`,
      text:
        (view.rematchReason === "DRAW" || view.rematchReason === null
          ? "무승부"
          : `${rematchReasonLabel(view.rematchReason)} 발생`) +
        ` · 판돈 ${view.carryPot.toLocaleString("ko-KR")}P 이월 · 재경기`,
    });
    return out;
  }
  for (const r of view.rows) {
    const head = `${r.nickname} ${
      r.status === "다이" ? "다이" : r.status === "승" ? (view.foldWin ? "상대 전원 다이 승리" : "승리") : "패배"
    }`;
    const hand = r.handLabel ? ` · ${r.handLabel}` : "";
    const cards = r.revealed && r.cards.length > 0 ? ` · 패 ${r.cards.join(" ")}` : "";
    const hidden = r.revealed ? "" : " · 패 비공개";
    out.push({
      id: `res:${rid}:${r.userId}`,
      text: `${head}${hand}${cards}${hidden} · ${formatSutda2Net(r.net)}`,
    });
  }
  out.push({
    id: `res:${rid}:pot`,
    text: `${view.roundNumber}번째 판 · POT ${view.pot.toLocaleString("ko-KR")}P`,
  });
  return out;
}
