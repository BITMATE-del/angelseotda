-- 1) 컬럼 추가
ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS is_rematch boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_round_players ADD COLUMN IF NOT EXISTS is_all_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_round_players ADD COLUMN IF NOT EXISTS all_in_at timestamptz;
ALTER TABLE public.game_round_players ADD COLUMN IF NOT EXISTS carry_bet bigint NOT NULL DEFAULT 0;
ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS rematch_pending boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS rematch_users uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS carry_caps jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) MAIN/SIDE POT 레이어 계산 (서버 전용)
CREATE OR REPLACE FUNCTION public.build_side_pots(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _r public.game_rounds; _lv bigint; _prev bigint := 0; _amt bigint; _elig uuid[];
  _pots jsonb := '[]'::jsonb; _total bigint; _alloc bigint := 0; _resid bigint;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  _total := COALESCE((SELECT sum(amount) FROM public.game_actions WHERE round_id=_round_id),0)
            + COALESCE(_r.carry_in,0);

  FOR _lv IN SELECT DISTINCT total_bet FROM public.game_round_players
             WHERE round_id=_round_id AND folded=false AND total_bet > 0 ORDER BY 1 LOOP
    SELECT COALESCE(sum(LEAST(total_bet,_lv) - LEAST(total_bet,_prev)),0) INTO _amt
      FROM public.game_round_players WHERE round_id=_round_id;
    SELECT array_agg(user_id ORDER BY seat) INTO _elig FROM public.game_round_players
      WHERE round_id=_round_id AND folded=false AND total_bet >= _lv;
    _pots := _pots || jsonb_build_array(jsonb_build_object(
      'level', _lv, 'amount', _amt, 'eligible', to_jsonb(COALESCE(_elig,'{}'::uuid[]))));
    _alloc := _alloc + _amt;
    _prev := _lv;
  END LOOP;

  IF jsonb_array_length(_pots) = 0 THEN
    SELECT array_agg(user_id ORDER BY seat) INTO _elig FROM public.game_round_players
      WHERE round_id=_round_id AND folded=false;
    IF _total > 0 THEN
      _pots := jsonb_build_array(jsonb_build_object('level',0,'amount',_total,
        'eligible', to_jsonb(COALESCE(_elig,'{}'::uuid[]))));
    END IF;
    RETURN _pots;
  END IF;

  -- 다이 초과 투입 / 이월 사구액(dead money)은 MAIN POT에 합산
  _resid := _total - _alloc;
  IF _resid > 0 THEN
    _pots := jsonb_set(_pots, ARRAY['0','amount'],
      to_jsonb(((_pots->0->>'amount')::bigint) + _resid));
  END IF;
  RETURN _pots;
END; $$;
REVOKE ALL ON FUNCTION public.build_side_pots(uuid) FROM anon;

-- 3) 정산: 동점/구사 → 재경기, 그 외 → 사이드팟 기반 지급
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

  -- 재경기 조건: 구사 또는 최고 족보 동점
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
       SET result = NULL,
           result_type = CASE WHEN user_id = ANY(_rematch_users) THEN 'REMATCH' ELSE 'LOSE' END,
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

  -- 사이드팟 계산 및 레이어별 승자 지급액 산출
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
      _pays := jsonb_set(_pays, ARRAY[_u],
        to_jsonb(COALESCE((_pays->>_u)::bigint,0) + _pay));
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

-- 4) 올인 액션
CREATE OR REPLACE FUNCTION public.place_bet_action(_round_id uuid, _action_id uuid, _action_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  IF _r.phase NOT IN ('BETTING','FIRST_BETTING','FINAL_BETTING') THEN
    RAISE EXCEPTION '지금은 베팅할 수 없습니다.';
  END IF;

  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
    WHERE round_id=_round_id AND user_id=_uid AND turn_number=_r.stage;
  _owed := GREATEST(_r.current_bet - _stage_bet, 0);
  _new_bet := _r.current_bet;
  SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;

  IF _action_type IN ('die','jjol') THEN
    _amount := 0;
    UPDATE public.game_round_players SET folded=true, player_status='FOLDED', acted=true WHERE id=_me.id;
  ELSIF _action_type = 'check' THEN
    IF _owed > 0 THEN RAISE EXCEPTION '체크할 수 없습니다.'; END IF;
    _amount := 0;
  ELSIF _action_type = 'call' THEN
    _amount := _owed;
  ELSIF _action_type = 'ping' THEN
    _amount := _owed + _r.base_bet;
    _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'ttadang' THEN
    _amount := _owed + GREATEST(_r.current_bet, _r.base_bet) * 2;
    _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'half' THEN
    _amount := _owed + GREATEST(_r.pot / 2, _r.base_bet);
    _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'all_in' THEN
    SELECT count(*) INTO _cnt FROM public.game_actions
      WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','all_in');
    IF _cnt < 2 THEN RAISE EXCEPTION '올인은 베팅이 2회 이상 진행된 후에 사용할 수 있습니다.'; END IF;
    IF COALESCE(_bal,0) <= 0 THEN RAISE EXCEPTION '보유 포인트가 없습니다.'; END IF;
    _amount := _bal;
    _new_bet := GREATEST(_r.current_bet, _stage_bet + _amount);
  ELSE
    RAISE EXCEPTION '알 수 없는 행동입니다: %', _action_type;
  END IF;

  IF _amount > _bal THEN
    _amount := _bal;
    _new_bet := GREATEST(_new_bet, _stage_bet + _amount);
  END IF;

  IF _amount > 0 THEN PERFORM public.game_take_bet(_uid, _amount, _round_id); END IF;

  INSERT INTO public.game_actions(round_id, user_id, action_type, amount, turn_number, action_id)
  VALUES (_round_id, _uid, _action_type, _amount, _r.stage, _action_id);

  UPDATE public.game_round_players
     SET acted = true, total_bet = total_bet + _amount,
         is_all_in = CASE WHEN folded THEN false
                          WHEN _action_type='all_in' OR _bal - _amount <= 0 THEN true ELSE is_all_in END,
         all_in_at = CASE WHEN NOT folded AND (_action_type='all_in' OR _bal - _amount <= 0)
                          THEN COALESCE(all_in_at, now()) ELSE all_in_at END,
         player_status = CASE WHEN folded THEN 'FOLDED'
                              WHEN _action_type='all_in' OR _bal - _amount <= 0 THEN 'ALL_IN'
                              ELSE 'ACTIVE' END
   WHERE id = _me.id;

  IF _new_bet > _r.current_bet THEN
    UPDATE public.game_round_players SET acted=false
      WHERE round_id=_round_id AND folded=false AND user_id <> _uid AND is_all_in=false;
  END IF;

  UPDATE public.game_rounds
     SET pot = pot + _amount, current_bet = GREATEST(_new_bet, current_bet)
   WHERE id=_round_id;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;

  SELECT count(*) INTO _alive FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
  IF _alive <= 1 THEN
    RETURN public.settle_round(_round_id);
  END IF;

  SELECT count(*) INTO _acted FROM public.game_round_players
    WHERE round_id=_round_id AND folded=false AND (acted=true OR is_all_in=true);
  SELECT bool_and(COALESCE(sb.s,0) = _r.current_bet OR p.is_all_in) INTO _equal
    FROM public.game_round_players p
    LEFT JOIN (SELECT user_id, sum(amount) s FROM public.game_actions
                WHERE round_id=_round_id AND turn_number=_r.stage GROUP BY user_id) sb
      ON sb.user_id = p.user_id
   WHERE p.round_id=_round_id AND p.folded=false;

  IF _acted = _alive AND COALESCE(_equal,false) THEN
    IF _r.game_mode = 'sutda3' AND _r.stage = 1 THEN
      UPDATE public.game_rounds
         SET stage = 2, phase = 'HAND_SELECTION', current_bet = 0,
             current_turn_user_id = NULL, turn_deadline_at = now() + interval '20 seconds'
       WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=false, player_status='SQUEEZING'
        WHERE round_id=_round_id AND folded=false;
      RETURN jsonb_build_object('phase','HAND_SELECTION');
    END IF;
    RETURN public.settle_round(_round_id);
  END IF;

  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);
  SELECT user_id INTO _next FROM (
    SELECT user_id, seat FROM public.game_round_players
     WHERE round_id=_round_id AND folded=false AND is_all_in=false
  ) q ORDER BY (q.seat > _me.seat) DESC, CASE WHEN q.seat > _me.seat THEN q.seat ELSE q.seat + 1000 END LIMIT 1;

  IF _next IS NULL THEN
    RETURN public.settle_round(_round_id);
  END IF;

  UPDATE public.game_rounds
     SET current_turn_user_id = _next, turn_deadline_at = now() + make_interval(secs => _turn)
   WHERE id=_round_id;

  RETURN jsonb_build_object('ok', true, 'turnUserId', _next, 'amount', _amount);
END; $$;

-- 5) 라운드 시작: 재경기는 강제 2장, 참가자/이월 투자액 유지
CREATE OR REPLACE FUNCTION public.start_game_round(_room_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid();
  _room public.game_rooms;
  _deck text[] := ARRAY['01-gwang','01-normal','02-a','02-b','03-gwang','03-normal','04-a','04-b',
                        '05-a','05-b','06-a','06-b','07-a','07-b','08-gwang','08-normal',
                        '09-a','09-b','10-a','10-b'];
  _shuffled text[]; _players record;
  _n int; _idx int := 0; _per int; _round_id uuid; _num int; _turn int := 15;
  _mode text; _first_seat int; _carry bigint := 0; _rematch boolean := false;
  _rusers uuid[]; _carrybet bigint;
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
    IF COALESCE(array_length(_rusers,1),0) < 2 THEN
      _rematch := false; _rusers := NULL;
    END IF;
  END IF;

  _mode := CASE WHEN _rematch THEN 'sutda2' ELSE _room.game_mode END;
  _per := CASE WHEN _mode = 'sutda3' THEN 3 ELSE 2 END;

  SELECT count(*) INTO _n FROM public.game_room_players rp
   WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
     AND (NOT _rematch OR rp.user_id = ANY(_rusers));
  IF _n < 2 THEN RAISE EXCEPTION '최소 2명이 필요합니다.'; END IF;
  IF _n * _per > 20 THEN RAISE EXCEPTION '인원이 너무 많습니다.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
      AND (NOT _rematch OR rp.user_id = ANY(_rusers))
      AND pr.game_points < _room.base_bet
  ) THEN RAISE EXCEPTION '기본 베팅 포인트가 부족한 참가자가 있습니다.'; END IF;

  SELECT COALESCE((value->>'turn_seconds')::int, 15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);
  SELECT COALESCE(max(round_number),0)+1 INTO _num FROM public.game_rounds WHERE room_id=_room_id;
  SELECT min(rp.seat) INTO _first_seat FROM public.game_room_players rp
   WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
     AND (NOT _rematch OR rp.user_id = ANY(_rusers));
  _carry := GREATEST(COALESCE(_room.carry_pot,0), 0);

  INSERT INTO public.game_rounds(room_id, round_number, game_mode, status, pot, phase, stage,
                                 base_bet, current_bet, dealer_seat, turn_deadline_at, carry_in, is_rematch)
  VALUES (_room_id, _num, _mode, 'betting', 0,
          CASE WHEN _mode='sutda3' THEN 'FIRST_BETTING' ELSE 'BETTING' END,
          1, _room.base_bet, _room.base_bet, _first_seat, now() + make_interval(secs => _turn),
          _carry, _rematch)
  RETURNING id INTO _round_id;

  SELECT array_agg(c ORDER BY gen_random_uuid()) INTO _shuffled FROM unnest(_deck) c;

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

    INSERT INTO public.game_round_players(round_id, user_id, seat, initial_points, folded,
                                          player_status, connection_status, acted, total_bet, carry_bet)
    VALUES (_round_id, _players.user_id, _players.seat, _players.game_points, false,
            'ACTIVE', 'CONNECTED', false, 0, _carrybet);

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
    UPDATE public.game_round_players SET total_bet = _room.base_bet + _carrybet
      WHERE round_id=_round_id AND user_id=_players.user_id;
  END LOOP;

  UPDATE public.game_rounds
     SET pot = _room.base_bet * _n + _carry,
         current_turn_user_id = (SELECT user_id FROM public.game_round_players
                                  WHERE round_id=_round_id ORDER BY seat LIMIT 1)
   WHERE id = _round_id;

  UPDATE public.game_rooms
     SET status = 'playing', carry_pot = 0, current_round_id = _round_id,
         rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
   WHERE id = _room_id;
  RETURN _round_id;
END; $$;

-- 6) 상태 조회: 올인 옵션 / 사이드팟 / 재경기 정보 노출
CREATE OR REPLACE FUNCTION public.get_round_state(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _seats jsonb; _finished boolean;
  _me public.game_round_players; _stage_bet bigint; _owed bigint; _bal bigint;
  _acts jsonb := '[]'::jsonb; _expected int; _bad int; _room public.game_rooms; _cnt int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _r.room_id;
  _finished := _r.status = 'finished';

  SELECT jsonb_agg(x ORDER BY (x->>'seat')::int) INTO _seats FROM (
    SELECT jsonb_build_object(
      'userId', p.user_id, 'seat', p.seat, 'nickname', pr.nickname, 'level', pr.level,
      'rank', pr.rank, 'avatarUrl', pr.avatar_url, 'points', pr.game_points,
      'initialPoints', p.initial_points, 'finalPoints', p.final_points,
      'folded', p.folded, 'status', p.player_status, 'connection', p.connection_status,
      'acted', p.acted, 'totalBet', p.total_bet, 'carryBet', p.carry_bet,
      'isAllIn', p.is_all_in, 'resultType', p.result_type,
      'isMe', p.user_id = _uid,
      'leavePending', COALESCE((SELECT rp.leave_pending FROM public.game_room_players rp
                                 WHERE rp.room_id=_r.room_id AND rp.user_id=p.user_id), false),
      'character', public.equipped_item_asset(p.user_id, 'character'),
      'title', public.equipped_item_asset(p.user_id, 'title'),
      'cardCount', (SELECT count(*) FROM public.game_cards c
                     WHERE c.round_id=_round_id AND c.user_id=p.user_id
                       AND (c.card_order <= 2 OR _r.stage >= 2)),
      'cards', CASE
        WHEN p.user_id = _uid OR (_finished AND NOT p.folded) THEN
          COALESCE((SELECT jsonb_agg(c.card_code ORDER BY c.card_order) FROM public.game_cards c
             WHERE c.round_id=_round_id AND c.user_id=p.user_id
               AND (c.card_order <= 2 OR _r.stage >= 2 OR _finished)), '[]'::jsonb)
        ELSE '[]'::jsonb END,
      'handCode', CASE WHEN _finished THEN p.hand_code ELSE NULL END,
      'handName', CASE WHEN _finished THEN p.hand_rank ELSE NULL END,
      'selectedCards', CASE WHEN p.user_id=_uid OR _finished THEN p.selected_cards ELSE NULL END
    ) AS x
    FROM public.game_round_players p JOIN public.profiles pr ON pr.id = p.user_id
    WHERE p.round_id = _round_id
  ) s;

  SELECT * INTO _me FROM public.game_round_players WHERE round_id=_round_id AND user_id=_uid;
  IF _me.id IS NOT NULL AND NOT _finished AND NOT _me.folded AND NOT _me.is_all_in
     AND _r.current_turn_user_id = _uid
     AND _r.phase IN ('BETTING','FIRST_BETTING','FINAL_BETTING') THEN
    SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
      WHERE round_id=_round_id AND user_id=_uid AND turn_number=_r.stage;
    _owed := GREATEST(_r.current_bet - _stage_bet, 0);
    SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;

    _acts := jsonb_build_array(jsonb_build_object('action','die','amount',0));
    IF _owed = 0 THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','check','amount',0));
    ELSE
      _acts := _acts || jsonb_build_array(
        jsonb_build_object('action','call','amount',LEAST(_owed, _bal)));
    END IF;
    IF _r.current_bet <= _r.base_bet THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','ping',
        'amount', LEAST(_owed + _r.base_bet, _bal)));
    END IF;
    _acts := _acts || jsonb_build_array(
      jsonb_build_object('action','ttadang','amount',
        LEAST(_owed + GREATEST(_r.current_bet, _r.base_bet) * 2, _bal)),
      jsonb_build_object('action','half','amount',
        LEAST(_owed + GREATEST(_r.pot / 2, _r.base_bet), _bal)));
    IF _r.game_mode = 'sutda3' AND _r.stage = 2 THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','jjol','amount',0));
    END IF;
    SELECT count(*) INTO _cnt FROM public.game_actions
      WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','all_in');
    IF _cnt >= 2 AND COALESCE(_bal,0) > 0 THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','all_in','amount',_bal));
    END IF;
  END IF;

  _expected := CASE WHEN _r.game_mode='sutda3' AND _r.stage >= 2 THEN 3 ELSE 2 END;
  SELECT count(*) INTO _bad FROM public.game_round_players p
   WHERE p.round_id=_round_id AND p.folded=false
     AND (SELECT count(*) FROM public.game_cards c
           WHERE c.round_id=_round_id AND c.user_id=p.user_id
             AND (c.card_order <= 2 OR _r.stage >= 2)) <> _expected;

  RETURN jsonb_build_object(
    'roundId', _r.id, 'roomId', _r.room_id, 'roomNumber', _room.room_number,
    'mode', _r.game_mode, 'status', _r.status,
    'phase', _r.phase, 'stage', _r.stage, 'pot', _r.pot, 'baseBet', _r.base_bet,
    'currentBet', _r.current_bet, 'turnUserId', _r.current_turn_user_id,
    'turnDeadline', _r.turn_deadline_at, 'winnerId', _r.winner_id,
    'settlementStatus', _r.settlement_status, 'roundNumber', _r.round_number,
    'rematch', (_r.settlement_status = 'REMATCH'),
    'rematchReason', CASE WHEN _r.settlement_status = 'REMATCH' THEN
        CASE WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                           WHERE p.round_id=_round_id AND p.hand_code='gusa' AND p.folded=false)
             THEN 'GUSA' ELSE 'DRAW' END ELSE NULL END,
    'isRematchRound', COALESCE(_r.is_rematch,false),
    'roomMode', _room.game_mode,
    'carryIn', COALESCE(_r.carry_in,0), 'carryPot', COALESCE(_room.carry_pot,0),
    'pots', public.build_side_pots(_round_id),
    'availableActions', _acts,
    'cardIntegrityOk', (_bad = 0),
    'seats', COALESCE(_seats, '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'type',a.action_type,
                          'amount',a.amount,'stage',a.turn_number,'at',a.created_at) ORDER BY a.created_at)
                         FROM public.game_actions a WHERE a.round_id=_round_id), '[]'::jsonb)
  );
END; $$;