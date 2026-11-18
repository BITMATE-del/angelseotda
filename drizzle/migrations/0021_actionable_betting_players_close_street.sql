-- ACTIONABLE_BETTING_1
CREATE OR REPLACE FUNCTION public.actionable_betting_count(_round_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.game_round_players
   WHERE round_id = _round_id AND folded = false AND is_all_in = false
$$;

CREATE OR REPLACE FUNCTION public.dori_actionable_betting_count(_round_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.dori_round_players
   WHERE round_id = _round_id AND folded = false AND is_all_in = false
$$;

REVOKE ALL ON FUNCTION public.actionable_betting_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dori_actionable_betting_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actionable_betting_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dori_actionable_betting_count(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.place_bet_action(_round_id uuid, _action_id uuid, _action_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _me public.game_round_players;
  _owed bigint; _amount bigint := 0; _new_bet bigint; _stage_bet bigint;
  _alive int; _acted int; _equal boolean; _next uuid; _turn int := 15; _bal bigint; _cnt int;
  _actionable int;
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

  _actionable := public.actionable_betting_count(_round_id);
  SELECT count(*) INTO _alive FROM public.game_round_players
   WHERE round_id=_round_id AND folded=false;
  IF _actionable <= 1 AND _alive > 1 THEN
    RAISE EXCEPTION '추가 베팅할 상대가 없습니다.';
  END IF;

  IF _action_type IN ('die','jjol') THEN
    IF _alive <= 1 THEN RAISE EXCEPTION '마지막 남은 참가자는 다이할 수 없습니다.'; END IF;
  END IF;

  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
  WHERE round_id=_round_id AND user_id=_uid AND turn_number=_r.stage;
  _owed := GREATEST(_r.current_bet - _stage_bet, 0);
  _new_bet := _r.current_bet;
  SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;

  IF _action_type IN ('die','jjol') THEN
    UPDATE public.game_round_players SET folded=true, player_status='FOLDED', acted=true WHERE id=_me.id;
  ELSIF _action_type = 'check' THEN
    IF _owed > 0 THEN RAISE EXCEPTION '체크할 수 없습니다.'; END IF;
  ELSIF _action_type IN ('call','ping','ttadang','half','quarter','all_in') THEN
    IF _action_type = 'all_in' THEN
      SELECT count(*) INTO _cnt FROM public.game_actions
      WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','quarter','all_in');
      IF _cnt < 2 THEN RAISE EXCEPTION '올인은 베팅이 2회 이상 진행된 후에 사용할 수 있습니다.'; END IF;
      IF COALESCE(_bal,0) <= 0 THEN RAISE EXCEPTION '보유 포인트가 없습니다.'; END IF;
    END IF;
    _amount := public.bet_additional_amount(_action_type,_r.pot,_r.current_bet,_r.base_bet,_stage_bet,_bal);
    IF _action_type = 'call' THEN
      _new_bet := _r.current_bet;
    ELSE
      _new_bet := GREATEST(_r.current_bet, _stage_bet + _amount);
    END IF;
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
    IF _r.phase='FIRST_BETTING' AND _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      PERFORM public.deal_next_card(_round_id);
      IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds
        SET stage=2, current_bet=0, current_turn_user_id=NULL, turn_deadline_at=NULL, last_activity_at=now()
        WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=true
        WHERE round_id=_round_id AND folded=false;
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      RETURN public.settle_round(_round_id);
    END IF;
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
  _actionable := public.actionable_betting_count(_round_id);

  IF _actionable <= 1 OR (_acted=_alive AND COALESCE(_equal,false)) THEN
    IF _r.stage=1 AND _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF _r.stage=1 AND _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      PERFORM public.deal_next_card(_round_id);
      IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      IF _actionable <= 1 THEN
        UPDATE public.game_rounds SET stage=2,current_bet=0,current_turn_user_id=NULL,
          turn_deadline_at=now()+interval '20 seconds', last_activity_at=now() WHERE id=_round_id;
        UPDATE public.game_round_players SET acted=true,
          player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'ACTIVE' END
         WHERE round_id=_round_id AND folded=false;
        IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','FINAL_HAND_SUBMIT') THEN
          RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
        END IF;
        UPDATE public.game_round_players SET player_status='HAND_SELECTION'
         WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
        RETURN jsonb_build_object('ok',true,'phase','FINAL_HAND_SUBMIT','stage',2,'dealt',true);
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
END $fn$;

CREATE OR REPLACE FUNCTION public.enforce_turn_timeout(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
  _actionable int;
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

  SELECT count(*) INTO _alive FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
  _actionable := public.actionable_betting_count(_round_id);
  _act := CASE
            WHEN _stage_bet >= _r.current_bet THEN 'check'
            WHEN COALESCE(_alive,0) <= 1 THEN 'check'
            WHEN COALESCE(_actionable,0) <= 1 THEN 'check'
            ELSE 'die'
          END;
  INSERT INTO public.game_actions(round_id,user_id,action_type,amount,turn_number,action_id)
  VALUES (_round_id,_u,_act,0,_r.stage,gen_random_uuid());
  IF _act='die' THEN
    UPDATE public.game_round_players SET folded=true,player_status='FOLDED',acted=true
    WHERE round_id=_round_id AND user_id=_u;
  ELSE
    UPDATE public.game_round_players SET acted=true WHERE round_id=_round_id AND user_id=_u;
  END IF;

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
  _actionable := public.actionable_betting_count(_round_id);
  IF _r.stage=1 AND (_alive<=1 OR _actionable<=1
      OR (SELECT bool_and(acted OR is_all_in) FROM public.game_round_players WHERE round_id=_round_id AND folded=false)) THEN
    IF _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    PERFORM public.deal_next_card(_round_id);
    IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    IF _alive > 1 AND _actionable <= 1 THEN
      UPDATE public.game_rounds SET stage=2,current_bet=0,current_turn_user_id=NULL,
        turn_deadline_at=now()+interval '20 seconds', last_activity_at=now() WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=true,
        player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'ACTIVE' END
       WHERE round_id=_round_id AND folded=false;
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','FINAL_HAND_SUBMIT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_round_players SET player_status='HAND_SELECTION'
       WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
      RETURN jsonb_build_object('ok',true,'phase','FINAL_HAND_SUBMIT','stage',2,'dealt',true);
    END IF;
    UPDATE public.game_rounds SET stage=2,current_bet=0,
      current_turn_user_id=(SELECT user_id FROM public.game_round_players WHERE round_id=_round_id AND folded=false AND is_all_in=false ORDER BY seat LIMIT 1),
      turn_deadline_at=now()+make_interval(secs=>_turn) WHERE id=_round_id;
    UPDATE public.game_round_players SET acted=false,player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'SQUEEZING' END
    WHERE round_id=_round_id AND folded=false;
    RETURN jsonb_build_object('ok',true,'phase','FINAL_BETTING','stage',2,'dealt',true);
  END IF;

  IF _r.stage>=2 AND (_alive<=1 OR _actionable<=1
      OR (SELECT bool_and(acted OR is_all_in) FROM public.game_round_players WHERE round_id=_round_id AND folded=false)) THEN
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
END $fn$;

CREATE OR REPLACE FUNCTION angel_internal.confirm_card_squeeze(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _r public.game_rounds;
  _me public.game_round_players;
  _pending int; _bad int; _next uuid; _turn int := 15; _alive int; _actionable int;
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
  UPDATE public.game_rounds SET last_activity_at = now() WHERE id = _round_id;

  SELECT count(*) INTO _pending FROM public.game_round_players
  WHERE round_id = _round_id AND folded = false
    AND player_status IN ('SQUEEZING','ALL_IN_SQUEEZING');
  IF _pending > 0 THEN RETURN jsonb_build_object('ok', true, 'phase', 'SQUEEZING', 'pending', _pending); END IF;

  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn
  FROM public.app_settings WHERE key = 'game_rules';
  SELECT count(*) INTO _alive FROM public.game_round_players
   WHERE round_id = _round_id AND folded = false;
  _actionable := public.actionable_betting_count(_round_id);
  SELECT user_id INTO _next FROM public.game_round_players
  WHERE round_id = _round_id AND folded = false AND is_all_in = false
  ORDER BY seat LIMIT 1;

  IF _next IS NULL OR _alive <= 1 OR _actionable <= 1 THEN
    IF NOT public.transition_game_round_phase(_round_id, 'SQUEEZING', 'SHOWDOWN') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds SET current_turn_user_id = NULL, turn_deadline_at = NULL WHERE id = _round_id;
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
END $fn$;

CREATE OR REPLACE FUNCTION public.select_open_card(_round_id uuid, _card text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _uid uuid := auth.uid(); _r public.game_rounds; _owned int; _pending int; _turn int := 15;
        _actionable int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL OR _r.status='finished' THEN RAISE EXCEPTION '진행 중인 라운드가 아닙니다.'; END IF;
  IF _r.phase <> 'OPEN_CARD_SELECTION' THEN RAISE EXCEPTION '지금은 공개패를 선택할 수 없습니다.'; END IF;

  SELECT count(*) INTO _owned FROM public.game_cards
   WHERE round_id=_round_id AND user_id=_uid AND card_code=_card;
  IF _owned <> 1 THEN RAISE EXCEPTION '보유하지 않은 카드입니다.'; END IF;

  UPDATE public.game_round_players SET open_card=_card, player_status='ACTIVE'
   WHERE round_id=_round_id AND user_id=_uid AND folded=false;

  SELECT count(*) INTO _pending FROM public.game_round_players
   WHERE round_id=_round_id AND folded=false AND open_card IS NULL;

  IF _pending = 0 THEN
    SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
    _actionable := public.actionable_betting_count(_round_id);
    UPDATE public.game_rounds
       SET phase='FIRST_BETTING',
           current_turn_user_id=CASE WHEN _actionable <= 1 THEN NULL ELSE
             (SELECT user_id FROM public.game_round_players
               WHERE round_id=_round_id AND folded=false AND is_all_in=false ORDER BY seat LIMIT 1) END,
           turn_deadline_at = CASE WHEN _actionable <= 1 THEN NULL
             ELSE now() + make_interval(secs => COALESCE(_turn,15)) END
     WHERE id=_round_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'pending',_pending);
END $fn$;

CREATE OR REPLACE FUNCTION angel_internal.advance_round_state(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _r public.game_rounds;
  _alive int; _bad int; _expected int; _next uuid; _turn int := 15; _p record; _actionable int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ROUND_NOT_FOUND'); END IF;
  IF _r.status = 'finished' THEN
    RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'noop', true);
  END IF;
  IF _r.paused_reason IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ROUND_PAUSED', 'reason', _r.paused_reason);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_round_players
                  WHERE round_id = _round_id AND user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_PARTICIPANT');
  END IF;

  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn,15);
  SELECT count(*) INTO _alive FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
  _actionable := public.actionable_betting_count(_round_id);

  IF _r.phase IN ('SQUEEZING','FINAL_BETTING','FINAL_HAND_SUBMIT','HAND_SELECTION') THEN
    _expected := CASE WHEN _r.game_mode='sutda3' THEN _r.stage + 1 ELSE _r.stage END;
    SELECT count(*) INTO _bad FROM public.game_round_players p
     WHERE p.round_id=_round_id AND p.folded=false
       AND (SELECT count(*) FROM public.game_cards c
             WHERE c.round_id=_round_id AND c.user_id=p.user_id) <> _expected;
    IF _bad > 0 THEN
      UPDATE public.game_rounds SET paused_reason='ROUND_CARD_INTEGRITY_ERROR' WHERE id=_round_id;
      PERFORM public.log_room_event(
        _r.room_id, 'ROUND_PAUSED', auth.uid(), _round_id, NULL, NULL, _r.pot, _r.pot,
        jsonb_build_object('phase', _r.phase, 'expected', _expected),
        jsonb_build_object('invalidPlayers', _bad), NULL, 'DENIED', 'ROUND_CARD_INTEGRITY_ERROR');
      RETURN jsonb_build_object('ok', false, 'error', 'ROUND_PAUSED', 'reason', 'ROUND_CARD_INTEGRITY_ERROR');
    END IF;
  END IF;

  IF _r.phase = 'OPEN_CARD_SELECTION' THEN
    IF _r.turn_deadline_at IS NULL THEN
      UPDATE public.game_rounds SET turn_deadline_at = now() + interval '20 seconds' WHERE id=_round_id;
      RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'armed', true);
    END IF;
    IF _r.turn_deadline_at > now() THEN
      RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'waiting', true);
    END IF;
    FOR _p IN SELECT * FROM public.game_round_players
               WHERE round_id=_round_id AND folded=false AND open_card IS NULL LOOP
      UPDATE public.game_round_players
      SET open_card = (SELECT c.card_code FROM public.game_cards c
                        WHERE c.round_id=_round_id AND c.user_id=_p.user_id
                        ORDER BY c.card_order LIMIT 1),
          player_status = 'ACTIVE'
      WHERE id = _p.id;
    END LOOP;
    IF NOT public.transition_game_round_phase(_round_id,'OPEN_CARD_SELECTION','FIRST_BETTING') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds
    SET current_turn_user_id = CASE WHEN _actionable <= 1 THEN NULL ELSE
                                 (SELECT user_id FROM public.game_round_players
                                   WHERE round_id=_round_id AND folded=false AND is_all_in=false
                                   ORDER BY seat LIMIT 1) END,
        turn_deadline_at = CASE WHEN _actionable <= 1 THEN NULL
                                ELSE now() + make_interval(secs => _turn) END,
        last_activity_at = now()
    WHERE id=_round_id;
    RETURN jsonb_build_object('ok', true, 'phase', 'FIRST_BETTING', 'auto', 'open_card_timeout');
  END IF;

  IF _r.phase = 'SQUEEZING' THEN
    IF _r.turn_deadline_at IS NULL THEN
      UPDATE public.game_rounds SET turn_deadline_at = now() + interval '20 seconds' WHERE id=_round_id;
      RETURN jsonb_build_object('ok', true, 'phase', 'SQUEEZING', 'armed', true);
    END IF;
    IF _r.turn_deadline_at > now() THEN
      RETURN jsonb_build_object('ok', true, 'phase', 'SQUEEZING', 'waiting', true);
    END IF;
    UPDATE public.game_round_players
    SET player_status = CASE WHEN is_all_in THEN 'ALL_IN_READY' ELSE 'SQUEEZE_READY' END
    WHERE round_id=_round_id AND folded=false
      AND player_status IN ('SQUEEZING','ALL_IN_SQUEEZING');
    SELECT user_id INTO _next FROM public.game_round_players
     WHERE round_id=_round_id AND folded=false AND is_all_in=false ORDER BY seat LIMIT 1;
    IF _next IS NULL OR _alive <= 1 OR _actionable <= 1 THEN
      IF NOT public.transition_game_round_phase(_round_id,'SQUEEZING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds SET current_turn_user_id=NULL, turn_deadline_at=NULL WHERE id=_round_id;
      RETURN public.settle_round(_round_id);
    END IF;
    IF NOT public.transition_game_round_phase(_round_id,'SQUEEZING','FINAL_BETTING') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds
    SET current_turn_user_id=_next, turn_deadline_at=now()+make_interval(secs=>_turn), last_activity_at=now()
    WHERE id=_round_id;
    UPDATE public.game_round_players
    SET acted=false, player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'ACTIVE' END
    WHERE round_id=_round_id AND folded=false;
    RETURN jsonb_build_object('ok', true, 'phase','FINAL_BETTING', 'auto','squeeze_timeout');
  END IF;

  IF _r.phase IN ('FIRST_BETTING','FINAL_BETTING') THEN
    IF _actionable <= 1
       OR _r.current_turn_user_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.game_round_players
                       WHERE round_id=_round_id AND user_id=_r.current_turn_user_id
                         AND folded=false AND is_all_in=false) THEN
      IF _actionable > 1 THEN
        SELECT user_id INTO _next FROM public.game_round_players
         WHERE round_id=_round_id AND folded=false AND is_all_in=false AND acted=false
         ORDER BY seat LIMIT 1;
        IF _next IS NOT NULL THEN
          UPDATE public.game_rounds
          SET current_turn_user_id=_next, turn_deadline_at=now()+make_interval(secs=>_turn), last_activity_at=now()
          WHERE id=_round_id;
          RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'recovered', 'turn');
        END IF;
      END IF;
      IF _r.phase='FIRST_BETTING' THEN
        IF _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
        IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
          RETURN jsonb_build_object('ok', false, 'error','INVALID_PHASE_TRANSITION');
        END IF;
        PERFORM public.deal_next_card(_round_id);
        IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
          RETURN jsonb_build_object('ok', false, 'error','INVALID_PHASE_TRANSITION');
        END IF;
        IF _alive > 1 AND _actionable <= 1 THEN
          UPDATE public.game_rounds SET stage=2, current_bet=0, current_turn_user_id=NULL,
            turn_deadline_at=now()+interval '20 seconds', last_activity_at=now() WHERE id=_round_id;
          UPDATE public.game_round_players SET acted=true,
            player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'ACTIVE' END
           WHERE round_id=_round_id AND folded=false;
          IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','FINAL_HAND_SUBMIT') THEN
            RETURN jsonb_build_object('ok', false, 'error','INVALID_PHASE_TRANSITION');
          END IF;
          UPDATE public.game_round_players SET player_status='HAND_SELECTION'
           WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
          RETURN jsonb_build_object('ok', true, 'phase','FINAL_HAND_SUBMIT', 'auto','no_actionable_player');
        END IF;
        UPDATE public.game_rounds SET stage=2, current_bet=0, last_activity_at=now(),
          current_turn_user_id=(SELECT user_id FROM public.game_round_players
                                 WHERE round_id=_round_id AND folded=false AND is_all_in=false
                                 ORDER BY seat LIMIT 1),
          turn_deadline_at=now()+make_interval(secs=>_turn) WHERE id=_round_id;
        UPDATE public.game_round_players SET acted=false,
          player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'SQUEEZING' END
         WHERE round_id=_round_id AND folded=false;
        RETURN jsonb_build_object('ok', true, 'phase','FINAL_BETTING', 'auto','first_betting_complete');
      END IF;
      IF _r.game_mode='sutda3' THEN
        IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','FINAL_HAND_SUBMIT') THEN
          RETURN jsonb_build_object('ok', false, 'error','INVALID_PHASE_TRANSITION');
        END IF;
        UPDATE public.game_rounds SET current_turn_user_id=NULL,
          turn_deadline_at=now()+interval '20 seconds', last_activity_at=now() WHERE id=_round_id;
        UPDATE public.game_round_players SET player_status='HAND_SELECTION'
         WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
        RETURN jsonb_build_object('ok', true, 'phase','FINAL_HAND_SUBMIT');
      END IF;
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok', false, 'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds SET current_turn_user_id=NULL, turn_deadline_at=NULL WHERE id=_round_id;
      RETURN public.settle_round(_round_id);
    END IF;

    IF _r.turn_deadline_at IS NULL THEN
      UPDATE public.game_rounds SET turn_deadline_at=now()+make_interval(secs=>_turn) WHERE id=_round_id;
      RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'armed', true);
    END IF;
    IF _r.turn_deadline_at <= now() THEN RETURN public.enforce_turn_timeout(_round_id); END IF;
    RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'waiting', true);
  END IF;

  IF _r.phase IN ('FINAL_HAND_SUBMIT','HAND_SELECTION') THEN
    IF _r.turn_deadline_at IS NULL THEN
      UPDATE public.game_rounds SET turn_deadline_at=now()+interval '20 seconds' WHERE id=_round_id;
      RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'armed', true);
    END IF;
    IF _r.turn_deadline_at <= now() THEN RETURN public.enforce_turn_timeout(_round_id); END IF;
    RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'waiting', true);
  END IF;

  IF _r.phase = 'SHOWDOWN' THEN RETURN public.settle_round(_round_id); END IF;

  RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'noop', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.dori_advance(_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
declare
  _r public.dori_rounds; _alive int; _next uuid;
  _s int; _cur_seat int; _i int; _actionable int;
begin
  select * into _r from public.dori_rounds where id = _round_id;
  if _r.id is null or _r.status <> 'PLAYING' then return; end if;

  select count(*) into _alive from public.dori_round_players where round_id = _round_id and folded = false;
  if _alive <= 1 then
    update public.dori_rounds set phase = 'SHOWDOWN', current_turn_user_id = null where id = _round_id;
    perform public.dori_settle_round(_round_id);
    return;
  end if;

  if _r.phase = 'MAKE_SELECTION' then
    if not exists (select 1 from public.dori_round_players
                    where round_id = _round_id and folded = false and make_status = 'PENDING') then
      update public.dori_rounds set phase = 'BETTING_FINAL', current_bet = 0, raise_count = 0,
             current_turn_user_id = null, turn_deadline_at = now() + interval '30 seconds'
       where id = _round_id;
      update public.dori_round_players set acted = false, round_bet = 0 where round_id = _round_id;
      select * into _r from public.dori_rounds where id = _round_id;
    else
      update public.dori_rounds set current_turn_user_id = null where id = _round_id;
      return;
    end if;
  end if;

  if _r.phase in ('BETTING_1','BETTING_2','BETTING_FINAL') then
    _actionable := public.dori_actionable_betting_count(_round_id);
    if _actionable <= 1 or not exists (
      select 1 from public.dori_round_players
       where round_id = _round_id and folded = false and is_all_in = false
         and (acted = false or round_bet < _r.current_bet))
    then
      if _r.phase = 'BETTING_1' then
        update public.dori_rounds set phase = 'BETTING_2', current_turn_user_id = null,
               current_bet = 0, raise_count = 0, turn_deadline_at = now() + interval '30 seconds'
          where id = _round_id;
        update public.dori_round_players set acted = false, round_bet = 0 where round_id = _round_id;
        perform public.dori_advance(_round_id);
        return;
      elsif _r.phase = 'BETTING_2' then
        update public.dori_rounds set phase = 'MAKE_SELECTION', current_turn_user_id = null,
               current_bet = 0, raise_count = 0, turn_deadline_at = now() + interval '60 seconds'
          where id = _round_id;
        update public.dori_round_players set acted = false, round_bet = 0 where round_id = _round_id;
        update public.dori_round_players rp set make_status = 'HWANG'
          where rp.round_id = _round_id and rp.folded = false
            and jsonb_array_length(public.dori_make_options(
                 (select array_agg(c.card_code order by c.deal_order) from public.dori_cards c
                   where c.round_id = _round_id and c.user_id = rp.user_id))) = 0;
        perform public.dori_advance(_round_id);
        return;
      else
        update public.dori_rounds set phase = 'SHOWDOWN', current_turn_user_id = null where id = _round_id;
        perform public.dori_settle_round(_round_id);
        return;
      end if;
    end if;

    select seat into _cur_seat from public.dori_round_players
      where round_id = _round_id and user_id = _r.current_turn_user_id;
    if _cur_seat is null then _cur_seat := _r.dealer_seat - 1; end if;

    _next := null;
    for _i in 0..3 loop
      _s := ((_cur_seat - 1 + _i + 1) % 4) + 1;
      select user_id into _next from public.dori_round_players
        where round_id = _round_id and seat = _s and folded = false and is_all_in = false
          and (acted = false or round_bet < _r.current_bet);
      if _next is not null then exit; end if;
    end loop;
    if _next is null then
      select user_id into _next from public.dori_round_players
        where round_id = _round_id and folded = false and is_all_in = false
          and (acted = false or round_bet < _r.current_bet) order by seat limit 1;
    end if;
    update public.dori_rounds set current_turn_user_id = _next,
           turn_deadline_at = now() + interval '30 seconds', last_activity_at = now()
      where id = _round_id;
  end if;
end $fn$;