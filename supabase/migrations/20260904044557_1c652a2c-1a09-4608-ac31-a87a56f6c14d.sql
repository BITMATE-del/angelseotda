ALTER TABLE public.game_room_players
  ADD COLUMN IF NOT EXISTS missed_turn_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_balance_snapshot bigint;

-- 1) 칭호 slot: 계급 보상 아이템(계급명 배지/훈장)은 칭호로 취급하지 않는다
CREATE OR REPLACE FUNCTION public.equipped_item_asset(_user_id uuid, _category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r jsonb;
BEGIN
  IF _category = 'title' THEN
    SELECT jsonb_build_object('name', c.title_text, 'assetUrl', NULL, 'itemId', c.id, 'custom', true)
      INTO _r
      FROM public.custom_titles c
     WHERE c.user_id = _user_id AND c.equipped = true AND c.status = 'ACTIVE' AND c.expires_at > now()
     LIMIT 1;
    IF _r IS NOT NULL THEN RETURN _r; END IF;

    SELECT jsonb_build_object('name', i.name, 'assetUrl', i.asset_url, 'itemId', i.id)
      INTO _r
      FROM public.user_items ui JOIN public.items i ON i.id = ui.item_id
     WHERE ui.user_id = _user_id AND ui.equipped = true AND i.category = 'title'
       AND i.rank_required IS NULL
       AND COALESCE(i.source_type,'') NOT IN ('RANK_REWARD','rank_reward')
     ORDER BY ui.equipped_at DESC NULLS LAST LIMIT 1;
    RETURN _r;
  END IF;

  SELECT jsonb_build_object('name', i.name, 'assetUrl', i.asset_url, 'itemId', i.id)
    INTO _r
    FROM public.user_items ui JOIN public.items i ON i.id = ui.item_id
   WHERE ui.user_id = _user_id AND ui.equipped = true AND i.category = _category
   ORDER BY ui.equipped_at DESC NULLS LAST LIMIT 1;
  RETURN _r;
END $function$;

CREATE OR REPLACE FUNCTION public.my_equipped_title()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _r jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_titles();

  SELECT jsonb_build_object(
           'type', 'CUSTOM', 'titleText', c.title_text,
           'expiresAt', c.expires_at, 'isActive', true
         )
    INTO _r
    FROM public.custom_titles c
   WHERE c.user_id = _uid AND c.equipped = true AND c.status = 'ACTIVE' AND c.expires_at > now()
   LIMIT 1;
  IF _r IS NOT NULL THEN RETURN _r; END IF;

  SELECT jsonb_build_object(
           'type', CASE WHEN ui.source_type = 'RANKING' THEN 'RANKING' ELSE 'SYSTEM' END,
           'titleText', i.name, 'expiresAt', ui.expires_at, 'isActive', true
         )
    INTO _r
    FROM public.user_items ui JOIN public.items i ON i.id = ui.item_id
   WHERE ui.user_id = _uid AND ui.equipped = true AND i.category = 'title'
     AND i.rank_required IS NULL
     AND COALESCE(i.source_type,'') NOT IN ('RANK_REWARD','rank_reward')
     AND (ui.expires_at IS NULL OR ui.expires_at > now())
   ORDER BY ui.equipped_at DESC NULLS LAST
   LIMIT 1;

  RETURN COALESCE(_r, jsonb_build_object('type', NULL, 'titleText', NULL, 'expiresAt', NULL, 'isActive', false));
END $function$;

-- 2) 입장 후 최소입장금 미달로는 퇴장시키지 않는다 (ZERO_BALANCE 만 유지)
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
  _left int;
  _new_host uuid;
BEGIN
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;
  IF _room.id IS NULL THEN
    RETURN jsonb_build_object('minPoints', NULL, 'removed', _removed, 'skipped', 'NO_ROOM');
  END IF;
  _min := GREATEST(COALESCE(_room.min_points, 0), 0);

  IF EXISTS (SELECT 1 FROM public.game_rounds
              WHERE room_id = _room_id AND status <> 'finished') THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'ROUND_ACTIVE');
  END IF;

  IF EXISTS (SELECT 1 FROM public.game_rounds
              WHERE room_id = _room_id
                AND (settled = false OR settlement_status NOT IN ('SETTLED','REMATCH'))) THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'SETTLEMENT_PENDING');
  END IF;

  IF COALESCE(_room.rematch_pending, false) THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'REMATCH_PENDING');
  END IF;

  -- 잔액 0P 만 자격 상실 (최소입장금 미달은 재입장 심사에서만 사용)
  UPDATE public.game_room_players p
     SET is_ready = false, ready_at = NULL
   WHERE p.room_id = _room_id
     AND p.is_spectator = false
     AND EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.id = p.user_id AND pr.game_points <= 0);

  FOR _r IN
    SELECT p.user_id, p.seat, pr.game_points, pr.nickname
      FROM public.game_room_players p
      JOIN public.profiles pr ON pr.id = p.user_id
     WHERE p.room_id = _room_id
       AND p.is_spectator = false
       AND pr.game_points <= 0
     ORDER BY p.seat
  LOOP
    DELETE FROM public.game_room_players
     WHERE room_id = _room_id AND user_id = _r.user_id;

    _removed := _removed || jsonb_build_object(
      'userId', _r.user_id, 'points', _r.game_points,
      'nickname', _r.nickname, 'reason', 'ZERO_BALANCE');

    INSERT INTO public.chat_messages (room_id, user_id, message, kind)
    VALUES (_room_id, NULL,
      COALESCE(_r.nickname, '플레이어') || '님이 잔액 부족으로 퇴장했습니다.', 'system');

    BEGIN
      PERFORM public.log_room_event(
        _room_id, 'AUTO_ROOM_KICK', _r.user_id, NULL, _r.seat, NULL, NULL, NULL,
        jsonb_build_object('balance', _r.game_points, 'nickname', _r.nickname,
                           'roomNumber', _room.room_number),
        jsonb_build_object('minimumRequired', _min, 'reason', 'ZERO_BALANCE'),
        NULL, 'OK', 'ZERO_BALANCE');
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;

  IF jsonb_array_length(_removed) = 0 THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed);
  END IF;

  SELECT count(*) INTO _left FROM public.game_room_players
   WHERE room_id = _room_id AND is_spectator = false;
  UPDATE public.game_rooms SET current_players = _left WHERE id = _room_id;

  IF COALESCE(_room.rematch_pending, false) THEN
    IF (SELECT count(*) FROM public.game_room_players p
         WHERE p.room_id = _room_id AND p.is_spectator = false
           AND p.user_id = ANY(_room.rematch_users)) < 2 THEN
      UPDATE public.game_rooms
         SET rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
       WHERE id = _room_id;
    END IF;
  END IF;

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

-- 3) 재접속 시 놓친 턴 카운트 초기화
CREATE OR REPLACE FUNCTION public.game_heartbeat(_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  UPDATE game_room_players
     SET connection_status = 'CONNECTED', last_seen_at = now(),
         missed_turn_count = CASE WHEN leave_pending THEN missed_turn_count ELSE 0 END
   WHERE room_id = _room_id AND user_id = _uid;
  UPDATE game_round_players rp SET connection_status = 'CONNECTED', last_seen_at = now(),
         reconnect_deadline_at = NULL
    FROM game_rounds r
   WHERE rp.round_id = r.id AND r.room_id = _room_id AND rp.user_id = _uid
     AND r.status <> 'finished';
  UPDATE profiles SET last_seen_at = now() WHERE id = _uid;
END; $function$;

-- 4) 입장 시 잔액 snapshot 기록 (입장 자격 심사는 입장 시점에만)
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

  SELECT seat INTO _seat FROM game_room_players WHERE room_id = _room_id AND user_id = _uid;
  IF _seat IS NOT NULL THEN RETURN _seat; END IF;

  IF NOT _spectator THEN
    IF (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false) >= _room.max_players THEN
      RAISE EXCEPTION '방 정원이 가득 찼습니다.';
    END IF;
  END IF;

  SELECT COALESCE(min(s.n), 0) INTO _seat
  FROM generate_series(0, GREATEST(_room.max_players - 1, 0)) AS s(n)
  WHERE NOT EXISTS (SELECT 1 FROM game_room_players gp
    WHERE gp.room_id = _room_id AND gp.is_spectator = false AND gp.seat = s.n);

  INSERT INTO game_room_players (room_id, user_id, seat, is_spectator, entry_balance_snapshot)
  VALUES (_room_id, _uid, _seat, _spectator, _p.game_points);

  UPDATE game_rooms SET current_players =
    (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
  WHERE id = _room_id;

  RETURN _seat;
END; $function$;

-- 5) 연결 끊김 + 실제 action turn 3회 연속 소진 → 라운드 종료 후 퇴장 예약
CREATE OR REPLACE FUNCTION public.enforce_turn_timeout(_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.game_rounds;
  _u uuid;
  _stage_bet bigint;
  _act text;
  _p record;
  _turn int := 15;
  _alive int;
  _conn text;
  _missed int;
  _seat int;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL OR _r.status='finished' OR _r.turn_deadline_at IS NULL
     OR _r.turn_deadline_at > now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);

  IF _r.phase IN ('FINAL_HAND_SUBMIT','HAND_SELECTION') THEN
    FOR _p IN SELECT * FROM public.game_round_players
               WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL LOOP
      UPDATE public.game_round_players
      SET selected_cards=(SELECT public.sutda_best_pair(array_agg(c.card_code ORDER BY c.card_order))->'cards'
                          FROM public.game_cards c WHERE c.round_id=_round_id AND c.user_id=_p.user_id),
          selection_confirmed_at=now(), player_status='HAND_SELECTED'
      WHERE id=_p.id;
    END LOOP;
    IF NOT public.transition_game_round_phase(_round_id, _r.phase, 'SHOWDOWN') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds SET current_turn_user_id=NULL,turn_deadline_at=NULL WHERE id=_round_id;
    RETURN public.settle_round(_round_id);
  END IF;

  IF _r.phase NOT IN ('FIRST_BETTING','FINAL_BETTING') THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
  END IF;
  _u := _r.current_turn_user_id;
  IF _u IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
  WHERE round_id=_round_id AND user_id=_u AND turn_number=_r.stage;
  _act := CASE WHEN _stage_bet >= _r.current_bet THEN 'check' ELSE 'die' END;
  INSERT INTO public.game_actions(round_id,user_id,action_type,amount,turn_number,action_id)
  VALUES (_round_id,_u,_act,0,_r.stage,gen_random_uuid());
  IF _act='die' THEN
    UPDATE public.game_round_players SET folded=true,player_status='FOLDED',acted=true
    WHERE round_id=_round_id AND user_id=_u;
  ELSE
    UPDATE public.game_round_players SET acted=true WHERE round_id=_round_id AND user_id=_u;
  END IF;

  -- 실제 action turn 을 놓친 경우만 누적 (ALL-IN 은 턴 자체가 오지 않으므로 대상 아님)
  SELECT connection_status, seat INTO _conn, _seat
    FROM public.game_room_players WHERE room_id=_r.room_id AND user_id=_u;
  IF COALESCE(_conn,'CONNECTED') <> 'CONNECTED' THEN
    UPDATE public.game_room_players
       SET missed_turn_count = COALESCE(missed_turn_count,0) + 1
     WHERE room_id=_r.room_id AND user_id=_u
    RETURNING missed_turn_count INTO _missed;

    IF COALESCE(_missed,0) >= 3 THEN
      UPDATE public.game_room_players
         SET leave_pending = true,
             leave_requested_at = COALESCE(leave_requested_at, now()),
             is_ready = false, ready_at = NULL
       WHERE room_id=_r.room_id AND user_id=_u;
      BEGIN
        PERFORM public.log_room_event(
          _r.room_id, 'LONG_ABSENCE_KICK', _u, _round_id, _seat, NULL, NULL, NULL,
          jsonb_build_object('missedTurns', _missed, 'connection', _conn),
          jsonb_build_object('leavePending', true),
          NULL, 'OK', 'MISSED_3_TURNS_DISCONNECTED');
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;
  ELSE
    UPDATE public.game_room_players SET missed_turn_count = 0
     WHERE room_id=_r.room_id AND user_id=_u AND COALESCE(missed_turn_count,0) <> 0;
  END IF;

  SELECT count(*) INTO _alive FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
  IF _r.stage=1 AND (_alive<=1 OR (SELECT bool_and(acted OR is_all_in) FROM public.game_round_players WHERE round_id=_round_id AND folded=false)) THEN
    IF _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    PERFORM public.deal_next_card(_round_id);
    IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds SET stage=2,current_bet=0,
      current_turn_user_id=(SELECT user_id FROM public.game_round_players WHERE round_id=_round_id AND folded=false AND is_all_in=false ORDER BY seat LIMIT 1),
      turn_deadline_at=now()+make_interval(secs=>_turn) WHERE id=_round_id;
    UPDATE public.game_round_players SET acted=false,player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'SQUEEZING' END
    WHERE round_id=_round_id AND folded=false;
    RETURN jsonb_build_object('ok',true,'phase','FINAL_BETTING','stage',2,'dealt',true);
  END IF;

  IF _r.stage>=2 AND (_alive<=1 OR (SELECT bool_and(acted OR is_all_in) FROM public.game_round_players WHERE round_id=_round_id AND folded=false)) THEN
    IF _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','FINAL_HAND_SUBMIT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds SET current_turn_user_id=NULL,turn_deadline_at=now()+interval '20 seconds' WHERE id=_round_id;
      RETURN jsonb_build_object('ok',true,'phase','FINAL_HAND_SUBMIT');
    END IF;
    IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds SET current_turn_user_id=NULL,turn_deadline_at=NULL WHERE id=_round_id;
    RETURN public.settle_round(_round_id);
  END IF;

  UPDATE public.game_rounds
  SET current_turn_user_id=(SELECT user_id FROM public.game_round_players
                            WHERE round_id=_round_id AND folded=false AND is_all_in=false AND user_id<>_u
                            ORDER BY CASE WHEN seat>(SELECT seat FROM public.game_round_players WHERE round_id=_round_id AND user_id=_u) THEN 0 ELSE 1 END,seat LIMIT 1),
      turn_deadline_at=now()+make_interval(secs=>_turn)
  WHERE id=_round_id;
  RETURN jsonb_build_object('ok',true,'auto',_act);
END $function$;

-- 6) 좌석 조회에 놓친 턴 수 노출 (UI 재접속 대기 n/3)
CREATE OR REPLACE FUNCTION public.room_table_state(_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _room public.game_rooms; _seats jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;
  IF _room.id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(x ORDER BY (x->>'seat')::int) INTO _seats FROM (
    SELECT jsonb_build_object(
      'userId', rp.user_id,
      'seat', rp.seat,
      'nickname', pr.nickname,
      'rank', pr.rank,
      'points', pr.game_points,
      'avatarUrl', pr.avatar_url,
      'isSpectator', rp.is_spectator,
      'connection', rp.connection_status,
      'seatStatus', rp.seat_status,
      'leavePending', rp.leave_pending,
      'isReady', rp.is_ready,
      'missedTurns', COALESCE(rp.missed_turn_count, 0),
      'isMe', rp.user_id = _uid,
      'character', public.equipped_item_asset(rp.user_id, 'character'),
      'title', public.equipped_item_asset(rp.user_id, 'title')
    ) AS x
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id = _room_id
  ) s;

  RETURN jsonb_build_object(
    'roomId', _room.id, 'roomNumber', _room.room_number, 'title', _room.title,
    'status', _room.status, 'mode', _room.game_mode, 'baseBet', _room.base_bet,
    'maxPlayers', _room.max_players, 'carryPot', _room.carry_pot,
    'readyRequired', _room.ready_required,
    'activeRound', EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished'),
    'seats', COALESCE(_seats, '[]'::jsonb)
  );
END; $function$;