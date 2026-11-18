CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _r public.game_rounds; _p record; _best int := -1; _winners uuid[] := '{}';
  _hand jsonb; _pot bigint; _share bigint; _rem bigint; _first uuid; _season uuid;
  _alive int := 0; _win_code text; _bal bigint;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.settled OR _r.settlement_status = 'SETTLED' THEN
    RETURN jsonb_build_object('alreadySettled', true, 'roundId', _round_id);
  END IF;

  FOR _p IN SELECT * FROM public.game_round_players WHERE round_id=_round_id AND folded=false ORDER BY seat LOOP
    _alive := _alive + 1;
    _hand := public.round_player_hand(_round_id, _p.user_id);
    UPDATE public.game_round_players
       SET hand_code = _hand->'hand'->>'code', hand_rank = _hand->'hand'->>'name'
     WHERE id = _p.id;
    IF _alive = 1 OR (_hand->'hand'->>'score')::int > _best THEN
      IF (_hand->'hand'->>'score')::int > _best THEN
        _best := (_hand->'hand'->>'score')::int;
        _winners := ARRAY[_p.user_id];
        _win_code := _hand->'hand'->>'code';
      END IF;
    ELSIF (_hand->'hand'->>'score')::int = _best THEN
      _winners := _winners || _p.user_id;
    END IF;
  END LOOP;

  IF array_length(_winners,1) IS NULL THEN
    SELECT array_agg(user_id) INTO _winners FROM public.game_round_players WHERE round_id=_round_id;
  END IF;

  _pot := COALESCE((SELECT sum(amount) FROM public.game_actions WHERE round_id=_round_id), 0);
  _share := _pot / GREATEST(array_length(_winners,1),1);
  _rem := _pot - _share * GREATEST(array_length(_winners,1),1);
  SELECT user_id INTO _first FROM public.game_round_players
    WHERE round_id=_round_id AND user_id = ANY(_winners) ORDER BY seat LIMIT 1;

  FOR _p IN SELECT * FROM public.game_round_players WHERE round_id=_round_id LOOP
    IF _p.user_id = ANY(_winners) THEN
      DECLARE _pay bigint := _share + CASE WHEN _p.user_id = _first THEN _rem ELSE 0 END;
      BEGIN
        SELECT game_points INTO _bal FROM public.profiles WHERE id=_p.user_id FOR UPDATE;
        UPDATE public.profiles SET game_points = game_points + _pay,
               wins = wins + CASE WHEN array_length(_winners,1) = 1 THEN 1 ELSE 0 END
         WHERE id = _p.user_id;
        INSERT INTO public.point_transactions(user_id, type, amount, balance_before, balance_after,
          locked_before, locked_after, reference_type, reference_id, memo)
        SELECT _p.user_id, 'game_win', _pay, _bal, _bal + _pay, pr.locked_points, pr.locked_points,
               'game_round', _round_id, '게임 정산'
        FROM public.profiles pr WHERE pr.id=_p.user_id;

        UPDATE public.game_round_players
           SET result = CASE WHEN array_length(_winners,1) > 1 THEN 'draw' ELSE 'win' END,
               result_type = CASE WHEN array_length(_winners,1) > 1 THEN 'DRAW' ELSE 'WIN' END,
               final_points = _bal + _pay, player_status = 'FINISHED'
         WHERE id = _p.id;

        _season := NULL;
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
        IF _season IS NOT NULL AND _win_code LIKE 'kwang%' AND array_length(_winners,1)=1 THEN
          INSERT INTO public.weekly_gwang_stats(season_id, user_id,
            gwang38_wins, gwang18_wins, gwang13_wins, total_gwang_wins, games_played, last_gwang_at)
          VALUES (_season, _p.user_id,
            CASE WHEN _win_code='kwang38' THEN 1 ELSE 0 END,
            CASE WHEN _win_code='kwang18' THEN 1 ELSE 0 END,
            CASE WHEN _win_code='kwang13' THEN 1 ELSE 0 END, 1, 1, now())
          ON CONFLICT (season_id, user_id) DO UPDATE
            SET gwang38_wins = public.weekly_gwang_stats.gwang38_wins + EXCLUDED.gwang38_wins,
                gwang18_wins = public.weekly_gwang_stats.gwang18_wins + EXCLUDED.gwang18_wins,
                gwang13_wins = public.weekly_gwang_stats.gwang13_wins + EXCLUDED.gwang13_wins,
                total_gwang_wins = public.weekly_gwang_stats.total_gwang_wins + 1,
                games_played = public.weekly_gwang_stats.games_played + 1,
                last_gwang_at = now();
        END IF;
        UPDATE public.profiles SET gwangttaeng_count = gwangttaeng_count + 1
          WHERE id=_p.user_id AND _win_code LIKE 'kwang%' AND array_length(_winners,1)=1;
      END;
    ELSE
      UPDATE public.profiles SET losses = losses + 1 WHERE id = _p.user_id;
      UPDATE public.game_round_players
         SET result='lose', result_type='LOSE', player_status='FINISHED',
             final_points = (SELECT game_points FROM public.profiles WHERE id=_p.user_id)
       WHERE id = _p.id;
    END IF;
  END LOOP;

  UPDATE public.game_rounds
     SET status='finished', phase='FINISHED', pot=_pot, settled=true, settlement_status='SETTLED',
         settled_at=now(), finished_at=now(), current_turn_user_id=NULL, turn_deadline_at=NULL,
         winner_id = CASE WHEN array_length(_winners,1)=1 THEN _winners[1] ELSE NULL END
   WHERE id=_round_id;

  -- 게임방은 종료하지 않는다: 남은 인원에 따라 유지/대기/종료를 서버가 결정
  PERFORM public.close_or_hold_room(_r.room_id);

  RETURN jsonb_build_object('roundId',_round_id,'pot',_pot,'winners',to_jsonb(_winners),'handCode',_win_code);
END;
$function$;