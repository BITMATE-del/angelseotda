-- 오링/잔액 부족 자동 퇴장: 정산 완료 직후 서버가 최신 잔액으로 판정하고 좌석까지 제거한다.
CREATE OR REPLACE FUNCTION public.enforce_room_balance_eligibility(_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _min bigint;
  _room public.game_rooms;
  _removed jsonb := '[]'::jsonb;
  _r record;
  _reason text;
  _left int;
  _new_host uuid;
BEGIN
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;
  IF _room.id IS NULL THEN
    RETURN jsonb_build_object('minPoints', NULL, 'removed', _removed, 'skipped', 'NO_ROOM');
  END IF;
  _min := GREATEST(COALESCE(_room.min_points, 0), 0);

  -- 진행 중인 판이 있으면 절대 좌석을 건드리지 않는다 (PLAYING/BETTING/SHOWDOWN/SETTLING 보호)
  IF EXISTS (SELECT 1 FROM public.game_rounds
              WHERE room_id = _room_id AND status <> 'finished') THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'ROUND_ACTIVE');
  END IF;

  -- 1) 잔액 부족자는 먼저 READY 해제 (다음 판 참여 차단)
  UPDATE public.game_room_players p
     SET is_ready = false, ready_at = NULL
   WHERE p.room_id = _room_id
     AND p.is_spectator = false
     AND EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.id = p.user_id
                    AND (pr.game_points <= 0 OR pr.game_points < _min));

  -- 2) 최신 DB 잔액 기준으로 좌석 제거
  FOR _r IN
    SELECT p.user_id, p.seat, pr.game_points, pr.nickname
      FROM public.game_room_players p
      JOIN public.profiles pr ON pr.id = p.user_id
     WHERE p.room_id = _room_id
       AND p.is_spectator = false
       AND (pr.game_points <= 0 OR pr.game_points < _min)
     ORDER BY p.seat
  LOOP
    _reason := CASE WHEN COALESCE(_r.game_points,0) <= 0
                    THEN 'ZERO_BALANCE' ELSE 'BELOW_ROOM_MINIMUM' END;
    DELETE FROM public.game_room_players
     WHERE room_id = _room_id AND user_id = _r.user_id;

    _removed := _removed || jsonb_build_object(
      'userId', _r.user_id, 'points', _r.game_points,
      'nickname', _r.nickname, 'reason', _reason);

    INSERT INTO public.chat_messages (room_id, user_id, message, kind)
    VALUES (_room_id, NULL,
      COALESCE(_r.nickname, '플레이어') || '님이 잔액 부족으로 퇴장했습니다.', 'system');

    BEGIN
      PERFORM public.log_room_event(
        _room_id, 'AUTO_ROOM_KICK', _r.user_id, NULL, _r.seat, NULL, NULL, NULL,
        jsonb_build_object('balance', _r.game_points, 'nickname', _r.nickname,
                           'roomNumber', _room.room_number),
        jsonb_build_object('minimumRequired', _min, 'reason', _reason),
        NULL, 'OK', _reason);
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;

  IF jsonb_array_length(_removed) = 0 THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed);
  END IF;

  -- 3) 남은 인원 재계산
  SELECT count(*) INTO _left FROM public.game_room_players
   WHERE room_id = _room_id AND is_spectator = false;
  UPDATE public.game_rooms SET current_players = _left WHERE id = _room_id;

  -- 4) 재경기 대상이 2명 미만이 되면 재경기 해제 (carry POT은 다음 판으로 이월 유지)
  IF COALESCE(_room.rematch_pending, false) THEN
    IF (SELECT count(*) FROM public.game_room_players p
         WHERE p.room_id = _room_id AND p.is_spectator = false
           AND p.user_id = ANY(_room.rematch_users)) < 2 THEN
      UPDATE public.game_rooms
         SET rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
       WHERE id = _room_id;
    END IF;
  END IF;

  -- 5) 방장이 퇴장했으면 남은 회원에게 이전
  IF NOT EXISTS (SELECT 1 FROM public.game_room_players
                  WHERE room_id = _room_id AND user_id = _room.host_id AND is_spectator = false) THEN
    SELECT user_id INTO _new_host FROM public.game_room_players
     WHERE room_id = _room_id AND is_spectator = false ORDER BY seat LIMIT 1;
    IF _new_host IS NOT NULL THEN
      UPDATE public.game_rooms SET host_id = _new_host WHERE id = _room_id;
    END IF;
  END IF;

  PERFORM public.close_or_hold_room(_room_id);
  PERFORM public.cleanup_empty_rooms();

  RETURN jsonb_build_object('minPoints', _min, 'removed', _removed);
END; $function$;

REVOKE ALL ON FUNCTION public.enforce_room_balance_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_room_balance_eligibility(uuid) TO authenticated, service_role;

-- 클라이언트용 래퍼: 인증 확인 후 동일 서버 로직 재사용
CREATE OR REPLACE FUNCTION public.enforce_room_min_balance(_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  RETURN public.enforce_room_balance_eligibility(_room_id);
END; $function$;

REVOKE ALL ON FUNCTION public.enforce_room_min_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_room_min_balance(uuid) TO authenticated, service_role;

-- 라운드가 finished로 확정되는 순간(정산 commit 시점) 서버가 자동으로 eligibility 정리
CREATE OR REPLACE FUNCTION public.trg_round_finished_balance_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'finished' AND COALESCE(OLD.status,'') <> 'finished' THEN
    BEGIN
      PERFORM public.enforce_room_balance_eligibility(NEW.room_id);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS round_finished_balance_eligibility ON public.game_rounds;
CREATE TRIGGER round_finished_balance_eligibility
AFTER UPDATE OF status ON public.game_rounds
FOR EACH ROW EXECUTE FUNCTION public.trg_round_finished_balance_eligibility();