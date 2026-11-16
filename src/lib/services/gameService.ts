/**
 * gameService — 방 입장/좌석/접속 유지 등 서버 RPC 래퍼.
 * 게임 진행(셔플·베팅·판정·정산)은 serverGameService.ts + DB RPC가 전담한다.
 */
import { supabase } from "@/integrations/supabase/client";

/** 좌석 직접 선택 (동시 클릭은 서버 lock으로 한 명만 성공) */
export async function selectSeat(roomId: string, seat: number) {
  const { data, error } = await supabase.rpc("select_seat", { _room_id: roomId, _seat: seat });
  if (error) throw error;
  return data as number;
}

/** 접속 유지 신호 (재접속 유예 해제) */
export async function sendHeartbeat(roomId: string) {
  await supabase.rpc("game_heartbeat", { _room_id: roomId });
}

/** 이탈 알림 — 유예시간 내 복귀하면 그대로 복구된다 */
export async function markDisconnected(roomId: string, graceSeconds = 30) {
  await supabase.rpc("mark_disconnected", {
    _room_id: roomId,
    _grace_seconds: graceSeconds,
  });
}

/** 새로고침/재로그인 후 진행 중인 내 게임 조회 (없으면 null → 로비) */
export interface ActiveGameInfo {
  room_id: string;
  round_id: string | null;
  seat: number | null;
  room_title: string;
  game_mode: string;
}

export async function fetchMyActiveGame(): Promise<ActiveGameInfo | null> {
  const { data, error } = await supabase.rpc("my_active_game");
  if (error) throw error;
  const row = (data ?? [])[0] as ActiveGameInfo | undefined;
  return row ?? null;
}

/** 재접속 유예 초과자 자동 다이 (호스트가 주기적으로 호출) */
export async function expireDisconnectedPlayers(roundId: string) {
  const { data } = await supabase.rpc("expire_disconnected_players", { _round_id: roundId });
  return data ?? 0;
}

