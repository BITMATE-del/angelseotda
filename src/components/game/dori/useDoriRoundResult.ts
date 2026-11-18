/**
 * PHASE 4.1 — 결과 오버레이 표시 제어 (프레젠테이션 전용).
 *
 * 이 훅은 서버 game state 를 "관찰만" 한다.
 * - 게임 RPC 를 호출하지 않는다
 * - polling / realtime / 다음 판 진행을 절대 막지 않는다
 * - 결과창 표시 여부가 라운드 진행 조건으로 쓰이지 않는다
 * 새 라운드가 먼저 시작되면 최소 표시시간 후 자동으로 닫힌다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildDoriResultView, type DoriResultView } from "@/lib/game/dori/doriResultView";
import { fetchDoriRoundResult, type DoriRoomState } from "@/lib/services/doriService";

/** 코인 연출(POT→승자) 이후에 오버레이를 띄운다 */
const SHOW_DELAY_MS = 800;
/** 사용자가 충분히 읽을 시간 */
const VISIBLE_MS = 3000;
/** 폴드승 공개 여부를 고를 수 있는 시간 (미선택 = 비공개 유지) */
const CHOICE_MS = 6000;
/** 새 라운드가 먼저 와도 최소 이 시간은 보여준다 */
const MIN_VISIBLE_MS = 1200;

export function useDoriRoundResult(data: DoriRoomState | undefined, myUserId: string | null) {
  const [view, setView] = useState<DoriResultView | null>(null);
  /** round_id 기준 dedupe — realtime/refetch 로 같은 정산이 여러 번 들어와도 1회만 */
  const handled = useRef(new Set<string>());
  /** 최초 관찰한 정산 라운드 (새로고침 직후 지난 결과 재표시 방지) */
  const initialKey = useRef<string | null | undefined>(undefined);
  const mounted = useRef(true);
  const shownAt = useRef(0);
  const shownRoundId = useRef<string | null>(null);
  const hideTimer = useRef(0);

  const round = data?.round ?? null;
  const finished =
    !!round && round.status === "FINISHED" && round.settlementStatus !== "PENDING"
      ? `${round.roundId}:${round.settlementStatus}`
      : null;
  const currentRoundId = round?.roundId ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 새 라운드가 먼저 시작되면 최소 표시시간 후 자연스럽게 종료한다.
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
    if (!data || !myUserId) return undefined;
    // 최초 관찰 시점의 정산 라운드는 표시하지 않는다 (이미 지난 판).
    if (initialKey.current === undefined) {
      initialKey.current = finished;
      if (finished) handled.current.add(finished);
    }
    if (!finished || !round) return undefined;
    if (handled.current.has(finished)) return undefined;

    handled.current.add(finished);

    let showTimer = 0;
    const roundId = round.roundId;
    void fetchDoriRoundResult(roundId)
      .then((result) => {
        const next = buildDoriResultView(result, myUserId);
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

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, myUserId, !!data]);

  /** 공개 선택 후 서버 결과를 다시 읽어 공개된 패를 반영한다 (표시 전용) */
  const refresh = useCallback(async () => {
    const roundId = shownRoundId.current;
    if (!roundId || !myUserId) return;
    try {
      const next = buildDoriResultView(await fetchDoriRoundResult(roundId), myUserId);
      if (next && mounted.current) {
        setView(next);
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => {
          if (mounted.current) setView(null);
        }, VISIBLE_MS);
      }
    } catch {
      /* 결과 재조회 실패는 게임 진행에 영향을 주지 않는다 */
    }
  }, [myUserId]);

  return { view, refresh };
}
