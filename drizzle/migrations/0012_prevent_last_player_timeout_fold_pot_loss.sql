-- 재발 방지 1) 시간 초과 자동 처리에서 "마지막 남은 1명"은 다이 대신 체크로 처리한다.
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

  -- 남은 생존자가 나 혼자면 이미 다이 승 확정 판이다 → 자동 다이 금지(체크 처리)
  SELECT count(*) INTO _alive FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
  _act := CASE
            WHEN _stage_bet >= _r.current_bet THEN 'check'
            WHEN COALESCE(_alive,0) <= 1 THEN 'check'
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

-- 재발 방지 2) 어떤 경로로든 생존자가 0명이면 POT 을 소멸시키지 않고 베팅 전액을 환급한다.
CREATE OR REPLACE FUNCTION public.settle_round_without_phase_guard(_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.game_rounds; _p record; _hand jsonb; _pot bigint; _alive int := 0; _total int := 0;
  _scores jsonb := '{}'::jsonb; _codes jsonb := '{}'::jsonb; _eff jsonb := '{}'::jsonb; _best int := -1;
  _winners uuid[] := '{}'; _gusa boolean := false; _rematch_users uuid[] := '{}';
  _caps jsonb := '{}'::jsonb; _pots jsonb; _layer jsonb; _rec record;
  _pays jsonb := '{}'::jsonb; _elig text[]; _u text; _sc int; _lbest int; _lw text[];
  _share bigint; _rem bigint; _amt bigint; _firstw uuid; _win_code text;
  _pay bigint; _bal bigint; _season uuid; _all_winners uuid[] := '{}';
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.settled OR _r.settlement_status IN ('SETTLED','REMATCH') THEN
    RETURN jsonb_build_object('alreadySettled', true, 'roundId', _round_id);
  END IF;

  SELECT count(*) INTO _total FROM public.game_round_players WHERE round_id=_round_id;

  FOR _p IN SELECT * FROM public.game_round_players
            WHERE round_id=_round_id AND folded=false ORDER BY seat LOOP
    _alive := _alive + 1;
    _hand := public.round_player_hand(_round_id, _p.user_id);
    UPDATE public.game_round_players
       SET hand_code = _hand->'hand'->>'code', hand_rank = _hand->'hand'->>'name'
     WHERE id = _p.id;
    _sc := COALESCE((_hand->'hand'->>'score')::int, 0);
    _scores := jsonb_set(_scores, ARRAY[_p.user_id::text], to_jsonb(_sc));
    _codes := jsonb_set(_codes, ARRAY[_p.user_id::text], to_jsonb(COALESCE(_hand->'hand'->>'code','')));
  END LOOP;

  _pot := COALESCE((SELECT sum(amount) FROM public.game_actions WHERE round_id=_round_id), 0)
          + COALESCE(_r.carry_in, 0);

  -- 생존자 0명(전원 다이): 승자가 없으므로 POT 을 소멸시키지 않고 각자 베팅액을 환급한다.
  IF _alive = 0 AND _total > 0 THEN
    FOR _p IN SELECT * FROM public.game_round_players WHERE round_id=_round_id ORDER BY seat LOOP
      _pay := COALESCE(_p.total_bet, 0);
      SELECT game_points INTO _bal FROM public.profiles WHERE id=_p.user_id FOR UPDATE;
      IF _pay > 0 THEN
        UPDATE public.profiles SET game_points = game_points + _pay WHERE id = _p.user_id;
        INSERT INTO public.point_transactions(user_id, type, amount, balance_before, balance_after,
          locked_before, locked_after, reference_type, reference_id, memo)
        SELECT _p.user_id, 'game_refund', _pay, _bal, _bal + _pay, pr.locked_points, pr.locked_points,
               'game_round', _round_id, '전원 다이 · 베팅 환급'
        FROM public.profiles pr WHERE pr.id=_p.user_id;
      END IF;
      UPDATE public.game_round_players
         SET result='lose', result_type='REFUND', player_status='FINISHED',
             final_points = COALESCE(_bal,0) + _pay
       WHERE id=_p.id;
    END LOOP;
    UPDATE public.game_rounds
       SET status='finished', phase='FINISHED', pot=_pot, settled=true, settlement_status='SETTLED',
           settled_at=now(), finished_at=now(), current_turn_user_id=NULL, turn_deadline_at=NULL,
           winner_id=NULL, fold_win_reveal_choice=NULL, fold_win_reveal_deadline=NULL
     WHERE id=_round_id;
    UPDATE public.game_rooms
       SET carry_pot = COALESCE(_r.carry_in,0), rematch_pending = false,
           rematch_users = '{}', carry_caps = '{}'::jsonb
     WHERE id = _r.room_id;
    BEGIN
      PERFORM public.log_room_event(
        _r.room_id, 'SETTLEMENT', NULL, _round_id, NULL, NULL, _pot, 0,
        jsonb_build_object('alive', 0), jsonb_build_object('refunded', true),
        NULL, 'OK', 'ALL_FOLDED_REFUND');
    EXCEPTION WHEN others THEN NULL;
    END;
    PERFORM public.process_leave_pending(_r.room_id);
    PERFORM public.close_or_hold_room(_r.room_id);
    RETURN jsonb_build_object('roundId',_round_id,'pot',_pot,'refunded',true,
      'winners','[]'::jsonb,'reason','ALL_FOLDED');
  END IF;

  -- 특수족보 contextual 적용 (암행어사/땡잡이/구사)
  _eff := public.apply_contextual_rules(_scores, _codes);

  -- 구사 재경기 발동 여부: 멍텅구리구사는 항상, 일반 구사는 38광땡 상대가 없을 때
  _gusa := public.gusa_rematch_required(_scores, _codes) AND _alive > 1;

  SELECT max(value::int) INTO _best FROM jsonb_each_text(_eff);
  SELECT array_agg(p.user_id ORDER BY p.seat) INTO _winners
    FROM public.game_round_players p
   WHERE p.round_id=_round_id AND p.folded=false
     AND COALESCE((_eff->>p.user_id::text)::int,-1) = _best;
  _win_code := _codes->>(_winners[1])::text;

  IF _alive > 1 AND (_gusa OR COALESCE(array_length(_winners,1),0) > 1) THEN
    IF _gusa THEN
      SELECT array_agg(user_id ORDER BY seat) INTO _rematch_users
        FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
    ELSE
      _rematch_users := _winners;
    END IF;
    SELECT COALESCE(jsonb_object_agg(user_id::text, total_bet), '{}'::jsonb) INTO _caps
      FROM public.game_round_players
     WHERE round_id=_round_id AND user_id = ANY(_rematch_users);

    UPDATE public.game_round_players
       SET result_type = CASE WHEN user_id = ANY(_rematch_users) THEN 'REMATCH' ELSE 'LOSE' END,
           result = CASE WHEN user_id = ANY(_rematch_users) THEN NULL ELSE 'lose' END,
           player_status = 'FINISHED',
           final_points = (SELECT game_points FROM public.profiles WHERE id = game_round_players.user_id)
     WHERE round_id = _round_id;
    UPDATE public.game_rounds
       SET status='finished', phase='FINISHED', pot=_pot, settled=true, settlement_status='REMATCH',
           settled_at=now(), finished_at=now(), current_turn_user_id=NULL, turn_deadline_at=NULL,
           winner_id=NULL
     WHERE id=_round_id;
    UPDATE public.game_rooms
       SET carry_pot = _pot, rematch_pending = true,
           rematch_users = _rematch_users, carry_caps = _caps
     WHERE id = _r.room_id;
    PERFORM public.process_leave_pending(_r.room_id);
    PERFORM public.close_or_hold_room(_r.room_id);
    RETURN jsonb_build_object('roundId',_round_id,'rematch',true,'reason',
      CASE WHEN _gusa THEN 'GUSA' ELSE 'DRAW' END,'carryPot',_pot);
  END IF;

  _pots := public.build_side_pots(_round_id);
  FOR _rec IN SELECT value AS v FROM jsonb_array_elements(_pots) LOOP
    _layer := _rec.v;
    _amt := (_layer->>'amount')::bigint;
    IF _amt <= 0 THEN CONTINUE; END IF;
    SELECT array_agg(t) INTO _elig FROM jsonb_array_elements_text(_layer->'eligible') t;
    IF _elig IS NULL THEN CONTINUE; END IF;
    _lbest := -1; _lw := '{}';
    FOREACH _u IN ARRAY _elig LOOP
      _sc := COALESCE((_eff->>_u)::int, -1);
      IF _sc > _lbest THEN _lbest := _sc; _lw := ARRAY[_u];
      ELSIF _sc = _lbest THEN _lw := _lw || _u; END IF;
    END LOOP;
    IF COALESCE(array_length(_lw,1),0) = 0 THEN CONTINUE; END IF;
    _share := _amt / array_length(_lw,1);
    _rem := _amt - _share * array_length(_lw,1);
    SELECT user_id INTO _firstw FROM public.game_round_players
     WHERE round_id=_round_id AND user_id::text = ANY(_lw) ORDER BY seat LIMIT 1;
    FOREACH _u IN ARRAY _lw LOOP
      _pay := _share + CASE WHEN _u = _firstw::text THEN _rem ELSE 0 END;
      _pays := jsonb_set(_pays, ARRAY[_u], to_jsonb(COALESCE((_pays->>_u)::bigint,0) + _pay));
      IF _pay > 0 AND NOT (_u::uuid = ANY(_all_winners)) THEN
        _all_winners := _all_winners || _u::uuid;
      END IF;
    END LOOP;
  END LOOP;

  FOR _p IN SELECT * FROM public.game_round_players WHERE round_id=_round_id ORDER BY seat LOOP
    _pay := COALESCE((_pays->>_p.user_id::text)::bigint, 0);
    SELECT game_points INTO _bal FROM public.profiles WHERE id=_p.user_id FOR UPDATE;
    IF _pay > 0 THEN
      UPDATE public.profiles SET game_points = game_points + _pay, wins = wins + 1
       WHERE id = _p.user_id;
      INSERT INTO public.point_transactions(user_id, type, amount, balance_before, balance_after,
        locked_before, locked_after, reference_type, reference_id, memo)
      SELECT _p.user_id, 'game_win', _pay, _bal, _bal + _pay, pr.locked_points, pr.locked_points,
             'game_round', _round_id, '게임 정산'
      FROM public.profiles pr WHERE pr.id=_p.user_id;
      UPDATE public.game_round_players
         SET result='win', result_type='WIN', final_points=_bal + _pay, player_status='FINISHED'
       WHERE id=_p.id;

      SELECT id INTO _season FROM public.ensure_weekly_season();
      IF _season IS NOT NULL AND _pay > _p.total_bet THEN
        INSERT INTO public.weekly_profit_stats(season_id, user_id, win_points, win_count, games_played, last_win_at)
        VALUES (_season, _p.user_id, _pay - _p.total_bet, 1, 1, now())
        ON CONFLICT (season_id, user_id) DO UPDATE
          SET win_points = public.weekly_profit_stats.win_points + EXCLUDED.win_points,
              win_count = public.weekly_profit_stats.win_count + 1,
              games_played = public.weekly_profit_stats.games_played + 1,
              last_win_at = now();
      END IF;
      IF _season IS NOT NULL AND COALESCE(_codes->>_p.user_id::text,'') LIKE 'kwang%' THEN
        INSERT INTO public.weekly_gwang_stats(season_id, user_id,
          gwang38_wins, gwang18_wins, gwang13_wins, total_gwang_wins, games_played, last_gwang_at)
        VALUES (_season, _p.user_id,
          CASE WHEN _codes->>_p.user_id::text='kwang38' THEN 1 ELSE 0 END,
          CASE WHEN _codes->>_p.user_id::text='kwang18' THEN 1 ELSE 0 END,
          CASE WHEN _codes->>_p.user_id::text='kwang13' THEN 1 ELSE 0 END, 1, 1, now())
        ON CONFLICT (season_id, user_id) DO UPDATE
          SET gwang38_wins = public.weekly_gwang_stats.gwang38_wins + EXCLUDED.gwang38_wins,
              gwang18_wins = public.weekly_gwang_stats.gwang18_wins + EXCLUDED.gwang18_wins,
              gwang13_wins = public.weekly_gwang_stats.gwang13_wins + EXCLUDED.gwang13_wins,
              total_gwang_wins = public.weekly_gwang_stats.total_gwang_wins + 1,
              games_played = public.weekly_gwang_stats.games_played + 1,
              last_gwang_at = now();
        UPDATE public.profiles SET gwangttaeng_count = gwangttaeng_count + 1 WHERE id=_p.user_id;
      END IF;
    ELSE
      UPDATE public.profiles SET losses = losses + 1 WHERE id = _p.user_id;
      UPDATE public.game_round_players
         SET result='lose', result_type='LOSE', player_status='FINISHED', final_points=_bal
       WHERE id=_p.id;
    END IF;
  END LOOP;

  UPDATE public.game_rounds
     SET status='finished', phase='FINISHED', pot=_pot, settled=true, settlement_status='SETTLED',
         settled_at=now(), finished_at=now(), current_turn_user_id=NULL, turn_deadline_at=NULL,
         winner_id = CASE WHEN COALESCE(array_length(_all_winners,1),0)=1 THEN _all_winners[1] ELSE NULL END,
         fold_win_reveal_choice = CASE WHEN _alive = 1 AND _total > 1 THEN 'PENDING' ELSE NULL END,
         fold_win_reveal_deadline = CASE WHEN _alive = 1 AND _total > 1 THEN now() + interval '5 seconds' ELSE NULL END
   WHERE id=_round_id;

  UPDATE public.game_rooms
     SET carry_pot = 0, rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
   WHERE id = _r.room_id;
  PERFORM public.process_leave_pending(_r.room_id);
  PERFORM public.close_or_hold_room(_r.room_id);

  RETURN jsonb_build_object('roundId',_round_id,'pot',_pot,'winners',to_jsonb(_all_winners),
    'handCode',_win_code,'pots',_pots,'foldWin',(_alive = 1 AND _total > 1));
END; $function$;