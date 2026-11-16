import { useEffect, useRef } from "react";
import { playAction, playEvent, playGameSound } from "@/lib/services/gameSound";
import type { DoriRoomState } from "@/lib/services/doriService";

/** 도리 베팅 액션 → 기존 섯다 사운드 액션 코드 (사운드 에셋 재사용) */
const ACTION_CODE: Record<string, string> = {
  CHECK: "check",
  CALL: "call",
  PING: "ping",
  TTADANG: "ttadang",
  QUARTER: "quarter",
  HALF: "half",
  ALL_IN: "all_in",
  DIE: "die",
  FOLD: "die",
  ANTE: "ante",
  // 구 액션명 기록 호환
  BET: "ping",
  RAISE: "ttadang",
};

/**
 * 도리 전용 사운드 — 서버가 확정한 상태 변화에서만 재생한다.
 * (게임 로직은 건드리지 않고 상태를 관찰만 한다)
 */
export function useDoriSound(data: DoriRoomState | undefined, enabled: boolean) {
  const seen = useRef(new Set<string>());
  const prevPhase = useRef<string | null>(null);
  const prevCards = useRef(0);
  const prevPot = useRef(0);
  const prevRound = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !data) return;
    const round = data.round;
    const roundId = round?.roundId ?? null;

    if (roundId !== prevRound.current) {
      prevRound.current = roundId;
      prevPhase.current = null;
      prevCards.current = 0;
      prevPot.current = 0;
      seen.current = new Set();
      if (roundId) playEvent("ROUND_START", roundId);
    }

    // 베팅 액션 (서버 action id 기준 1회)
    const myId = data.seats.find((s) => s.isMe)?.userId;
    for (const a of data.actions) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      const code = ACTION_CODE[a.type.toUpperCase()];
      if (code) playAction(code, `dori:${a.id}`, a.userId === myId);
    }

    // 카드 지급
    const myCards = data.myCards.length;
    if (myCards > prevCards.current) {
      playGameSound("card-deal");
      prevCards.current = myCards;
    } else if (myCards < prevCards.current) {
      prevCards.current = myCards;
    }

    // POT 증가
    const pot = round?.pot ?? 0;
    if (pot > prevPot.current) {
      if (prevPot.current > 0) playGameSound("pot-impact");
      prevPot.current = pot;
    } else if (pot < prevPot.current) {
      prevPot.current = pot;
    }

    // 단계 전환
    const phase = round?.phase ?? null;
    if (phase && phase !== prevPhase.current) {
      const prev = prevPhase.current;
      prevPhase.current = phase;
      if (phase === "MAKE_SELECTION") playGameSound("hand-submit");
      if (phase === "SHOWDOWN") playEvent("SHOWDOWN", `${roundId}`);
      if (phase === "FINISHED" && prev !== "FINISHED") {
        if (round?.settlementStatus === "REMATCH") playEvent("REMATCH", `${roundId}`);
        else {
          const me = data.seats.find((s) => s.isMe);
          playEvent(me?.resultType === "WIN" ? "WINNER" : "POT_WIN", `${roundId}`);
        }
      }
    }
  }, [data, enabled]);
}
