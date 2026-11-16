-- 1) 빈 방 판정/정리: 사람 0 + active round 없음이면 CLOSED 처리 (기록 보존, 좌석 row만 정리)
CREATE OR REPLACE FUNCTION public.angel_finalize_empty_room(_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _people int; _active int;
BEGIN
  PERFORM 1 FROM public.game_rooms WHERE id = _room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT count(*) INTO _people FROM public.game_room_players
   WHERE room_id = _room_id AND seat_status <> 'LEFT';
  SELECT count(*) INTO _active FROM public.game_rounds
   WHERE room_id = _room_id AND status NOT IN ('finished','cancelled');

  IF _people > 0 OR _active > 0 THEN RETURN false; END IF;

  DELETE FROM public.game_room_players WHERE room_id = _room_id;
  UPDATE public.game_rooms
     SET status = 'closed',
         current_players = 0,
         closed_at = COALESCE(closed_at, now()),
         deleted_at = COALESCE(deleted_at, now()),
         close_reason = COALESCE(close_reason, 'EMPTY_ROOM'),
         rematch_pending = false,
         rematch_users = '{}'
   WHERE id = _room_id;
  RETURN true;
END;
$$;

-- 2) close_or_hold_room: 빈 방 정리 + 방장 자동 이전
CREATE OR REPLACE FUNCTION public.close_or_hold_room(_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int; _spec int; _next text; _host uuid; _new_host uuid;
BEGIN
  SELECT count(*) INTO _n FROM public.game_room_players
   WHERE room_id=_room_id AND is_spectator=false AND leave_pending=false AND seat_status <> 'LEFT';
  SELECT count(*) INTO _spec FROM public.game_room_players
   WHERE room_id=_room_id AND is_spectator=true AND seat_status <> 'LEFT';

  IF _n = 0 AND _spec = 0 THEN
    PERFORM public.angel_finalize_empty_room(_room_id);
    RETURN 'closed';
  END IF;

  -- 방장 자동 이전 (방장이 더 이상 유효한 좌석이 아닐 때)
  SELECT host_id INTO _host FROM public.game_rooms WHERE id = _room_id;
  IF _host IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.game_room_players
     WHERE room_id=_room_id AND user_id=_host AND is_spectator=false
       AND leave_pending=false AND seat_status <> 'LEFT'
  ) THEN
    SELECT user_id INTO _new_host FROM public.game_room_players
     WHERE room_id=_room_id AND is_spectator=false AND leave_pending=false AND seat_status <> 'LEFT'
     ORDER BY joined_at ASC, seat ASC LIMIT 1;
    IF _new_host IS NOT NULL AND _new_host <> _host THEN
      UPDATE public.game_rooms SET host_id = _new_host WHERE id = _room_id;
    END IF;
  END IF;

  IF public.ops_flag('game_lock') OR public.ops_flag('maintenance_enabled') THEN
    _next := 'paused';
  ELSIF _n < 2 THEN
    _next := 'waiting';
  ELSE
    _next := 'playing';
  END IF;
  UPDATE public.game_rooms SET status = _next WHERE id = _room_id;
  RETURN _next;
END;
$$;

-- 3) 좌석 삭제/이탈 시 자동 재판정 (idempotent, 재귀 방지)
CREATE OR REPLACE FUNCTION public.angel_auto_cleanup_room_on_seat_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _room uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  _room := COALESCE(OLD.room_id, NEW.room_id);
  PERFORM public.angel_finalize_empty_room(_room);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_angel_auto_cleanup_room ON public.game_room_players;
CREATE TRIGGER trg_angel_auto_cleanup_room
AFTER DELETE OR UPDATE OF seat_status ON public.game_room_players
FOR EACH ROW EXECUTE FUNCTION public.angel_auto_cleanup_room_on_seat_change();

-- 4) 일괄 정리 함수 강화 (cancelled 라운드 허용, 남은 좌석 row 정리, 테스트방 동일 적용)
CREATE OR REPLACE FUNCTION public.cleanup_empty_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int := 0; _r record;
BEGIN
  FOR _r IN
    SELECT id FROM public.game_rooms r
     WHERE (r.status <> 'closed' OR r.deleted_at IS NULL
            OR EXISTS (SELECT 1 FROM public.game_room_players p WHERE p.room_id = r.id))
       AND NOT EXISTS (
         SELECT 1 FROM public.game_room_players p
          WHERE p.room_id = r.id AND p.seat_status <> 'LEFT')
       AND NOT EXISTS (
         SELECT 1 FROM public.game_rounds g
          WHERE g.room_id = r.id AND g.status NOT IN ('finished','cancelled'))
  LOOP
    IF public.angel_finalize_empty_room(_r.id) THEN _n := _n + 1; END IF;
  END LOOP;
  RETURN _n;
END;
$$;

-- 5) 현재 남아있는 빈 방 즉시 정리
SELECT public.cleanup_empty_rooms();