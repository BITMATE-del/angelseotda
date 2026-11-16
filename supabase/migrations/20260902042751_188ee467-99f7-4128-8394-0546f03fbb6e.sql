ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS paused_reason text;

CREATE OR REPLACE FUNCTION public.bump_round_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.game_rounds SET last_activity_at = now() WHERE id = NEW.round_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bump_round_activity ON public.game_actions;
CREATE TRIGGER trg_bump_round_activity
AFTER INSERT ON public.game_actions
FOR EACH ROW EXECUTE FUNCTION public.bump_round_activity();

-- 2장 섯다 1차 베팅 완료 → 두 번째 카드 배분 → 쪼기(제한시간 부여)
CREATE OR REPLACE FUNCTION public.complete_sutda2_first_betting(_round_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _r public.game_rounds;
  _bad int;
  _dealt int;
  _alive int;
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
    UPDATE public.game_rounds SET paused_reason = 'ROUND_CARD_INTEGRITY_ERROR' WHERE id = _round_id;
    PERFORM public.log_room_event(
      _r.room_id, 'ROUND_CARD_INTEGRITY_ERROR', NULL, _round_id, NULL, NULL,
      _r.pot, _r.pot, jsonb_build_object('expected', 2),
      jsonb_build_object('invalidPlayers', _bad), NULL, 'DENIED', 'ROUND_CARD_INTEGRITY_ERROR'
    );
    RETURN jsonb_build_object('ok', false, 'error', 'ROUND_CARD_INTEGRITY_ERROR');
  END IF;

  UPDATE public.game_rounds
  SET stage = 2, current_bet = 0, current_turn_user_id = NULL,
      turn_deadline_at = now() + interval '20 seconds', last_activity_at = now()
  WHERE id = _round_id;
  UPDATE public.game_round_players
  SET acted = false,
      player_status = CASE WHEN is_all_in THEN 'ALL_IN_SQUEEZING' ELSE 'SQUEEZING' END
  WHERE round_id = _round_id AND folded = false;

  IF NOT public.transition_game_round_phase(_round_id, 'DEALING_SECOND_CARD', 'SQUEEZING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHASE_TRANSITION');
  END IF;

  SELECT count(*) INTO _alive FROM public.game_round_players
   WHERE round_id = _round_id AND folded = false;
  IF _alive <= 1 THEN
    IF public.transition_game_round_phase(_round_id, 'SQUEEZING', 'SHOWDOWN') THEN
      UPDATE public.game_rounds SET current_turn_user_id = NULL, turn_deadline_at = NULL WHERE id = _round_id;
      RETURN public.settle_round(_round_id);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'phase', 'SQUEEZING', 'stage', 2, 'dealt', _dealt);
END $function$;

-- 쪼기 확정: 생존자 1명이면 즉시 SHOWDOWN
CREATE OR REPLACE FUNCTION angel_internal.confirm_card_squeeze(_round_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _r public.game_rounds;
  _me public.game_round_players;
  _pending int; _bad int; _next uuid; _turn int := 15; _alive int;
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
  SELECT user_id INTO _next FROM public.game_round_players
  WHERE round_id = _round_id AND folded = false AND is_all_in = false
  ORDER BY seat LIMIT 1;

  IF _next IS NULL OR _alive <= 1 THEN
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
END $function$;

-- 서버 WATCHDOG: 멈춘 라운드 감지 후 안전 복구 (강제 승패 판정은 하지 않는다)
CREATE OR REPLACE FUNCTION angel_internal.advance_round_state(_round_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _r public.game_rounds;
  _alive int; _bad int; _expected int; _next uuid; _turn int := 15; _p record;
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

  -- 카드 정합성 오류는 절대 강제 진행하지 않는다 → ROUND_PAUSED
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

  -- 3장 섯다 공개패 미선택으로 멈춘 경우
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
    SET current_turn_user_id = (SELECT user_id FROM public.game_round_players
                                 WHERE round_id=_round_id AND folded=false AND is_all_in=false
                                 ORDER BY seat LIMIT 1),
        turn_deadline_at = now() + make_interval(secs => _turn), last_activity_at = now()
    WHERE id=_round_id;
    RETURN jsonb_build_object('ok', true, 'phase', 'FIRST_BETTING', 'auto', 'open_card_timeout');
  END IF;

  -- 쪼기 단계 정지
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
    IF _next IS NULL OR _alive <= 1 THEN
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

  -- 베팅 단계 정지
  IF _r.phase IN ('FIRST_BETTING','FINAL_BETTING') THEN
    IF _r.current_turn_user_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.game_round_players
                       WHERE round_id=_round_id AND user_id=_r.current_turn_user_id
                         AND folded=false AND is_all_in=false) THEN
      SELECT user_id INTO _next FROM public.game_round_players
       WHERE round_id=_round_id AND folded=false AND is_all_in=false AND acted=false
       ORDER BY seat LIMIT 1;
      IF _next IS NOT NULL THEN
        UPDATE public.game_rounds
        SET current_turn_user_id=_next, turn_deadline_at=now()+make_interval(secs=>_turn), last_activity_at=now()
        WHERE id=_round_id;
        RETURN jsonb_build_object('ok', true, 'phase', _r.phase, 'recovered', 'turn');
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
END $function$;

CREATE OR REPLACE FUNCTION public.advance_round_state(_round_id uuid)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
AS $function$ SELECT angel_internal.advance_round_state(_round_id) $function$;

GRANT EXECUTE ON FUNCTION public.advance_round_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION angel_internal.advance_round_state(uuid) TO authenticated;