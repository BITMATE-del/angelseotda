/**
 * 게임방 조회 컬럼 화이트리스트.
 * 보안: `password_hash`(방 비밀번호 해시)는 클라이언트에 절대 내려가지 않는다.
 * (DB에서도 anon/authenticated 조회 권한이 회수되어 있어 `select("*")` 는 거부된다)
 */
export const GAME_ROOM_COLUMNS =
  "id, title, game_mode, host_id, max_players, current_players, min_points, base_bet, friends_only, spectator_enabled, status, created_at, room_type, channel_no, visibility, room_code, is_test_room, room_number, carry_pot, current_round_id, rematch_pending, rematch_users, carry_caps, closed_at, deleted_at, close_reason, ready_required" as const;
