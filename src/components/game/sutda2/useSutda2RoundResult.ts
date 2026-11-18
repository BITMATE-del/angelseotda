/**
 * SUTDA 2 CARD PHASE 4 — 결과 오버레이 표시 제어 (프레젠테이션 전용).
 *
 * 이 훅은 서버 상태를 "관찰만" 한다.
 * - 게임 RPC 를 호출하지 않는다 (공개 선택은 route 의 기존 핸들러가 담당)
 * - polling / realtime / 다음 판 진행을 절대 막지 않는다
 * - 결과창 표시/닫힘이 서버 state 전환 조건이 되지 않는다
 * 새 라운드가 먼저 시작되면 최소 표시시간 후 스스로 닫힌다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildSutda2ResultView, type Sutda2ResultView } from "@/lib/game/sutda2Result";
import {
  fetchSutdaRoundResult,
  type ServerRoundState,
} from "@/lib/services/serverGameService";

/** POT→승자 코인 연출(PHASE 3) 이후에 결과창을 띄운다 */
const SHOW_DELAY_MS = 900;
/** 일반 결과 표시 시간 */
const VISIBLE_MS = 3200;
/** 폴드승 공개 선택 시간 (서버 마감 5초 + 여유) */
const CHOICE_MS = 6500;
/** 새 라운드가 먼저 와도 최소 이 시간은 보여준다 */
const MIN_VISIBLE_MS = 1200;

export function useSutda2RoundResult(
  server: ServerRoundState | null,
  myUserId: string | null,
  enabled: boolean,
) {
  const [view, setView] = useState<Sutda2ResultView | null>(null);
  /** round id 기준 dedupe — realtime/refetch/새로고침으로 같은 정산이 다시 들어와도 1회만 */
  const handled = useRef(new Set<string>());
  /** 최초 관찰한 정산 라운드 (새로고침 직후 지난 결과 재표시 방지) */
  const initialKey = useRef<string | null | undefined>(undefined);
  const mounted = useRef(true);
  const shownAt = useRef(0);
  const shownRoundId = useRef<string | null>(null);
  const hideTimer = useRef(0);

  const finished =
    !!server && server.status === "finished" && server.settlementStatus !== "PENDING"
      ? `${server.roundId}:${server.settlementStatus}`
      : null;
  const currentRoundId = server?.roundId ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  // 새 라운드가 먼저 시작되면 최소 표시시간 후 종료한다 (진행을 막지 않는다).
  useEffect(() => {
    if (!view || !shownRoundId.current) return undefined;
    if (!currentRoundId || currentRoundId === shownRoundId.current) return undefined;
    const rest = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current));
    const t = window.setTimeout(() => {
      if (mounted.current) setView(null);
    }, rest);
    return () => window.clearTimeout(t);
  }, [currentRoundId, view]);

  useEffect(() => {
    if (!enabled || !myUserId) return undefined;
    // 최초 관찰 시점의 정산 라운드는 표시하지 않는다 (이미 지난 판)
    if (initialKey.current === undefined) {
      initialKey.current = finished;
      if (finished) handled.current.add(finished);
    }
    if (!finished || !server) return undefined;
    if (handled.current.has(finished)) return undefined;
    handled.current.add(finished);

    let showTimer = 0;
    const roundId = server.roundId;
    void fetchSutdaRoundResult(roundId)
      .then((result) => {
        const next = buildSutda2ResultView(result, myUserId);
        if (!next || !mounted.current) return;
        showTimer = window.setTimeout(() => {
          if (!mounted.current) return;
          shownAt.current = Date.now();
          shownRoundId.current = roundId;
          setView(next);
          hideTimer.current = window.setTimeout(
            () => {
              if (mounted.current) setView(null);
            },
            next.canChooseReveal ? CHOICE_MS : VISIBLE_MS,
          );
        }, SHOW_DELAY_MS);
      })
      .catch(() => undefined);

    return () => window.clearTimeout(showTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, myUserId, enabled]);

  /** 공개 선택 후 서버 결과를 다시 읽어 공개된 패를 반영한다 (표시 전용) */
  const refresh = useCallback(async () => {
    const roundId = shownRoundId.current;
    if (!roundId || !myUserId) return;
    try {
      const next = buildSutda2ResultView(await fetchSutdaRoundResult(roundId), myUserId);
      if (!next || !mounted.current) return;
      setView(next);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (mounted.current) setView(null);
      }, VISIBLE_MS);
    } catch {
      /* 결과 재조회 실패는 게임 진행에 영향을 주지 않는다 */
    }
  }, [myUserId]);

  /**
   * 서버 공개 선택(foldWinChoice)이 바뀌면 모든 참가자 화면에서 결과를 다시 읽는다.
   * 공개 여부의 source of truth 는 서버이며, local 기본값이 이를 덮어쓰지 않는다.
   */
  const revealChoice = server?.foldWinChoice ?? null;
  useEffect(() => {
    if (!revealChoice || !shownRoundId.current) return;
    if (shownRoundId.current !== currentRoundId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealChoice, currentRoundId]);

  return { view, refresh };
}
