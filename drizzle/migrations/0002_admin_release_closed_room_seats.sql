-- 이미 종료/삭제된 방에 남아 있는 좌석 row(고아 좌석)를 정리하는 운영 함수.
-- 진행 중 라운드나 미정산 판이 있는 방은 건드리지 않는다.
CREATE OR REPLACE FUNCTION public.admin_release_closed_room_seats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _rows int := 0; _rooms int := 0; _r record;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;

  FOR _r IN
    SELECT g.id
      FROM game_rooms g
     WHERE g.status IN ('closed', 'deleted')
       AND EXISTS (SELECT 1 FROM game_room_players p
                    WHERE p.room_id = g.id AND p.seat_status <> 'LEFT')
       AND NOT EXISTS (SELECT 1 FROM game_rounds r
                        WHERE r.room_id = g.id AND r.status NOT IN ('finished', 'cancelled'))
  LOOP
    UPDATE game_room_players
       SET seat_status = 'LEFT', leave_pending = false
     WHERE room_id = _r.id AND seat_status <> 'LEFT';
    _rows := _rows + COALESCE((SELECT count(*)::int FROM game_room_players
                                WHERE room_id = _r.id AND seat_status = 'LEFT'), 0) * 0;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    _rooms := _rooms + 1;
    UPDATE game_rooms SET current_players = 0, current_round_id = NULL WHERE id = _r.id;
    PERFORM angel_finalize_empty_room(_r.id);
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), 'ROOM_SEAT_ORPHAN_CLEANUP', 'room', _r.id,
            '종료된 방의 잔여 좌석 정리', jsonb_build_object('roomId', _r.id));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rooms', _rooms);
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_release_closed_room_seats() TO authenticated;
