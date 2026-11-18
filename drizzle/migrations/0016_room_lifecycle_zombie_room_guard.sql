-- 방 생성 직후(좌석 배정 전) 빈 방으로 오인되어 종료/삭제되는 race 를 막고,
-- 종료된 방에 재착석하는 zombie 상태를 서버에서 차단한다.
-- 게임 코어(베팅/정산/카드/POT/사이드팟/재경기)는 변경하지 않는다.

CREATE OR REPLACE FUNCTION public.angel_finalize_empty_room(_room_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _people int; _active int; _room public.game_rooms;
BEGIN
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RETURN false; END IF;

  -- 좌석 배정 유예: 방 생성 직후에는 아직 join_room 이 완료되지 않았을 수 있다.
  -- (판이 한 번도 없었던 신규 방에만 적용 — 실제 빈 방 정리는 유예 후 다시 수행된다)
  IF now() - _room.created_at < interval '60 seconds'
     AND NOT EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id = _room_id) THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO _people FROM public.game_room_players
   WHERE room_id = _room_id AND seat_status <> 'LEFT';
  SELECT count(*) INTO _active FROM public.game_rounds
   WHERE room_id = _room_id AND status NOT IN ('finished','cancelled');

  IF _people > 0 OR _active > 0 THEN RETURN false; END IF;

  DELETE FROM public.game_room_players WHERE room_id = _room_id;

  BEGIN
    PERFORM public.log_room_event(
      _room_id, 'ROOM_FINALIZED', NULL, NULL, NULL, NULL, NULL, NULL,
      jsonb_build_object('status', _room.status, 'currentPlayers', _room.current_players),
      jsonb_build_object('status', 'closed', 'reason', 'EMPTY_ROOM'),
      NULL, 'OK', NULL);
  EXCEPTION WHEN others THEN NULL;
  END;

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
$function$;

CREATE OR REPLACE FUNCTION public.join_room(_room_id uuid, _spectator boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _room game_rooms; _rt room_types; _p profiles; _seat integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;

  -- 이미 종료/삭제된 방에는 착석하지 않는다 (좌석이 되살아나는 zombie 방 차단)
  SELECT seat INTO _seat FROM game_room_players WHERE room_id = _room_id AND user_id = _uid;
  IF _seat IS NOT NULL THEN RETURN _seat; END IF;

  IF _room.deleted_at IS NOT NULL OR _room.status IN ('closed','deleted') THEN
    RAISE EXCEPTION '이미 종료된 방입니다. 로비에서 다시 입장해 주세요.';
  END IF;

  SELECT * INTO _rt FROM room_types WHERE id = _room.room_type;
  SELECT * INTO _p FROM profiles WHERE id = _uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION '회원 정보를 찾을 수 없습니다.'; END IF;
  IF _p.status = 'suspended' THEN RAISE EXCEPTION '이용이 정지된 계정입니다.'; END IF;

  IF public.ops_flag('maintenance_enabled') AND NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '현재 서버 점검 중입니다. 진행 중인 게임은 정상 종료되며 새로운 게임 입장은 잠시 제한됩니다.';
  END IF;

  IF _room.is_test_room AND NOT _p.is_test_user AND NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '테스트 전용 방입니다. 테스트 계정만 입장할 수 있습니다.';
  END IF;
  IF NOT _room.is_test_room AND _p.is_test_user AND public.ops_flag('game_lock') THEN
    RAISE EXCEPTION '현재 신규 게임 입장이 제한되어 있습니다.';
  END IF;

  IF NOT _spectator AND _rt.id IS NOT NULL THEN
    IF NOT _rt.active THEN RAISE EXCEPTION '%은 현재 이용할 수 없습니다.', _rt.name; END IF;
    IF _p.game_points < _rt.min_points THEN
      RAISE EXCEPTION '% 입장을 위해 최소 %P가 필요합니다.', _rt.name, to_char(_rt.min_points, 'FM999,999,999');
    END IF;
  END IF;

  IF NOT _spectator THEN
    IF (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false) >= _room.max_players THEN
      RAISE EXCEPTION '방 정원이 가득 찼습니다.';
    END IF;
  END IF;

  -- 좌석번호는 1..max_players 로 고정한다 (빈 좌석만 채운다)
  SELECT COALESCE(min(s.n), 1) INTO _seat
  FROM generate_series(1, GREATEST(_room.max_players, 1)) AS s(n)
  WHERE NOT EXISTS (SELECT 1 FROM game_room_players gp
    WHERE gp.room_id = _room_id AND gp.seat = s.n);

  INSERT INTO game_room_players (room_id, user_id, seat, is_spectator, entry_balance_snapshot)
  VALUES (_room_id, _uid, _seat, _spectator, _p.game_points);

  UPDATE game_rooms SET current_players =
    (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
  WHERE id = _room_id;

  BEGIN
    PERFORM public.log_room_event(
      _room_id, 'SEAT_JOINED', _uid, NULL, _seat, NULL, NULL, NULL,
      jsonb_build_object('roomStatus', _room.status),
      jsonb_build_object('seat', _seat, 'spectator', _spectator),
      NULL, 'OK', NULL);
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN _seat;
END; $function$;