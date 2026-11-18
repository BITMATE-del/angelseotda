REVOKE SELECT ON public.game_room_players FROM authenticated;
GRANT SELECT (id, room_id, user_id, seat, ready, is_spectator, joined_at, seat_status,
              connection_status, last_seen_at, leave_pending, leave_requested_at,
              is_ready, ready_at, missed_turn_count)
  ON public.game_room_players TO authenticated;

REVOKE SELECT ON public.dori_room_players FROM authenticated;
GRANT SELECT (id, room_id, user_id, seat, is_ready, ready_at, leave_pending,
              leave_requested_at, connection_status, missed_turn_count,
              last_seen_at, joined_at)
  ON public.dori_room_players TO authenticated;