/**
 * 게임 중 좌석 위에 잠깐 뜨는 일시적 리액션(이모티콘).
 *
 * ⚠︎ 저장하지 않는다 — chat_messages / 게임로그 / 관리자 activity log 에 남기지 않고
 * Realtime broadcast 로만 전달되는 순수 UI 연출이다. (과거에 저장된 로그는 건드리지 않는다)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** 좌석 위 표시 유지 시간 (1~2초) */
export const REACTION_LIFETIME_MS = 1600;
/** 중복 클릭 방지 쿨다운 */
export const REACTION_COOLDOWN_MS = 1600;

export function useRoomReactions(roomId: string) {
  const [items, setItems] = useState<Record<string, { code: string; at: number }>>({});
  const [tick, setTick] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const cooldownRef = useRef(0);

  useEffect(() => {
    const channel = supabase
      .channel(`room-reaction:${roomId}`, { config: { broadcast: { self: true } } })
      .on("broadcast", { event: "reaction" }, (msg) => {
        const payload = (msg as { payload?: { userId?: string; code?: string } }).payload;
        if (!payload?.userId || !payload.code) return;
        setItems((prev) => ({
          ...prev,
          [payload.userId!]: { code: payload.code!, at: Date.now() },
        }));
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 400);
    return () => clearInterval(timer);
  }, []);

  /** userId → 최신 리액션 코드 (약 1.6초만 유지되고 사라진다) */
  const reactions = useMemo(() => {
    void tick;
    const now = Date.now();
    const out: Record<string, string> = {};
    for (const [userId, item] of Object.entries(items)) {
      if (now - item.at <= REACTION_LIFETIME_MS) out[userId] = item.code;
    }
    return out;
  }, [items, tick]);

  /** 리액션 전송 — DB 저장 없이 broadcast 만 수행하며 쿨다운 중에는 무시한다 */
  const send = useCallback((userId: string, code: string) => {
    const now = Date.now();
    if (now - cooldownRef.current < REACTION_COOLDOWN_MS) return false;
    cooldownRef.current = now;
    void channelRef.current?.send({
      type: "broadcast",
      event: "reaction",
      payload: { userId, code },
    });
    return true;
  }, []);

  return { reactions, send };
}
