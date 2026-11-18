REVOKE EXECUTE ON FUNCTION public.ops_flag(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_round_start_allowed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_game_error(text,text,text,uuid,uuid,text,text,boolean,jsonb) FROM anon;

-- start_game_round: 신규 라운드 차단 가드 추가 (기존 로직 유지)
CREATE OR REPLACE FUNCTION public.start_game_round(_room_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.game_rooms;
  _deck text[] := ARRAY['01-gwang','01-normal','02-a','02-b','03-gwang','03-normal','04-a','04-b',
                        '05-a','05-b','06-a','06-b','07-a','07-b','08-gwang','08-normal',
                        '09-a','09-b','10-a','10-b'];
  _shuffled text[];
  _players record;
  _n int; _idx int := 0; _per int; _round_id uuid; _num int; _turn int := 15;
  _mode text; _first_seat int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '존재하지 않는 방입니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_room_players WHERE room_id=_room_id AND user_id=_uid AND is_spectator=false) THEN
    RAISE EXCEPTION '방 참가자만 게임을 시작할 수 있습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RETURN (SELECT id FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished' ORDER BY started_at DESC LIMIT 1);
  END IF;

  PERFORM public.assert_round_start_allowed();

  _mode := _room.game_mode;
  _per := CASE WHEN _mode = 'sutda3' THEN 3 ELSE 2 END;
  SELECT count(*) INTO _n FROM public.game_room_players WHERE room_id=_room_id AND is_spectator=false;
  IF _n < 2 THEN RAISE EXCEPTION '최소 2명이 필요합니다.'; END IF;
  IF _n * _per > 20 THEN RAISE EXCEPTION '인원이 너무 많습니다.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND pr.game_points < _room.base_bet
  ) THEN RAISE EXCEPTION '기본 베팅 포인트가 부족한 참가자가 있습니다.'; END IF;

  SELECT COALESCE((value->>'turn_seconds')::int, 15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);
  SELECT COALESCE(max(round_number),0)+1 INTO _num FROM public.game_rounds WHERE room_id=_room_id;
  SELECT min(seat) INTO _first_seat FROM public.game_room_players WHERE room_id=_room_id AND is_spectator=false;

  INSERT INTO public.game_rounds(room_id, round_number, game_mode, status, pot, phase, stage,
                                 base_bet, current_bet, dealer_seat, turn_deadline_at)
  VALUES (_room_id, _num, _mode, 'betting', 0,
          CASE WHEN _mode='sutda3' THEN 'FIRST_BETTING' ELSE 'BETTING' END,
          1, _room.base_bet, _room.base_bet, _first_seat, now() + make_interval(secs => _turn))
  RETURNING id INTO _round_id;

  SELECT array_agg(c ORDER BY gen_random_uuid()) INTO _shuffled FROM unnest(_deck) c;

  FOR _players IN
    SELECT rp.user_id, rp.seat, pr.game_points
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false ORDER BY rp.seat
  LOOP
    _idx := _idx + 1;
    INSERT INTO public.game_round_players(round_id, user_id, seat, initial_points, folded,
                                          player_status, connection_status, acted, total_bet)
    VALUES (_round_id, _players.user_id, _players.seat, _players.game_points, false,
            'ACTIVE', 'CONNECTED', false, 0);

    INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
    VALUES (_round_id, _players.user_id, _shuffled[_idx], 1),
           (_round_id, _players.user_id, _shuffled[_n + _idx], 2);
    IF _per = 3 THEN
      INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
      VALUES (_round_id, _players.user_id, _shuffled[2*_n + _idx], 3);
    END IF;

    PERFORM public.game_take_bet(_players.user_id, _room.base_bet, _round_id);
    INSERT INTO public.game_actions(round_id, user_id, action_type, amount, turn_number, action_id)
    VALUES (_round_id, _players.user_id, 'ante', _room.base_bet, 1, gen_random_uuid());
    UPDATE public.game_round_players SET total_bet = _room.base_bet
      WHERE round_id=_round_id AND user_id=_players.user_id;
  END LOOP;

  UPDATE public.game_rounds
     SET pot = _room.base_bet * _n,
         current_turn_user_id = (SELECT user_id FROM public.game_round_players
                                  WHERE round_id=_round_id ORDER BY seat LIMIT 1)
   WHERE id = _round_id;

  UPDATE public.game_rooms SET status = 'playing' WHERE id = _room_id;
  RETURN _round_id;
END; $function$;

-- 충전 신청: 점검/차단 가드 추가 (수수료 정책 변경 없음)
CREATE OR REPLACE FUNCTION public.request_charge_with_ticket(_amount numeric, _depositor_name text, _note text DEFAULT NULL::text, _use_ticket boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _uid uuid := auth.uid(); _rate numeric; _fee_rate numeric; _ticket uuid; _fee numeric;
  _base numeric; _points bigint; _req uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF NOT public.ops_flag('charge_enabled') THEN RAISE EXCEPTION '현재 충전 신청이 중단되었습니다.'; END IF;
  IF public.ops_flag('maintenance_enabled') AND public.ops_flag('maintenance_block_charge') THEN
    RAISE EXCEPTION '서버 점검 중에는 충전 신청을 받을 수 없습니다.';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION '충전 금액이 올바르지 않습니다.'; END IF;
  IF COALESCE(trim(_depositor_name),'') = '' THEN RAISE EXCEPTION '입금자명을 입력해 주세요.'; END IF;

  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  SELECT (value#>>'{}')::numeric INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
  _rate := COALESCE(_rate, 1); _fee_rate := COALESCE(_fee_rate, 0.07);

  IF _use_ticket THEN
    UPDATE rake_free_tickets SET status = 'RESERVED', reserved_at = now()
     WHERE id = (SELECT id FROM rake_free_tickets
                  WHERE user_id = _uid AND status = 'ISSUED'
                  ORDER BY issued_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id INTO _ticket;
    IF _ticket IS NULL THEN RAISE EXCEPTION '사용 가능한 충전 레이크 면제권이 없습니다.'; END IF;
  END IF;

  _fee := CASE WHEN _ticket IS NULL THEN round(_amount * _fee_rate) ELSE 0 END;
  _base := _amount - _fee;
  _points := floor(_base * _rate)::bigint;

  INSERT INTO charge_requests (user_id, requested_amount, point_amount, conversion_rate,
    depositor_name, user_note, rake_free_ticket_used, rake_free_ticket_id)
  VALUES (_uid, _amount, _points, _rate, trim(_depositor_name), _note, _ticket IS NOT NULL, _ticket)
  RETURNING id INTO _req;

  IF _ticket IS NOT NULL THEN
    UPDATE rake_free_tickets SET charge_request_id = _req WHERE id = _ticket;
  END IF;
  RETURN _req;
END; $function$;

-- 출금 신청: 점검/차단 가드 추가 (수수료 0% 정책 유지)
CREATE OR REPLACE FUNCTION public.request_withdrawal(_points bigint, _method text, _details jsonb, _note text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _uid uuid := auth.uid(); _rate numeric; _p profiles; _req uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF NOT public.ops_flag('withdraw_enabled') THEN RAISE EXCEPTION '현재 출금 신청이 중단되었습니다.'; END IF;
  IF public.ops_flag('maintenance_enabled') AND public.ops_flag('maintenance_block_withdraw') THEN
    RAISE EXCEPTION '서버 점검 중에는 출금 신청을 받을 수 없습니다.';
  END IF;
  IF _points <= 0 THEN RAISE EXCEPTION '출금 포인트가 올바르지 않습니다.'; END IF;
  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  _rate := COALESCE(_rate, 1);
  IF _rate <= 0 THEN _rate := 1; END IF;
  SELECT * INTO _p FROM profiles WHERE id = _uid FOR UPDATE;
  IF _p.game_points < _points THEN RAISE EXCEPTION '보유 포인트가 부족합니다.'; END IF;

  UPDATE profiles SET game_points = game_points - _points,
                      locked_points = locked_points + _points
  WHERE id = _uid;

  INSERT INTO withdrawal_requests (user_id, requested_points, payout_amount, conversion_rate, payout_method, payout_details, user_note)
  VALUES (_uid, _points, _points / _rate, _rate, _method, COALESCE(_details,'{}'::jsonb), _note)
  RETURNING id INTO _req;

  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id)
  VALUES (_uid, 'withdraw_requested', -_points, _p.game_points, _p.game_points - _points,
          _p.locked_points, _p.locked_points + _points, 'withdrawal_request', _req);
  RETURN _req;
END; $function$;