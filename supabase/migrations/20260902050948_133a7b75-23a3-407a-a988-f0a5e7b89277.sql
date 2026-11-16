-- 잔액 부족(오링) 회원 자동 퇴장 처리
CREATE OR REPLACE FUNCTION public.enforce_room_min_balance(_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _min bigint;
  _removed jsonb := '[]'::jsonb;
  _r record;
  _nick text;
  _room_no int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;

  SELECT min_points, room_number INTO _min, _room_no
    FROM public.game_rooms WHERE id = _room_id;
  IF _min IS NULL THEN
    RETURN jsonb_build_object('minPoints', NULL, 'removed', _removed);
  END IF;

  -- 진행 중인 판이 있으면 좌석을 건드리지 않는다 (정산 완료 후에만 정리)
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'ROUND_ACTIVE');
  END IF;

  -- READY 상태 먼저 해제 (잔액 부족자가 다음 판에 참여하지 못하게 한다)
  UPDATE public.game_room_players p
     SET is_ready = false, ready_at = NULL
   WHERE p.room_id = _room_id
     AND p.is_spectator = false
     AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p.user_id AND pr.game_points < _min);

  FOR _r IN
    SELECT p.user_id, pr.game_points, pr.nickname
      FROM public.game_room_players p
      JOIN public.profiles pr ON pr.id = p.user_id
     WHERE p.room_id = _room_id AND p.is_spectator = false AND pr.game_points < _min
  LOOP
    DELETE FROM public.game_room_players WHERE room_id=_room_id AND user_id=_r.user_id;
    _removed := _removed || jsonb_build_object(
      'userId', _r.user_id, 'points', _r.game_points, 'nickname', _r.nickname);
    _nick := COALESCE(_r.nickname, '플레이어');
    INSERT INTO public.chat_messages (room_id, user_id, message, kind)
    VALUES (_room_id, NULL, _nick || '님이 보유 포인트 부족으로 퇴장했습니다.', 'system');
    BEGIN
      PERFORM public.log_room_event(
        _room_id, NULL, _r.user_id, 'BALANCE_INSUFFICIENT_EXIT',
        jsonb_build_object('points', _r.game_points),
        jsonb_build_object('minPoints', _min));
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;

  IF jsonb_array_length(_removed) > 0 THEN
    UPDATE public.game_rooms r
       SET current_players = (SELECT count(*) FROM public.game_room_players p
                               WHERE p.room_id=r.id AND p.is_spectator=false)
     WHERE r.id = _room_id;
    PERFORM public.close_or_hold_room(_room_id);
    PERFORM public.cleanup_empty_rooms();
  END IF;

  RETURN jsonb_build_object('minPoints', _min, 'removed', _removed);
END; $function$;

REVOKE ALL ON FUNCTION public.enforce_room_min_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_room_min_balance(uuid) TO authenticated, service_role;

-- READY 자체를 잔액 부족 회원에게 허용하지 않는다
CREATE OR REPLACE FUNCTION public.set_room_ready(_room_id uuid, _ready boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _nick text;
  _seated int;
  _ready_cnt int;
  _min bigint;
  _bal bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RAISE EXCEPTION '진행 중인 판이 있습니다.';
  END IF;

  SELECT min_points INTO _min FROM public.game_rooms WHERE id=_room_id;
  SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;
  IF _ready AND _min IS NOT NULL AND COALESCE(_bal,0) < _min THEN
    RAISE EXCEPTION '보유 포인트가 부족하여 준비할 수 없습니다. 최소 입장 포인트는 %P입니다.', _min;
  END IF;

  UPDATE public.game_room_players
     SET is_ready = _ready,
         ready_at = CASE WHEN _ready THEN now() ELSE NULL END
   WHERE room_id = _room_id AND user_id = _uid AND is_spectator = false;
  IF NOT FOUND THEN RAISE EXCEPTION '착석한 플레이어만 준비할 수 있습니다.'; END IF;

  SELECT nickname INTO _nick FROM public.profiles WHERE id = _uid;
  INSERT INTO public.chat_messages (room_id, user_id, message, kind)
  VALUES (_room_id, NULL, COALESCE(_nick,'플레이어') || (CASE WHEN _ready THEN '님이 준비 완료했습니다.' ELSE '님이 준비를 취소했습니다.' END), 'system');

  SELECT count(*) FILTER (WHERE is_spectator=false AND leave_pending=false),
         count(*) FILTER (WHERE is_spectator=false AND leave_pending=false AND is_ready)
    INTO _seated, _ready_cnt
    FROM public.game_room_players WHERE room_id = _room_id;

  RETURN jsonb_build_object('seated', _seated, 'ready', _ready_cnt, 'allReady', _seated >= 2 AND _seated = _ready_cnt);
END; $function$;