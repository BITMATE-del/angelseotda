CREATE SCHEMA IF NOT EXISTS angel_internal;
REVOKE ALL ON SCHEMA angel_internal FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA angel_internal TO authenticated, service_role;

ALTER FUNCTION public.confirm_card_squeeze(uuid) SET SCHEMA angel_internal;
REVOKE ALL ON FUNCTION angel_internal.confirm_card_squeeze(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION angel_internal.confirm_card_squeeze(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_card_squeeze(_round_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, angel_internal
AS $$
  SELECT angel_internal.confirm_card_squeeze(_round_id)
$$;
REVOKE ALL ON FUNCTION public.confirm_card_squeeze(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_card_squeeze(uuid) TO authenticated, service_role;

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
  IF _r.game_mode = 'sutda3' AND _r.phase NOT IN ('FIRST_BETTING','LAST_CARD_DEALT') THEN
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

CREATE OR REPLACE FUNCTION public.enforce_turn_timeout(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.game_rounds;
  _u uuid;
  _stage_bet bigint;
  _act text;
  _p record;
  _turn int := 15;
  _alive int;
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
END $$;
REVOKE ALL ON FUNCTION public.enforce_turn_timeout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_turn_timeout(uuid) TO authenticated, service_role;