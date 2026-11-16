import { useEffect, useRef } from "react";
import { playTurnAlert, type TurnAlertKind } from "@/lib/services/gameSound";

/**
 * useMyTurnAlert — "내 턴" 음성 알림 (UX 전용).
 *
 * 원칙
 * - 턴 판정은 100% 서버 authoritative turn state 기준 값을 그대로 받는다 (클라이언트 추정 금지).
 * - 같은 turnKey(round/phase/deadline 조합)에서는 1회만 재생한다.
 *   rerender / Realtime 중복 이벤트 / refetch / timer tick 으로 재생되지 않는다.
 * - 새로고침·재접속 후 이미 진행 중인 같은 턴에서도 (마운트당) 1회만 재생된다.
 * - 사운드 OFF 이면 아무것도 재생하지 않는다.
 * - 재생 실패는 조용히 무시되며 게임 진행에 영향을 주지 않는다.
 */
export function useMyTurnAlert({
  enabled,
  active,
  turnKey,
  kind = "TURN",
}: {
  /** 사운드 ON/OFF */
  enabled: boolean;
  /** 실제로 내가 행동해야 하는 턴/단계인지 (서버 상태 기준) */
  active: boolean;
  /** 서버 턴 식별자 — null 이면 알림 없음 */
  turnKey: string | null;
  kind?: TurnAlertKind;
}) {
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !turnKey) {
      if (!active) lastKey.current = null;
      return;
    }
    if (lastKey.current === turnKey) return;
    lastKey.current = turnKey;
    if (!enabled) return;
    playTurnAlert(kind, turnKey);
  }, [enabled, active, turnKey, kind]);
}
