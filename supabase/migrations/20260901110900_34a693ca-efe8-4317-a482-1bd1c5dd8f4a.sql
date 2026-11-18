-- ============ 1. 스키마 확장 ============
ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'DEALING',
  ADD COLUMN IF NOT EXISTS stage integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_bet bigint NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS current_bet bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_turn_user_id uuid,
  ADD COLUMN IF NOT EXISTS dealer_seat integer NOT NULL DEFAULT 1;

ALTER TABLE public.game_round_players
  ADD COLUMN IF NOT EXISTS acted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hand_code text,
  ADD COLUMN IF NOT EXISTS total_bet bigint NOT NULL DEFAULT 0;

-- ============ 2. 카드 헬퍼 ============
CREATE OR REPLACE FUNCTION public.sutda_card_month(_code text)
RETURNS integer LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT ca.month FROM public.card_assets ca WHERE ca.id = regexp_replace(_code, '^m', '')),
    NULLIF(substring(regexp_replace(_code, '^m', '') from 1 for 2), '')::int
  );
$$;

CREATE OR REPLACE FUNCTION public.sutda_card_is_gwang(_code text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT ca.is_gwang FROM public.card_assets ca WHERE ca.id = regexp_replace(_code, '^m', '')),
    regexp_replace(_code, '^m', '') LIKE '%gwang'
  );
$$;

-- 2장 족보 판정 (38광땡 ~ 망통)
CREATE OR REPLACE FUNCTION public.evaluate_sutda_hand(_c1 text, _c2 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  a int := public.sutda_card_month(_c1);
  b int := public.sutda_card_month(_c2);
  g1 boolean := public.sutda_card_is_gwang(_c1);
  g2 boolean := public.sutda_card_is_gwang(_c2);
  lo int; hi int; v int;
BEGIN
  IF a IS NULL OR b IS NULL THEN
    RETURN jsonb_build_object('code','kkeut0','name','망통','category','kkeut','score',100);
  END IF;
  lo := LEAST(a,b); hi := GREATEST(a,b);

  IF g1 AND g2 THEN
    IF lo=3 AND hi=8 THEN RETURN jsonb_build_object('code','kwang38','name','38광땡','category','kwangttaeng','score',1000); END IF;
    IF lo=1 AND hi=8 THEN RETURN jsonb_build_object('code','kwang18','name','18광땡','category','kwangttaeng','score',990); END IF;
    IF lo=1 AND hi=3 THEN RETURN jsonb_build_object('code','kwang13','name','13광땡','category','kwangttaeng','score',980); END IF;
  END IF;

  IF a = b THEN
    RETURN jsonb_build_object(
      'code','ttaeng'||a,
      'name', CASE WHEN a=10 THEN '장땡' ELSE a||'땡' END,
      'category','ttaeng',
      'score', CASE WHEN a=10 THEN 910 ELSE 900 + a END);
  END IF;

  IF lo=1 AND hi=2  THEN RETURN jsonb_build_object('code','ali','name','알리','category','special','score',806); END IF;
  IF lo=1 AND hi=4  THEN RETURN jsonb_build_object('code','doksa','name','독사','category','special','score',805); END IF;
  IF lo=1 AND hi=9  THEN RETURN jsonb_build_object('code','gupping','name','구삥','category','special','score',804); END IF;
  IF lo=1 AND hi=10 THEN RETURN jsonb_build_object('code','jangping','name','장삥','category','special','score',803); END IF;
  IF lo=4 AND hi=10 THEN RETURN jsonb_build_object('code','jangsa','name','장사','category','special','score',802); END IF;
  IF lo=4 AND hi=6  THEN RETURN jsonb_build_object('code','seryuk','name','세륙','category','special','score',801); END IF;

  v := (a + b) % 10;
  RETURN jsonb_build_object(
    'code','kkeut'||v,
    'name', CASE WHEN v=0 THEN '망통' WHEN v=9 THEN '갑오' ELSE v||'끗' END,
    'category','kkeut','score',100 + v);
END;
$$;

-- 3장 중 최고 2장 조합
CREATE OR REPLACE FUNCTION public.sutda_best_pair(_cards text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE best jsonb; cur jsonb; i int; j int;
BEGIN
  IF array_length(_cards,1) IS NULL OR array_length(_cards,1) < 2 THEN RETURN NULL; END IF;
  IF array_length(_cards,1) = 2 THEN
    RETURN jsonb_build_object('cards', to_jsonb(_cards), 'hand', public.evaluate_sutda_hand(_cards[1], _cards[2]));
  END IF;
  FOR i IN 1..array_length(_cards,1)-1 LOOP
    FOR j IN i+1..array_length(_cards,1) LOOP
      cur := jsonb_build_object('cards', to_jsonb(ARRAY[_cards[i], _cards[j]]),
                                'hand', public.evaluate_sutda_hand(_cards[i], _cards[j]));
      IF best IS NULL OR (cur->'hand'->>'score')::int > (best->'hand'->>'score')::int THEN best := cur; END IF;
    END LOOP;
  END LOOP;
  RETURN best;
END;
$$;

-- 플레이어 최종 족보 (3장은 선택패 우선, 없으면 최고 조합)
CREATE OR REPLACE FUNCTION public.round_player_hand(_round_id uuid, _user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  _mode text; _sel jsonb; _cards text[]; _pick text[];
BEGIN
  SELECT r.game_mode INTO _mode FROM public.game_rounds r WHERE r.id = _round_id;
  SELECT array_agg(c.card_code ORDER BY c.card_order) INTO _cards
    FROM public.game_cards c WHERE c.round_id = _round_id AND c.user_id = _user_id;
  IF _cards IS NULL THEN RETURN NULL; END IF;

  IF _mode = 'sutda3' THEN
    SELECT p.selected_cards INTO _sel FROM public.game_round_players p
      WHERE p.round_id = _round_id AND p.user_id = _user_id;
    IF _sel IS NOT NULL AND jsonb_array_length(_sel) = 2 THEN
      SELECT array_agg(value::text) INTO _pick FROM jsonb_array_elements_text(_sel) value;
      RETURN jsonb_build_object('cards', to_jsonb(_pick), 'hand', public.evaluate_sutda_hand(_pick[1], _pick[2]));
    END IF;
    RETURN public.sutda_best_pair(_cards[1:3]);
  END IF;
  RETURN public.sutda_best_pair(_cards[1:2]);
END;
$$;

-- ============ 3. 내부 포인트 차감 ============
CREATE OR REPLACE FUNCTION public.game_take_bet(_user_id uuid, _amount bigint, _round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal bigint;
BEGIN
  IF _amount <= 0 THEN RETURN; END IF;
  SELECT game_points INTO _bal FROM public.profiles WHERE id = _user_id FOR UPDATE;
  IF _bal IS NULL OR _bal < _amount THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;
  UPDATE public.profiles SET game_points = game_points - _amount WHERE id = _user_id;
  INSERT INTO public.point_transactions(user_id, type, amount, balance_before, balance_after,
    locked_before, locked_after, reference_type, reference_id, memo)
  SELECT _user_id, 'game_bet', -_amount, _bal, _bal - _amount, p.locked_points, p.locked_points,
         'game_round', _round_id, '게임 베팅'
  FROM public.profiles p WHERE p.id = _user_id;
END;
$$;

-- ============ 4. 라운드 시작 (서버 셔플/배분) ============
CREATE OR REPLACE FUNCTION public.start_game_round(_room_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END;
$$;

-- ============ 5. 내 카드 조회 ============
CREATE OR REPLACE FUNCTION public.get_my_cards(_round_id uuid)
RETURNS TABLE(card_code text, card_order integer, month integer, is_gwang boolean, asset_url text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _stage int; _status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT r.stage, r.status INTO _stage, _status FROM public.game_rounds r WHERE r.id=_round_id;
  RETURN QUERY
  SELECT c.card_code, c.card_order, public.sutda_card_month(c.card_code),
         public.sutda_card_is_gwang(c.card_code),
         COALESCE((SELECT ca.asset_url FROM public.card_assets ca WHERE ca.id = c.card_code),
                  '/cards/hwatu/base/' || c.card_code || '.png')
  FROM public.game_cards c
  WHERE c.round_id=_round_id AND c.user_id=_uid
    AND (c.card_order <= 2 OR COALESCE(_stage,1) >= 2 OR _status='finished')
  ORDER BY c.card_order;
END;
$$;

-- ============ 6. 라운드 상태 (상대 카드 마스킹) ============
CREATE OR REPLACE FUNCTION public.get_round_state(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r public.game_rounds; _seats jsonb; _finished boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL THEN RETURN NULL; END IF;
  _finished := _r.status = 'finished';

  SELECT jsonb_agg(x ORDER BY x->>'seat') INTO _seats FROM (
    SELECT jsonb_build_object(
      'userId', p.user_id,
      'seat', p.seat,
      'nickname', pr.nickname,
      'level', pr.level,
      'rank', pr.rank,
      'avatarUrl', pr.avatar_url,
      'points', pr.game_points,
      'folded', p.folded,
      'status', p.player_status,
      'connection', p.connection_status,
      'acted', p.acted,
      'totalBet', p.total_bet,
      'resultType', p.result_type,
      'isMe', p.user_id = _uid,
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

  RETURN jsonb_build_object(
    'roundId', _r.id, 'roomId', _r.room_id, 'mode', _r.game_mode, 'status', _r.status,
    'phase', _r.phase, 'stage', _r.stage, 'pot', _r.pot, 'baseBet', _r.base_bet,
    'currentBet', _r.current_bet, 'turnUserId', _r.current_turn_user_id,
    'turnDeadline', _r.turn_deadline_at, 'winnerId', _r.winner_id,
    'settlementStatus', _r.settlement_status, 'roundNumber', _r.round_number,
    'seats', COALESCE(_seats, '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'type',a.action_type,
                          'amount',a.amount,'stage',a.turn_number,'at',a.created_at) ORDER BY a.created_at)
                         FROM public.game_actions a WHERE a.round_id=_round_id), '[]'::jsonb)
  );
END;
$$;

-- ============ 7. 정산 (서버 승자 판정) ============
DROP FUNCTION IF EXISTS public.settle_round(uuid);
CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  UPDATE public.game_rooms SET status='waiting' WHERE id=_r.room_id;

  RETURN jsonb_build_object('roundId',_round_id,'pot',_pot,'winners',to_jsonb(_winners),'handCode',_win_code);
END;
$$;

-- ============ 8. 베팅 행동 ============
CREATE OR REPLACE FUNCTION public.place_bet_action(_round_id uuid, _action_id uuid, _action_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _me public.game_round_players;
  _owed bigint; _amount bigint := 0; _new_bet bigint; _stage_bet bigint;
  _alive int; _acted int; _equal boolean; _next uuid; _turn int := 15; _bal bigint;
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
  ELSE
    RAISE EXCEPTION '알 수 없는 행동입니다: %', _action_type;
  END IF;

  IF _amount > _bal THEN
    _amount := _bal;                                   -- 올인 절삭
    _new_bet := GREATEST(_new_bet, _stage_bet + _amount);
  END IF;

  IF _amount > 0 THEN PERFORM public.game_take_bet(_uid, _amount, _round_id); END IF;

  INSERT INTO public.game_actions(round_id, user_id, action_type, amount, turn_number, action_id)
  VALUES (_round_id, _uid, _action_type, _amount, _r.stage, _action_id);

  UPDATE public.game_round_players
     SET acted = true, total_bet = total_bet + _amount,
         player_status = CASE WHEN folded THEN 'FOLDED'
                              WHEN _bal - _amount <= 0 THEN 'ALL_IN' ELSE 'ACTIVE' END
   WHERE id = _me.id;

  IF _new_bet > _r.current_bet THEN
    UPDATE public.game_round_players SET acted=false
      WHERE round_id=_round_id AND folded=false AND user_id <> _uid;
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
    WHERE round_id=_round_id AND folded=false AND acted=true;
  SELECT bool_and(COALESCE(sb.s,0) = _r.current_bet OR p.player_status='ALL_IN') INTO _equal
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
    SELECT user_id, seat FROM public.game_round_players WHERE round_id=_round_id AND folded=false
  ) q ORDER BY (q.seat > _me.seat) DESC, CASE WHEN q.seat > _me.seat THEN q.seat ELSE q.seat + 1000 END LIMIT 1;

  UPDATE public.game_rounds
     SET current_turn_user_id = _next, turn_deadline_at = now() + make_interval(secs => _turn)
   WHERE id=_round_id;

  RETURN jsonb_build_object('ok', true, 'turnUserId', _next, 'amount', _amount);
END;
$$;

-- ============ 9. 3장 최종 승부패 선택 ============
CREATE OR REPLACE FUNCTION public.select_final_hand(_round_id uuid, _card1 text, _card2 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _owned int; _pending int; _first uuid; _turn int := 15;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL OR _r.status='finished' THEN RAISE EXCEPTION '진행 중인 라운드가 아닙니다.'; END IF;
  IF _r.phase <> 'HAND_SELECTION' THEN RAISE EXCEPTION '지금은 승부패를 선택할 수 없습니다.'; END IF;
  IF _card1 = _card2 THEN RAISE EXCEPTION '서로 다른 카드 2장을 선택해야 합니다.'; END IF;

  SELECT count(*) INTO _owned FROM public.game_cards
   WHERE round_id=_round_id AND user_id=_uid AND card_code IN (_card1, _card2);
  IF _owned <> 2 THEN RAISE EXCEPTION '보유하지 않은 카드입니다.'; END IF;

  UPDATE public.game_round_players
     SET selected_cards = jsonb_build_array(_card1, _card2),
         selection_confirmed_at = now(), player_status='HAND_SELECTED'
   WHERE round_id=_round_id AND user_id=_uid AND folded=false;

  SELECT count(*) INTO _pending FROM public.game_round_players
   WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;

  IF _pending = 0 THEN
    SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
    _turn := COALESCE(_turn,15);
    SELECT user_id INTO _first FROM public.game_round_players
     WHERE round_id=_round_id AND folded=false ORDER BY seat LIMIT 1;
    UPDATE public.game_rounds
       SET phase='FINAL_BETTING', current_turn_user_id=_first, current_bet=0,
           turn_deadline_at = now() + make_interval(secs => _turn)
     WHERE id=_round_id;
    UPDATE public.game_round_players SET acted=false, player_status='ACTIVE'
      WHERE round_id=_round_id AND folded=false;
  END IF;
  RETURN jsonb_build_object('ok', true, 'pending', _pending);
END;
$$;

-- ============ 10. 턴 타임아웃 강제 ============
CREATE OR REPLACE FUNCTION public.enforce_turn_timeout(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.game_rounds; _u uuid; _stage_bet bigint; _act text; _p record;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL OR _r.status='finished' OR _r.turn_deadline_at IS NULL
     OR _r.turn_deadline_at > now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  IF _r.phase = 'HAND_SELECTION' THEN
    FOR _p IN SELECT * FROM public.game_round_players
               WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL LOOP
      UPDATE public.game_round_players
         SET selected_cards = (SELECT public.sutda_best_pair(array_agg(c.card_code ORDER BY c.card_order))->'cards'
                                 FROM public.game_cards c WHERE c.round_id=_round_id AND c.user_id=_p.user_id),
             selection_confirmed_at = now(), player_status='HAND_SELECTED'
       WHERE id = _p.id;
    END LOOP;
    UPDATE public.game_rounds
       SET phase='FINAL_BETTING', current_bet=0,
           current_turn_user_id=(SELECT user_id FROM public.game_round_players
                                  WHERE round_id=_round_id AND folded=false ORDER BY seat LIMIT 1),
           turn_deadline_at = now() + interval '15 seconds'
     WHERE id=_round_id;
    UPDATE public.game_round_players SET acted=false, player_status='ACTIVE'
      WHERE round_id=_round_id AND folded=false;
    RETURN jsonb_build_object('ok', true, 'auto', 'hand_selection');
  END IF;

  _u := _r.current_turn_user_id;
  IF _u IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
    WHERE round_id=_round_id AND user_id=_u AND turn_number=_r.stage;
  _act := CASE WHEN _stage_bet >= _r.current_bet THEN 'check' ELSE 'die' END;

  -- 대상 유저 권한으로 강제 실행 (내부 로직 재사용을 위해 직접 반영)
  INSERT INTO public.game_actions(round_id, user_id, action_type, amount, turn_number, action_id)
  VALUES (_round_id, _u, _act, 0, _r.stage, gen_random_uuid());
  IF _act = 'die' THEN
    UPDATE public.game_round_players SET folded=true, player_status='FOLDED', acted=true
     WHERE round_id=_round_id AND user_id=_u;
  ELSE
    UPDATE public.game_round_players SET acted=true WHERE round_id=_round_id AND user_id=_u;
  END IF;

  IF (SELECT count(*) FROM public.game_round_players WHERE round_id=_round_id AND folded=false) <= 1 THEN
    RETURN public.settle_round(_round_id);
  END IF;
  IF (SELECT bool_and(acted) FROM public.game_round_players WHERE round_id=_round_id AND folded=false) THEN
    IF _r.game_mode='sutda3' AND _r.stage=1 THEN
      UPDATE public.game_rounds SET stage=2, phase='HAND_SELECTION', current_bet=0,
             current_turn_user_id=NULL, turn_deadline_at=now() + interval '20 seconds'
       WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=false, player_status='SQUEEZING'
        WHERE round_id=_round_id AND folded=false;
      RETURN jsonb_build_object('ok', true, 'phase','HAND_SELECTION');
    END IF;
    RETURN public.settle_round(_round_id);
  END IF;

  UPDATE public.game_rounds
     SET current_turn_user_id = (
           SELECT user_id FROM (SELECT user_id, seat FROM public.game_round_players
                                 WHERE round_id=_round_id AND folded=false) q
            ORDER BY (q.seat > (SELECT seat FROM public.game_round_players
                                 WHERE round_id=_round_id AND user_id=_u)) DESC,
                     q.seat LIMIT 1),
         turn_deadline_at = now() + interval '15 seconds'
   WHERE id=_round_id;
  RETURN jsonb_build_object('ok', true, 'auto', _act);
END;
$$;

-- ============ 11. RLS 강화 ============
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies
            WHERE schemaname='public' AND tablename IN ('game_cards','game_rounds','game_round_players','game_actions')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- 카드: 본인 것만, 3번째 카드는 공개 단계 이후 (수정/삽입 불가)
CREATE POLICY "own cards only" ON public.game_cards FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.game_rounds r WHERE r.id = game_cards.round_id
      AND (game_cards.card_order <= 2 OR r.stage >= 2 OR r.status = 'finished')
  )
);

-- 라운드: 참가자/관전자 조회만
CREATE POLICY "rounds readable" ON public.game_rounds FOR SELECT TO authenticated USING (true);

-- 라운드 참가자: 본인 행 또는 종료된 라운드만 조회 (선택패 보호)
CREATE POLICY "round players readable" ON public.game_round_players FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.game_rounds r WHERE r.id = game_round_players.round_id AND r.status='finished')
);

-- 행동 로그: 조회만 공개
CREATE POLICY "actions readable" ON public.game_actions FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.game_cards FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_rounds FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_round_players FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_actions FROM authenticated;
GRANT SELECT ON public.game_cards, public.game_rounds, public.game_round_players, public.game_actions TO authenticated;
GRANT ALL ON public.game_cards, public.game_rounds, public.game_round_players, public.game_actions TO service_role;

REVOKE ALL ON FUNCTION public.game_take_bet(uuid, bigint, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_game_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_cards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bet_action(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.select_final_hand(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_turn_timeout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_sutda_hand(text, text) TO authenticated;