-- 재경기(REMATCH)에서 이미 전액 올인한 참가자가 잔액 0P라는 이유로 준비/참여를 못 하는 문제 수정
CREATE OR REPLACE FUNCTION public.set_room_ready(_room_id uuid, _ready boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _nick text;
  _seated int;
  _ready_cnt int;
  _min bigint;
  _bal bigint;
  _room public.game_rooms;
  _rematch_exempt boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RAISE EXCEPTION '진행 중인 판이 있습니다.';
  END IF;

  SELECT * INTO _room FROM public.game_rooms WHERE id=_room_id;
  _min := _room.min_points;
  SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;

  -- 재경기 참가자는 이전 판에서 이미 베팅이 확정된 상태이므로 잔액 검사에서 면제한다.
  _rematch_exempt := COALESCE(_room.rematch_pending,false)
                     AND _uid = ANY(COALESCE(_room.rematch_users, '{}'::uuid[]));

  IF _ready AND NOT _rematch_exempt AND _min IS NOT NULL AND COALESCE(_bal,0) < _min THEN
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

CREATE OR REPLACE FUNCTION public.start_game_round(_room_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.game_rooms;
  _deck text[] := ARRAY['01-gwang','01-normal','02-a','02-b','03-gwang','03-normal','04-a','04-b',
                        '05-a','05-b','06-a','06-b','07-a','07-b','08-gwang','08-normal',
                        '09-a','09-b','10-a','10-b'];
  _shuffled text[]; _players record;
  _n int; _idx int := 0; _initial int; _round_id uuid; _num int; _turn int := 15;
  _mode text; _first_seat int; _carry bigint := 0; _rematch boolean := false;
  _rusers uuid[]; _carrybet bigint; _k int; _ante bigint; _ante_sum bigint := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '존재하지 않는 방입니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RETURN (SELECT id FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished' ORDER BY started_at DESC LIMIT 1);
  END IF;

  PERFORM public.process_leave_pending(_room_id);
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;

  IF NOT EXISTS (SELECT 1 FROM public.game_room_players
    WHERE room_id=_room_id AND user_id=_uid AND is_spectator=false AND leave_pending=false) THEN
    RAISE EXCEPTION '방 참가자만 게임을 시작할 수 있습니다.';
  END IF;

  PERFORM public.assert_round_start_allowed();

  _rematch := COALESCE(_room.rematch_pending,false);
  IF _rematch THEN
    SELECT array_agg(rp.user_id) INTO _rusers FROM public.game_room_players rp
     WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
       AND rp.user_id = ANY(_room.rematch_users);
    IF COALESCE(array_length(_rusers,1),0) < 2 THEN _rematch := false; _rusers := NULL; END IF;
  END IF;

  -- 재경기는 항상 2장 섯다 (ANGEL SUTDA 확정 정책)
  _mode := CASE WHEN _rematch THEN 'sutda2' ELSE _room.game_mode END;
  _initial := CASE WHEN _mode = 'sutda3' THEN 2 ELSE 1 END;

  SELECT count(*) INTO _n FROM public.game_room_players rp
   WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
     AND (NOT _rematch OR rp.user_id = ANY(_rusers));
  IF _n < 2 THEN RAISE EXCEPTION '최소 2명이 필요합니다.'; END IF;
  IF _n * (CASE WHEN _mode='sutda3' THEN 3 ELSE 2 END) > 20 THEN RAISE EXCEPTION '인원이 너무 많습니다.'; END IF;

  -- 신규 판만 기본 베팅 잔액을 요구한다. 재경기는 올인 참가자(잔액 0P) 포함해 반드시 진행되어야 한다.
  IF NOT _rematch AND EXISTS (
    SELECT 1 FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
      AND pr.game_points < _room.base_bet
  ) THEN RAISE EXCEPTION '기본 베팅 포인트가 부족한 참가자가 있습니다.'; END IF;

  SELECT COALESCE((value->>'turn_seconds')::int, 15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);
  SELECT COALESCE(max(round_number),0)+1 INTO _num FROM public.game_rounds WHERE room_id=_room_id;
  SELECT min(rp.seat) INTO _first_seat FROM public.game_room_players rp
   WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
     AND (NOT _rematch OR rp.user_id = ANY(_rusers));
  _carry := GREATEST(COALESCE(_room.carry_pot,0), 0);

  SELECT array_agg(c ORDER BY gen_random_uuid()) INTO _shuffled FROM unnest(_deck) c;

  INSERT INTO public.game_rounds(room_id, round_number, game_mode, status, pot, phase, stage,
                                 base_bet, current_bet, dealer_seat, turn_deadline_at, carry_in, is_rematch,
                                 deck, deck_pos)
  VALUES (_room_id, _num, _mode, 'betting', 0,
          CASE WHEN _mode='sutda3' THEN 'OPEN_CARD_SELECTION' ELSE 'FIRST_BETTING' END,
          1, _room.base_bet, _room.base_bet, _first_seat, now() + make_interval(secs => _turn),
          _carry, _rematch, _shuffled, _initial * _n)
  RETURNING id INTO _round_id;

  FOR _players IN
    SELECT rp.user_id, rp.seat, pr.game_points
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
      AND (NOT _rematch OR rp.user_id = ANY(_rusers))
    ORDER BY rp.seat
  LOOP
    _idx := _idx + 1;
    _carrybet := CASE WHEN _rematch
      THEN COALESCE((_room.carry_caps->>_players.user_id::text)::bigint, 0) ELSE 0 END;

    -- 재경기에서 이미 올인한 참가자는 잔액만큼만(0P 포함) 앤티를 부담하고 ALL_IN 상태로 유지한다.
    _ante := CASE WHEN _rematch
      THEN LEAST(_room.base_bet, GREATEST(COALESCE(_players.game_points,0), 0))
      ELSE _room.base_bet END;
    _ante_sum := _ante_sum + _ante;

    INSERT INTO public.game_round_players(round_id, user_id, seat, initial_points, folded,
                                          player_status, connection_status, acted, total_bet, carry_bet,
                                          is_all_in)
    VALUES (_round_id, _players.user_id, _players.seat, _players.game_points, false,
            CASE WHEN _mode='sutda3' THEN 'OPEN_CARD_SELECTION'
                 WHEN _ante < _room.base_bet THEN 'ALL_IN' ELSE 'ACTIVE' END,
            'CONNECTED', false, 0, _carrybet,
            _ante < _room.base_bet);

    -- 초기 카드만 지급 (2장모드=1장, 3장모드=2장)
    FOR _k IN 1.._initial LOOP
      INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
      VALUES (_round_id, _players.user_id, _shuffled[(_k-1)*_n + _idx], _k);
    END LOOP;

    IF _ante > 0 THEN
      PERFORM public.game_take_bet(_players.user_id, _ante, _round_id);
    END IF;
    INSERT INTO public.game_actions(round_id, user_id, action_type, amount, turn_number, action_id)
    VALUES (_round_id, _players.user_id, 'ante', _ante, 1, gen_random_uuid());
    UPDATE public.game_round_players SET total_bet = _ante + _carrybet
      WHERE round_id=_round_id AND user_id=_players.user_id;
  END LOOP;

  UPDATE public.game_rounds
     SET pot = _ante_sum + _carry,
         current_turn_user_id = CASE WHEN _mode='sutda3' THEN NULL ELSE
           (SELECT user_id FROM public.game_round_players WHERE round_id=_round_id AND is_all_in = false ORDER BY seat LIMIT 1) END
   WHERE id = _round_id;

  UPDATE public.game_rooms
     SET status = 'playing', carry_pot = 0, current_round_id = _round_id,
         rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
   WHERE id = _room_id;
  RETURN _round_id;
END; $function$;