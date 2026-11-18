import { useEffect, useRef, useState } from "react";
import type { RoomSeat, ServerRoundState } from "@/lib/services/serverGameService";
import { formatPoints } from "@/lib/services/walletService";
import { rematchReasonLabel } from "@/lib/game/gusaRematch";

export type Sutda2LogKind = "SYSTEM" | "ACTION" | "RESULT";

export interface Sutda2LogEntry {
  id: string;
  kind: Sutda2LogKind;
  text: string;
  at: number;
}

const ACTION_TEXT: Record<string, string> = {
  ante: "기본 베팅",
  check: "체크",
  call: "콜",
  ping: "삥",
  ttadang: "따당",
  quarter: "쿼터",
  half: "하프",
  die: "다이",
  jjol: "쫄",
  all_in: "올인",
};

/**
 * 2장 섯다 진행 로그 (PHASE 2 · 표시 전용).
 *
 * 서버가 확정한 상태(actions / phase / stage / settlement)만 문장으로 바꾼다.
 * 상대의 카드·족보·hidden 정보는 SHOWDOWN(status=finished) 이전에는 기록하지 않는다.
 * 게임 로직·정산·베팅 계산에는 어떤 영향도 주지 않는다.
 */
export function useSutda2EventLog(
  server: ServerRoundState | null,
  roomSeats: readonly RoomSeat[],
): Sutda2LogEntry[] {
  const [entries, setEntries] = useState<Sutda2LogEntry[]>([]);
  const seats = useRef(new Map<string, string>());
  const ready = useRef(new Set<string>());
  const actions = useRef(new Set<string>());
  const phase = useRef<string | null>(null);
  const stage = useRef<number | null>(null);
  const squeezed = useRef(new Set<string>());
  const roundKey = useRef<string | null>(null);
  const finishedKey = useRef<string | null>(null);
  const bootstrapped = useRef(false);

  useEffect(() => {
    const push: Sutda2LogEntry[] = [];
    const now = Date.now();
    const add = (id: string, kind: Sutda2LogKind, text: string) =>
      push.push({ id, kind, text, at: now });

    // ---- 착석 / 퇴장 (서버 좌석 목록 기준) ----
    const current = new Map(roomSeats.filter((s) => !s.isSpectator).map((s) => [s.userId, s.nickname]));
    const first = !bootstrapped.current;
    if (current.size > 0) bootstrapped.current = true;
    for (const [uid, name] of current) {
      if (!seats.current.has(uid) && !first) {
        add(`join:${uid}:${now}`, "SYSTEM", `${name} 님이 착석했습니다.`);
      }
    }
    for (const [uid, name] of seats.current) {
      if (!current.has(uid)) add(`leave:${uid}:${now}`, "SYSTEM", `${name} 님이 게임방에서 나갔습니다.`);
    }
    seats.current = current;

    // ---- 준비(READY) ----
    for (const s of roomSeats) {
      if (s.isSpectator) continue;
      if (s.isReady && !ready.current.has(s.userId)) {
        ready.current.add(s.userId);
        add(`ready:${s.userId}:${now}`, "SYSTEM", `${s.nickname} 님이 준비했습니다.`);
      }
      if (!s.isReady) ready.current.delete(s.userId);
    }

    if (server) {
      const key = server.roundId;
      if (key !== roundKey.current) {
        roundKey.current = key;
        phase.current = null;
        stage.current = null;
        squeezed.current.clear();
        add(`round:${key}`, "SYSTEM", `${server.roundNumber}번째 판이 시작되었습니다.`);
      }

      // ---- 카드 지급 단계 (서버 stage) ----
      const st = Number(server.stage ?? 0);
      if (stage.current === null || st > stage.current) {
        if (st >= 1 && stage.current === null)
          add(`stage1:${key}`, "SYSTEM", "첫 장이 지급되었습니다.");
        else if (st >= 1 && (stage.current ?? 0) < 1)
          add(`stage1:${key}`, "SYSTEM", "첫 장이 지급되었습니다.");
        if (st >= 2 && (stage.current ?? 0) < 2)
          add(`stage2:${key}`, "SYSTEM", "두 번째 장이 지급되었습니다.");
        stage.current = st;
      }

      // ---- 베팅 액션 (서버 확정 기록) ----
      for (const a of server.actions) {
        const id = String(a.id ?? `${a.userId}:${a.type}:${a.amount}`);
        if (actions.current.has(id)) continue;
        actions.current.add(id);
        const name = server.seats.find((s) => s.userId === a.userId)?.nickname ?? "플레이어";
        const label = ACTION_TEXT[String(a.type).toLowerCase()] ?? String(a.type);
        const amount = Number(a.amount ?? 0);
        add(
          `act:${id}`,
          "ACTION",
          amount > 0 ? `${name} · ${label} ${formatPoints(amount)}` : `${name} · ${label}`,
        );
      }

      // ---- 단계 전환 ----
      const p = String(server.phase);
      if (p !== phase.current) {
        phase.current = p;
        const PHASE_TEXT: Record<string, string> = {
          DEALING: "카드를 지급합니다.",
          BETTING: "1차 베팅을 시작합니다.",
          FIRST_BETTING: "1차 베팅을 시작합니다.",
          SQUEEZING: "패 쪼기 단계입니다.",
          FINAL_BETTING: "최종 베팅을 시작합니다.",
        };
        const text = PHASE_TEXT[p];
        if (text) add(`ph:${key}:${p}`, "SYSTEM", text);
        if (p === "SHOWDOWN" || p === "SETTLING") add(`sd:${key}`, "SYSTEM", "쇼다운 — 패를 공개합니다.");
      }

      // ---- 쪼기 완료 (서버 카드 수 기준, 카드값은 기록하지 않음) ----
      if (server.status !== "finished") {
        for (const s of server.seats) {
          if (!s.isMe) continue;
          if (Number(s.cardCount ?? 0) < 2) continue;
          const id = `squeeze:${key}:${s.userId}`;
          if (squeezed.current.has(id)) continue;
          squeezed.current.add(id);
          add(id, "SYSTEM", "두 번째 패를 확인했습니다.");
        }
      }

      // ---- 결과 (서버 정산 확정 후) ----
      if (server.status === "finished" && finishedKey.current !== key) {
        finishedKey.current = key;
        if (server.settlementStatus === "REMATCH" || server.rematch) {
          add(
            `re:${key}`,
            "RESULT",
            server.rematchReason === "GUSA" || server.rematchReason === "GUSA_MEONGTEONG"
              ? `${rematchReasonLabel(server.rematchReason)} 발생 · 판돈 ${formatPoints(Number(server.pot ?? 0))}을 이월하고 재경기를 진행합니다.`
              : `무승부 · 판돈 ${formatPoints(Number(server.pot ?? 0))}을 이월하고 재경기를 진행합니다.`,
          );
        } else {
          const winners = server.seats.filter((s) => s.resultType === "WIN");
          for (const w of winners) {
            const hand = w.handName ? ` · ${w.handName}` : "";
            const gained =
              w.finalPoints !== null && w.initialPoints !== null
                ? Number(w.finalPoints) - Number(w.initialPoints)
                : null;
            add(
              `win:${key}:${w.userId}`,
              "RESULT",
              `${w.nickname} 승리${hand} · POT ${formatPoints(Number(server.pot ?? 0))}` +
                (gained !== null && gained > 0 ? ` (획득 +${formatPoints(gained)})` : ""),
            );
          }
          for (const s of server.seats) {
            if (s.resultType === "WIN" || Number(s.totalBet ?? 0) <= 0) continue;
            add(
              `lose:${key}:${s.userId}`,
              "RESULT",
              `${s.nickname} · -${formatPoints(Number(s.totalBet ?? 0))}${s.folded ? " (다이)" : ""}`,
            );
          }
        }
      }
    }

    if (push.length) setEntries((prev) => [...prev, ...push].slice(-200));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, roomSeats]);

  return entries;
}
