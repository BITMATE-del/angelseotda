CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _r public.game_rounds; _p record; _hand jsonb; _pot bigint; _alive int := 0;
  _scores jsonb := '{}'::jsonb; _codes jsonb := '{}'::jsonb; _best int := -1;
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
    IF _hand->'hand'->>'code' = 'gusa' THEN _gusa := true; END IF;
  END LOOP;

  SELECT max(value::int) INTO _best FROM jsonb_each_text(_scores);
  SELECT array_agg(p.user_id ORDER BY p.seat) INTO _winners
    FROM public.game_round_players p
   WHERE p.round_id=_round_id AND p.folded=false
     AND COALESCE((_scores->>p.user_id::text)::int,-1) = _best;
  _win_code := _codes->>(_winners[1])::text;

  _pot := COALESCE((SELECT sum(amount) FROM public.game_actions WHERE round_id=_round_id), 0)
          + COALESCE(_r.carry_in, 0);

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
      _sc := COALESCE((_scores->>_u)::int, -1);
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
         winner_id = CASE WHEN COALESCE(array_length(_all_winners,1),0)=1 THEN _all_winners[1] ELSE NULL END
   WHERE id=_round_id;

  UPDATE public.game_rooms
     SET carry_pot = 0, rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
   WHERE id = _r.room_id;
  PERFORM public.process_leave_pending(_r.room_id);
  PERFORM public.close_or_hold_room(_r.room_id);

  RETURN jsonb_build_object('roundId',_round_id,'pot',_pot,'winners',to_jsonb(_all_winners),
    'handCode',_win_code,'pots',_pots);
END; $$;
REVOKE ALL ON FUNCTION public.settle_round(uuid) FROM anon, authenticated;