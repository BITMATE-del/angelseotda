CREATE OR REPLACE FUNCTION public.transition_game_round_phase(
  _round_id uuid,
  _expected text,
  _next text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.game_rounds;
  _allowed boolean := false;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL THEN RETURN false; END IF;

  _allowed := CASE _expected
    WHEN 'READY' THEN _next = 'DEALING_FIRST_CARD'
    WHEN 'DEALING_FIRST_CARD' THEN _next IN ('FIRST_BETTING','OPEN_CARD_SELECTION')
    WHEN 'OPEN_CARD_SELECTION' THEN _next = 'FIRST_BETTING'
    WHEN 'FIRST_BETTING' THEN _next IN ('DEALING_SECOND_CARD','LAST_CARD_DEALT')
    WHEN 'DEALING_SECOND_CARD' THEN _next = 'SQUEEZING'
    WHEN 'LAST_CARD_DEALT' THEN _next = 'FINAL_BETTING'
    WHEN 'SQUEEZING' THEN _next IN ('FINAL_BETTING','SHOWDOWN')
    WHEN 'FINAL_BETTING' THEN _next IN ('SHOWDOWN','FINAL_HAND_SUBMIT')
    WHEN 'FINAL_HAND_SUBMIT' THEN _next = 'SHOWDOWN'
    WHEN 'SHOWDOWN' THEN _next = 'SETTLING'
    WHEN 'SETTLING' THEN _next = 'ROUND_RESULT'
    WHEN 'ROUND_RESULT' THEN _next = 'NEXT_ROUND'
    ELSE false
  END;

  IF _r.phase IS DISTINCT FROM _expected OR NOT _allowed THEN
    PERFORM public.log_room_event(
      _r.room_id, 'INVALID_PHASE_TRANSITION', auth.uid(), _round_id, NULL, NULL,
      _r.pot, _r.pot,
      jsonb_build_object('phase', _r.phase, 'expected', _expected),
      jsonb_build_object('requested', _next),
      NULL, 'DENIED', 'INVALID_PHASE_TRANSITION'
    );
    RETURN false;
  END IF;

  UPDATE public.game_rounds SET phase = _next WHERE id = _round_id;
  PERFORM public.log_room_event(
    _r.room_id, 'PHASE_TRANSITION', auth.uid(), _round_id, NULL, NULL,
    _r.pot, _r.pot,
    jsonb_build_object('phase', _expected, 'roundNumber', _r.round_number),
    jsonb_build_object('phase', _next, 'roundNumber', _r.round_number),
    NULL, 'OK', NULL
  );
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.transition_game_round_phase(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_game_round_phase(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.deal_next_card(_round_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.game_rounds;
  _p record;
  _pos int;
  _order int;
  _cnt int := 0;
  _before_count int;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.game_mode = 'sutda2' AND _r.phase <> 'DEALING_SECOND_CARD' THEN
    RAISE EXCEPTION 'INVALID_PHASE_TRANSITION';
  END IF;
  IF _r.game_mode = 'sutda3' AND _r.phase <> 'FIRST_BETTING' THEN
    RAISE EXCEPTION 'INVALID_PHASE_TRANSITION';
  END IF;

  _pos := _r.deck_pos;
  FOR _p IN
    SELECT * FROM public.game_round_players
    WHERE round_id = _round_id AND folded = false
    ORDER BY seat
  LOOP
    SELECT count(*) INTO _before_count FROM public.game_cards
    WHERE round_id = _round_id AND user_id = _p.user_id;
    IF (_r.game_mode = 'sutda2' AND _before_count <> 1)
       OR (_r.game_mode = 'sutda3' AND _before_count <> 2) THEN
      RAISE EXCEPTION 'ROUND_CARD_INTEGRITY_ERROR';
    END IF;
    _order := _before_count + 1;
    _pos := _pos + 1;
    IF _r.deck[_pos] IS NULL THEN RAISE EXCEPTION 'ROUND_CARD_INTEGRITY_ERROR'; END IF;
    INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
    VALUES (_round_id, _p.user_id, _r.deck[_pos], _order);
    _cnt := _cnt + 1;
  END LOOP;
  UPDATE public.game_rounds SET deck_pos = _pos WHERE id = _round_id;
  RETURN _cnt;
END $$;

REVOKE ALL ON FUNCTION public.deal_next_card(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deal_next_card(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_sutda2_first_betting(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.game_rounds;
  _bad int;
  _dealt int;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL OR _r.game_mode <> 'sutda2' OR _r.stage <> 1 OR _r.phase <> 'FIRST_BETTING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
  END IF;

  IF NOT public.transition_game_round_phase(_round_id, 'FIRST_BETTING', 'DEALING_SECOND_CARD') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
  END IF;

  _dealt := public.deal_next_card(_round_id);
  SELECT count(*) INTO _bad
  FROM public.game_round_players p
  WHERE p.round_id = _round_id AND p.folded = false
    AND (SELECT count(*) FROM public.game_cards c
         WHERE c.round_id = _round_id AND c.user_id = p.user_id) <> 2;

  IF _bad > 0 THEN
    PERFORM public.log_room_event(
      _r.room_id, 'ROUND_CARD_INTEGRITY_ERROR', NULL, _round_id, NULL, NULL,
      _r.pot, _r.pot, jsonb_build_object('expected', 2),
      jsonb_build_object('invalidPlayers', _bad), NULL, 'DENIED', 'ROUND_CARD_INTEGRITY_ERROR'
    );
    RETURN jsonb_build_object('ok', false, 'error', 'ROUND_CARD_INTEGRITY_ERROR');
  END IF;

  UPDATE public.game_rounds
  SET stage = 2, current_bet = 0, current_turn_user_id = NULL, turn_deadline_at = NULL
  WHERE id = _round_id;
  UPDATE public.game_round_players
  SET acted = false,
      player_status = CASE WHEN is_all_in THEN 'ALL_IN_SQUEEZING' ELSE 'SQUEEZING' END
  WHERE round_id = _round_id AND folded = false;

  IF NOT public.transition_game_round_phase(_round_id, 'DEALING_SECOND_CARD', 'SQUEEZING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
  END IF;
  RETURN jsonb_build_object('ok', true, 'phase', 'SQUEEZING', 'stage', 2, 'dealt', _dealt);
END $$;

REVOKE ALL ON FUNCTION public.complete_sutda2_first_betting(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sutda2_first_betting(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_card_squeeze(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r public.game_rounds;
  _me public.game_round_players;
  _pending int;
  _bad int;
  _next uuid;
  _turn int := 15;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL OR _r.game_mode <> 'sutda2' OR _r.phase <> 'SQUEEZING' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
  END IF;
  SELECT * INTO _me FROM public.game_round_players
  WHERE round_id = _round_id AND user_id = _uid FOR UPDATE;
  IF _me.id IS NULL OR _me.folded THEN RAISE EXCEPTION '카드를 확인할 수 없는 참가자입니다.'; END IF;

  SELECT count(*) INTO _bad
  FROM public.game_round_players p
  WHERE p.round_id = _round_id AND p.folded = false
    AND (SELECT count(*) FROM public.game_cards c
         WHERE c.round_id = _round_id AND c.user_id = p.user_id) <> 2;
  IF _bad > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROUND_CARD_INTEGRITY_ERROR');
  END IF;

  UPDATE public.game_round_players
  SET player_status = CASE WHEN is_all_in THEN 'ALL_IN_READY' ELSE 'SQUEEZE_READY' END
  WHERE id = _me.id;

  SELECT count(*) INTO _pending FROM public.game_round_players
  WHERE round_id = _round_id AND folded = false
    AND player_status IN ('SQUEEZING','ALL_IN_SQUEEZING');
  IF _pending > 0 THEN RETURN jsonb_build_object('ok', true, 'phase', 'SQUEEZING', 'pending', _pending); END IF;

  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn
  FROM public.app_settings WHERE key = 'game_rules';
  SELECT user_id INTO _next FROM public.game_round_players
  WHERE round_id = _round_id AND folded = false AND is_all_in = false
  ORDER BY seat LIMIT 1;

  IF _next IS NULL THEN
    IF NOT public.transition_game_round_phase(_round_id, 'SQUEEZING', 'SHOWDOWN') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
    END IF;
    RETURN public.settle_round(_round_id);
  END IF;

  IF NOT public.transition_game_round_phase(_round_id, 'SQUEEZING', 'FINAL_BETTING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
  END IF;
  UPDATE public.game_rounds
  SET current_turn_user_id = _next,
      turn_deadline_at = now() + make_interval(secs => COALESCE(_turn,15))
  WHERE id = _round_id;
  UPDATE public.game_round_players
  SET acted = false,
      player_status = CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'ACTIVE' END
  WHERE round_id = _round_id AND folded = false;
  RETURN jsonb_build_object('ok', true, 'phase', 'FINAL_BETTING', 'pending', 0);
END $$;

REVOKE ALL ON FUNCTION public.confirm_card_squeeze(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_card_squeeze(uuid) TO authenticated, service_role;

ALTER FUNCTION public.settle_round(uuid) RENAME TO settle_round_without_phase_guard;
REVOKE ALL ON FUNCTION public.settle_round_without_phase_guard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_round_without_phase_guard(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.game_rounds;
  _bad int;
  _result jsonb;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.settled OR _r.settlement_status IN ('SETTLED','REMATCH') THEN
    RETURN jsonb_build_object('alreadySettled', true, 'roundId', _round_id);
  END IF;
  IF _r.phase <> 'SHOWDOWN' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROUND_NOT_READY_FOR_SHOWDOWN');
  END IF;

  SELECT count(*) INTO _bad
  FROM public.game_round_players p
  WHERE p.round_id = _round_id AND p.folded = false
    AND (SELECT count(*) FROM public.game_cards c
         WHERE c.round_id = _round_id AND c.user_id = p.user_id)
        <> CASE WHEN _r.game_mode = 'sutda3' THEN 3 ELSE 2 END;
  IF _bad > 0 THEN
    PERFORM public.log_room_event(
      _r.room_id, 'ROUND_CARD_INTEGRITY_ERROR', NULL, _round_id, NULL, NULL,
      _r.pot, _r.pot,
      jsonb_build_object('phase', _r.phase),
      jsonb_build_object('invalidPlayers', _bad),
      NULL, 'DENIED', 'ROUND_NOT_READY_FOR_SHOWDOWN'
    );
    RETURN jsonb_build_object('ok', false, 'error', 'ROUND_NOT_READY_FOR_SHOWDOWN');
  END IF;

  IF NOT public.transition_game_round_phase(_round_id, 'SHOWDOWN', 'SETTLING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
  END IF;
  _result := public.settle_round_without_phase_guard(_round_id);
  UPDATE public.game_rounds SET phase = 'ROUND_RESULT' WHERE id = _round_id;
  PERFORM public.log_room_event(
    _r.room_id, 'PHASE_TRANSITION', NULL, _round_id, NULL, NULL,
    _r.pot, (SELECT pot FROM public.game_rounds WHERE id = _round_id),
    jsonb_build_object('phase', 'SETTLING', 'roundNumber', _r.round_number),
    jsonb_build_object('phase', 'ROUND_RESULT', 'roundNumber', _r.round_number),
    NULL, 'OK', NULL
  );
  RETURN _result;
END $$;

REVOKE ALL ON FUNCTION public.settle_round(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_round(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.place_bet_action(_round_id uuid, _action_id uuid, _action_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _me public.game_round_players;
  _owed bigint; _amount bigint := 0; _new_bet bigint; _stage_bet bigint;
  _alive int; _acted int; _equal boolean; _next uuid; _turn int := 15; _bal bigint; _cnt int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.status = 'finished' THEN RAISE EXCEPTION '이미 종료된 라운드입니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_actions WHERE round_id=_round_id AND user_id=_uid AND action_id=_action_id) THEN
    RETURN jsonb_build_object('duplicated', true);
  END IF;
  SELECT * INTO _me FROM public.game_round_players WHERE round_id=_round_id AND user_id=_uid FOR UPDATE;
  IF _me.id IS NULL THEN RAISE EXCEPTION '이 라운드의 참가자가 아닙니다.'; END IF;
  IF _me.folded THEN RAISE EXCEPTION '이미 다이한 상태입니다.'; END IF;
  IF _me.is_all_in THEN RAISE EXCEPTION '이미 올인한 상태입니다.'; END IF;
  IF _r.current_turn_user_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION '당신의 차례가 아닙니다.'; END IF;
  IF _r.phase NOT IN ('FIRST_BETTING','FINAL_BETTING') THEN RAISE EXCEPTION '지금은 베팅할 수 없습니다.'; END IF;

  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
  WHERE round_id=_round_id AND user_id=_uid AND turn_number=_r.stage;
  _owed := GREATEST(_r.current_bet - _stage_bet, 0);
  _new_bet := _r.current_bet;
  SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;

  IF _action_type IN ('die','jjol') THEN
    UPDATE public.game_round_players SET folded=true, player_status='FOLDED', acted=true WHERE id=_me.id;
  ELSIF _action_type = 'check' THEN
    IF _owed > 0 THEN RAISE EXCEPTION '체크할 수 없습니다.'; END IF;
  ELSIF _action_type = 'call' THEN _amount := _owed;
  ELSIF _action_type = 'ping' THEN _amount := _owed + _r.base_bet; _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'ttadang' THEN _amount := _owed + GREATEST(_r.current_bet,_r.base_bet)*2; _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'half' THEN _amount := _owed + GREATEST(_r.pot/2,_r.base_bet); _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'quarter' THEN _amount := _owed + GREATEST(_r.pot/4,_r.base_bet); _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'all_in' THEN
    SELECT count(*) INTO _cnt FROM public.game_actions
    WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','quarter','all_in');
    IF _cnt < 2 THEN RAISE EXCEPTION '올인은 베팅이 2회 이상 진행된 후에 사용할 수 있습니다.'; END IF;
    IF COALESCE(_bal,0) <= 0 THEN RAISE EXCEPTION '보유 포인트가 없습니다.'; END IF;
    _amount := _bal; _new_bet := GREATEST(_r.current_bet,_stage_bet+_amount);
  ELSE RAISE EXCEPTION '알 수 없는 행동입니다: %', _action_type;
  END IF;

  IF _amount > _bal THEN _amount := _bal; _new_bet := GREATEST(_new_bet,_stage_bet+_amount); END IF;
  IF _amount > 0 THEN PERFORM public.game_take_bet(_uid,_amount,_round_id); END IF;
  INSERT INTO public.game_actions(round_id,user_id,action_type,amount,turn_number,action_id)
  VALUES (_round_id,_uid,_action_type,_amount,_r.stage,_action_id);
  UPDATE public.game_round_players
  SET acted=true,total_bet=total_bet+_amount,
      is_all_in=CASE WHEN folded THEN false WHEN _action_type='all_in' OR _bal-_amount<=0 THEN true ELSE is_all_in END,
      all_in_at=CASE WHEN NOT folded AND (_action_type='all_in' OR _bal-_amount<=0) THEN COALESCE(all_in_at,now()) ELSE all_in_at END,
      player_status=CASE WHEN folded THEN 'FOLDED' WHEN _action_type='all_in' OR _bal-_amount<=0 THEN 'ALL_IN' ELSE 'ACTIVE' END
  WHERE id=_me.id;
  IF _new_bet > _r.current_bet THEN
    UPDATE public.game_round_players SET acted=false
    WHERE round_id=_round_id AND folded=false AND user_id<>_uid AND is_all_in=false;
  END IF;
  UPDATE public.game_rounds SET pot=pot+_amount,current_bet=GREATEST(_new_bet,current_bet) WHERE id=_round_id;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;

  SELECT count(*) INTO _alive FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
  IF _alive <= 1 THEN
    IF _r.phase='FIRST_BETTING' AND _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF _r.phase='FINAL_BETTING' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      RETURN public.settle_round(_round_id);
    END IF;
  END IF;

  SELECT count(*) INTO _acted FROM public.game_round_players
  WHERE round_id=_round_id AND folded=false AND (acted=true OR is_all_in=true);
  SELECT bool_and(COALESCE(sb.s,0)=_r.current_bet OR p.is_all_in) INTO _equal
  FROM public.game_round_players p
  LEFT JOIN (SELECT user_id,sum(amount) s FROM public.game_actions
             WHERE round_id=_round_id AND turn_number=_r.stage GROUP BY user_id) sb ON sb.user_id=p.user_id
  WHERE p.round_id=_round_id AND p.folded=false;
  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';

  IF _acted=_alive AND COALESCE(_equal,false) THEN
    IF _r.stage=1 AND _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF _r.stage=1 AND _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      PERFORM public.deal_next_card(_round_id);
      IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds SET stage=2,current_bet=0,
        current_turn_user_id=(SELECT user_id FROM public.game_round_players WHERE round_id=_round_id AND folded=false AND is_all_in=false ORDER BY seat LIMIT 1),
        turn_deadline_at=now()+make_interval(secs=>COALESCE(_turn,15)) WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=false,player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'ACTIVE' END
      WHERE round_id=_round_id AND folded=false;
      RETURN jsonb_build_object('phase','FINAL_BETTING','stage',2,'dealt',true);
    END IF;
    IF _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','FINAL_HAND_SUBMIT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds SET current_turn_user_id=NULL,turn_deadline_at=now()+interval '20 seconds' WHERE id=_round_id;
      UPDATE public.game_round_players SET player_status='HAND_SELECTION'
      WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
      RETURN jsonb_build_object('phase','FINAL_HAND_SUBMIT');
    END IF;
    IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds SET current_turn_user_id=NULL,turn_deadline_at=NULL WHERE id=_round_id;
    RETURN public.settle_round(_round_id);
  END IF;

  SELECT user_id INTO _next FROM public.game_round_players
  WHERE round_id=_round_id AND folded=false AND is_all_in=false AND user_id<>_uid
  ORDER BY CASE WHEN seat>_me.seat THEN 0 ELSE 1 END,seat LIMIT 1;
  IF _next IS NULL THEN
    IF _r.stage=1 AND _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF _r.phase='FINAL_BETTING' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      RETURN public.settle_round(_round_id);
    END IF;
    RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
  END IF;
  UPDATE public.game_rounds SET current_turn_user_id=_next,turn_deadline_at=now()+make_interval(secs=>COALESCE(_turn,15)) WHERE id=_round_id;
  RETURN jsonb_build_object('ok',true,'turnUserId',_next,'amount',_amount);
END $$;

REVOKE ALL ON FUNCTION public.place_bet_action(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bet_action(uuid,uuid,text) TO authenticated, service_role;