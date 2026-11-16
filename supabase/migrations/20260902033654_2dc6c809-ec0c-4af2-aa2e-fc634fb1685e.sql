-- ============================================================
-- PART B: 카드 identity / 특수카드 지정
-- ============================================================
ALTER TABLE public.card_assets
  ADD COLUMN IF NOT EXISTS special_type text,
  ADD COLUMN IF NOT EXISTS card_identity text;

UPDATE public.card_assets SET
  card_identity = COALESCE(card_identity, id),
  special_type = CASE
    WHEN is_gwang THEN 'gwang'
    WHEN variant IN ('a') THEN 'yeolggeut'
    ELSE 'tti' END
WHERE special_type IS NULL OR card_identity IS NULL;

INSERT INTO public.app_settings(key, value)
VALUES ('special_cards', jsonb_build_object(
  'amhaeng',   jsonb_build_array('04-a','07-a'),
  'ttaengjabi',jsonb_build_array('03-normal','07-b'),
  'gusa_meongteong', jsonb_build_array('04-a','09-a')
))
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings(key, value)
VALUES ('ttaeng_fee', jsonb_build_object('ttaeng_fee_enabled', false, 'rate', 0))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sutda_special_cards()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE((SELECT value FROM public.app_settings WHERE key='special_cards'),
    jsonb_build_object('amhaeng', jsonb_build_array('04-a','07-a'),
                       'ttaengjabi', jsonb_build_array('03-normal','07-b'),
                       'gusa_meongteong', jsonb_build_array('04-a','09-a')));
$$;

CREATE OR REPLACE FUNCTION public.sutda_is_pair(_c1 text, _c2 text, _pair jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _pair IS NOT NULL AND jsonb_array_length(_pair) = 2
     AND ((_c1 = _pair->>0 AND _c2 = _pair->>1) OR (_c1 = _pair->>1 AND _c2 = _pair->>0));
$$;

-- ============================================================
-- PART C~F: 족보 판정 (특수족보는 raw code 로 반환, 승패는 contextual 단계에서 결정)
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_sutda_hand(_c1 text, _c2 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $function$
DECLARE
  a int := public.sutda_card_month(_c1);
  b int := public.sutda_card_month(_c2);
  g1 boolean := public.sutda_card_is_gwang(_c1);
  g2 boolean := public.sutda_card_is_gwang(_c2);
  sp jsonb := public.sutda_special_cards();
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

  -- 암행어사 / 땡잡이 (지정 카드 조합만 인정)
  IF public.sutda_is_pair(_c1,_c2, sp->'amhaeng') THEN
    RETURN jsonb_build_object('code','amhaeng','name','암행어사','category','amhaeng','score',101);
  END IF;
  IF public.sutda_is_pair(_c1,_c2, sp->'ttaengjabi') THEN
    RETURN jsonb_build_object('code','ttaengjabi','name','땡잡이','category','ttaengjabi','score',100);
  END IF;

  -- 구사 / 멍텅구리구사
  IF lo=4 AND hi=9 THEN
    IF public.sutda_is_pair(_c1,_c2, sp->'gusa_meongteong') THEN
      RETURN jsonb_build_object('code','gusa_meongteong','name','멍텅구리구사','category','gusa','score',850);
    END IF;
    RETURN jsonb_build_object('code','gusa','name','구사','category','gusa','score',850);
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
END; $function$;

-- 최고패 자동선택에서 특수족보(구사/암행어사/땡잡이)는 후순위
CREATE OR REPLACE FUNCTION public.sutda_best_pair(_cards text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $function$
DECLARE i int; j int; _h jsonb; _best jsonb; _bestcards text[]; _sc int; _bsc int := -1;
BEGIN
  IF _cards IS NULL OR array_length(_cards,1) < 2 THEN RETURN NULL; END IF;
  FOR i IN 1..array_length(_cards,1)-1 LOOP
    FOR j IN i+1..array_length(_cards,1) LOOP
      _h := public.evaluate_sutda_hand(_cards[i], _cards[j]);
      _sc := (_h->>'score')::int;
      IF _h->>'category' IN ('gusa','ttaengjabi') THEN _sc := 0; END IF;
      IF _sc > _bsc THEN
        _bsc := _sc; _best := _h; _bestcards := ARRAY[_cards[i], _cards[j]];
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('cards', to_jsonb(_bestcards), 'hand', _best);
END; $function$;

-- ============================================================
-- PART D/E/F: contextual 특수족보 판정 (raw → effective score, x10 스케일)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_contextual_rules(_scores jsonb, _codes jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $function$
DECLARE
  _eff jsonb := '{}'::jsonb; _u text; _code text; _raw int; _e int;
  _has_kwang_target boolean; _has_ttaeng_target boolean; _has_kwang38 boolean;
BEGIN
  SELECT bool_or(v IN ('kwang18','kwang13')) INTO _has_kwang_target FROM jsonb_each_text(_codes) t(k,v);
  SELECT bool_or(v ~ '^ttaeng[1-9]$') INTO _has_ttaeng_target FROM jsonb_each_text(_codes) t(k,v);
  SELECT bool_or(v = 'kwang38') INTO _has_kwang38 FROM jsonb_each_text(_codes) t(k,v);

  FOR _u, _code IN SELECT k, v FROM jsonb_each_text(_codes) t(k,v) LOOP
    _raw := COALESCE((_scores->>_u)::int, 0);
    _e := _raw * 10;
    IF _code = 'amhaeng' THEN
      -- 18/13광땡 상대가 있으면 광땡을 잡되 38광땡에는 패배, 없으면 1끗
      IF EXISTS (SELECT 1 FROM jsonb_each_text(_codes) t(k,v)
                  WHERE t.k <> _u AND t.v IN ('kwang18','kwang13'))
      THEN _e := 9955; ELSE _e := 1010; END IF;
    ELSIF _code = 'ttaengjabi' THEN
      -- 1~9땡 상대가 있으면 그 땡을 잡되 장땡/광땡에는 패배, 없으면 망통
      IF EXISTS (SELECT 1 FROM jsonb_each_text(_codes) t(k,v)
                  WHERE t.k <> _u AND t.v ~ '^ttaeng[1-9]$')
      THEN _e := 9095; ELSE _e := 1000; END IF;
    ELSIF _code = 'gusa' THEN
      -- 일반 구사: 상대 38광땡이 있으면 재경기 없이 3끗 처리
      IF _has_kwang38 THEN _e := 1030; END IF;
    END IF;
    _eff := jsonb_set(_eff, ARRAY[_u], to_jsonb(_e));
  END LOOP;
  RETURN _eff;
END; $function$;

-- ============================================================
-- PART 2장/3장 딜링 분리: 라운드에 덱 보관
-- ============================================================
ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS deck text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS deck_pos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fold_win_reveal_choice text,
  ADD COLUMN IF NOT EXISTS fold_win_reveal_deadline timestamptz;

ALTER TABLE public.game_round_players
  ADD COLUMN IF NOT EXISTS open_card text;

-- ============================================================
-- start_game_round: 2장 = 첫 카드 1장만 / 3장 = 2장 + 공개패 선택
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_game_round(_room_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.game_rooms;
  _deck text[] := ARRAY['01-gwang','01-normal','02-a','02-b','03-gwang','03-normal','04-a','04-b',
                        '05-a','05-b','06-a','06-b','07-a','07-b','08-gwang','08-normal',
                        '09-a','09-b','10-a','10-b'];
  _shuffled text[]; _players record;
  _n int; _idx int := 0; _initial int; _round_id uuid; _num int; _turn int := 15;
  _mode text; _first_seat int; _carry bigint := 0; _rematch boolean := false;
  _rusers uuid[]; _carrybet bigint; _k int;
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
    IF COALESCE(array_length(_rusers,1),0) < 2 THEN _rematch := false; _rusers := NULL; END IF;
  END IF;

  -- 재경기는 항상 2장 섯다 (ANGEL SUTDA 확정 정책)
  _mode := CASE WHEN _rematch THEN 'sutda2' ELSE _room.game_mode END;
  _initial := CASE WHEN _mode = 'sutda3' THEN 2 ELSE 1 END;

  SELECT count(*) INTO _n FROM public.game_room_players rp
   WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
     AND (NOT _rematch OR rp.user_id = ANY(_rusers));
  IF _n < 2 THEN RAISE EXCEPTION '최소 2명이 필요합니다.'; END IF;
  IF _n * (CASE WHEN _mode='sutda3' THEN 3 ELSE 2 END) > 20 THEN RAISE EXCEPTION '인원이 너무 많습니다.'; END IF;

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

  SELECT array_agg(c ORDER BY gen_random_uuid()) INTO _shuffled FROM unnest(_deck) c;

  INSERT INTO public.game_rounds(room_id, round_number, game_mode, status, pot, phase, stage,
                                 base_bet, current_bet, dealer_seat, turn_deadline_at, carry_in, is_rematch,
                                 deck, deck_pos)
  VALUES (_room_id, _num, _mode, 'betting', 0,
          CASE WHEN _mode='sutda3' THEN 'OPEN_CARD_SELECTION' ELSE 'FIRST_BETTING' END,
          1, _room.base_bet, _room.base_bet, _first_seat, now() + make_interval(secs => _turn),
          _carry, _rematch, _shuffled, _initial * _n)
  RETURNING id INTO _round_id;

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
            CASE WHEN _mode='sutda3' THEN 'OPEN_CARD_SELECTION' ELSE 'ACTIVE' END,
            'CONNECTED', false, 0, _carrybet);

    -- 초기 카드만 지급 (2장모드=1장, 3장모드=2장)
    FOR _k IN 1.._initial LOOP
      INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
      VALUES (_round_id, _players.user_id, _shuffled[(_k-1)*_n + _idx], _k);
    END LOOP;

    PERFORM public.game_take_bet(_players.user_id, _room.base_bet, _round_id);
    INSERT INTO public.game_actions(round_id, user_id, action_type, amount, turn_number, action_id)
    VALUES (_round_id, _players.user_id, 'ante', _room.base_bet, 1, gen_random_uuid());
    UPDATE public.game_round_players SET total_bet = _room.base_bet + _carrybet
      WHERE round_id=_round_id AND user_id=_players.user_id;
  END LOOP;

  UPDATE public.game_rounds
     SET pot = _room.base_bet * _n + _carry,
         current_turn_user_id = CASE WHEN _mode='sutda3' THEN NULL ELSE
           (SELECT user_id FROM public.game_round_players WHERE round_id=_round_id ORDER BY seat LIMIT 1) END
   WHERE id = _round_id;

  UPDATE public.game_rooms
     SET status = 'playing', carry_pot = 0, current_round_id = _round_id,
         rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
   WHERE id = _room_id;
  RETURN _round_id;
END; $function$;

-- ============================================================
-- 추가 카드 배분 (서버 전용 헬퍼)
-- ============================================================
CREATE OR REPLACE FUNCTION public.deal_next_card(_round_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _r public.game_rounds; _p record; _pos int; _order int; _cnt int := 0;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  _pos := _r.deck_pos;
  FOR _p IN SELECT * FROM public.game_round_players
             WHERE round_id=_round_id AND folded=false ORDER BY seat LOOP
    SELECT count(*) + 1 INTO _order FROM public.game_cards
      WHERE round_id=_round_id AND user_id=_p.user_id;
    _pos := _pos + 1;
    IF _r.deck[_pos] IS NULL THEN RAISE EXCEPTION 'CARD_FLOW_ERROR: 덱이 소진되었습니다.'; END IF;
    INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
    VALUES (_round_id, _p.user_id, _r.deck[_pos], _order);
    _cnt := _cnt + 1;
  END LOOP;
  UPDATE public.game_rounds SET deck_pos = _pos WHERE id=_round_id;
  RETURN _cnt;
END; $function$;

REVOKE ALL ON FUNCTION public.deal_next_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deal_next_card(uuid) TO service_role;

-- ============================================================
-- PART I: 3장 공개패 선택
-- ============================================================
CREATE OR REPLACE FUNCTION public.select_open_card(_round_id uuid, _card text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _uid uuid := auth.uid(); _r public.game_rounds; _owned int; _pending int; _turn int := 15;
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
    UPDATE public.game_rounds
       SET phase='FIRST_BETTING',
           current_turn_user_id=(SELECT user_id FROM public.game_round_players
                                  WHERE round_id=_round_id AND folded=false ORDER BY seat LIMIT 1),
           turn_deadline_at = now() + make_interval(secs => COALESCE(_turn,15))
     WHERE id=_round_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'pending',_pending);
END; $function$;

REVOKE ALL ON FUNCTION public.select_open_card(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_open_card(uuid, text) TO authenticated, service_role;

-- ============================================================
-- PART N~P: 전원 FOLD 승리 시 패 공개 선택
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_fold_win_reveal(_round_id uuid, _reveal boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _uid uuid := auth.uid(); _r public.game_rounds;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.fold_win_reveal_choice IS DISTINCT FROM 'PENDING' THEN
    RETURN jsonb_build_object('choice', _r.fold_win_reveal_choice);
  END IF;
  IF _r.winner_id IS DISTINCT FROM _uid THEN RAISE EXCEPTION '승자만 선택할 수 있습니다.'; END IF;
  IF _r.fold_win_reveal_deadline IS NOT NULL AND now() > _r.fold_win_reveal_deadline THEN
    UPDATE public.game_rounds SET fold_win_reveal_choice='TIMEOUT' WHERE id=_round_id;
    RETURN jsonb_build_object('choice','TIMEOUT');
  END IF;
  UPDATE public.game_rounds
     SET fold_win_reveal_choice = CASE WHEN _reveal THEN 'REVEALED' ELSE 'HIDDEN' END
   WHERE id=_round_id;
  RETURN jsonb_build_object('choice', CASE WHEN _reveal THEN 'REVEALED' ELSE 'HIDDEN' END);
END; $function$;

REVOKE ALL ON FUNCTION public.set_fold_win_reveal(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_fold_win_reveal(uuid, boolean) TO authenticated, service_role;

-- ============================================================
-- 베팅 상태머신: 2장/3장 딜링 flow 분리
-- ============================================================
CREATE OR REPLACE FUNCTION public.place_bet_action(_round_id uuid, _action_id uuid, _action_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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
  ELSIF _action_type = 'quarter' THEN
    _amount := _owed + GREATEST(_r.pot / 4, _r.base_bet);
    _new_bet := _stage_bet + _amount;
  ELSIF _action_type = 'all_in' THEN
    SELECT count(*) INTO _cnt FROM public.game_actions
      WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','quarter','all_in');
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

  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);

  IF _acted = _alive AND COALESCE(_equal,false) THEN
    -- 1차 베팅 종료 → 다음 카드 지급 + 쪼기 → 최종 베팅
    IF _r.stage = 1 THEN
      PERFORM public.deal_next_card(_round_id);
      UPDATE public.game_rounds
         SET stage = 2, phase = 'FINAL_BETTING', current_bet = 0,
             current_turn_user_id = (SELECT user_id FROM public.game_round_players
                                      WHERE round_id=_round_id AND folded=false AND is_all_in=false
                                      ORDER BY seat LIMIT 1),
             turn_deadline_at = now() + make_interval(secs => _turn)
       WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=false, player_status='SQUEEZING'
        WHERE round_id=_round_id AND folded=false;
      RETURN jsonb_build_object('phase','FINAL_BETTING','stage',2,'dealt',true);
    END IF;
    -- 최종 베팅 종료: 3장은 승부패 제출, 2장은 바로 SHOWDOWN
    IF _r.game_mode = 'sutda3' THEN
      UPDATE public.game_rounds
         SET phase = 'FINAL_HAND_SUBMIT', current_turn_user_id = NULL,
             turn_deadline_at = now() + interval '20 seconds'
       WHERE id=_round_id;
      UPDATE public.game_round_players SET player_status='HAND_SELECTION'
        WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
      RETURN jsonb_build_object('phase','FINAL_HAND_SUBMIT');
    END IF;
    UPDATE public.game_rounds SET phase='SHOWDOWN', current_turn_user_id=NULL WHERE id=_round_id;
    RETURN public.settle_round(_round_id);
  END IF;

  SELECT user_id INTO _next FROM (
    SELECT user_id, seat FROM public.game_round_players
     WHERE round_id=_round_id AND folded=false AND is_all_in=false
  ) q ORDER BY (q.seat > _me.seat) DESC, CASE WHEN q.seat > _me.seat THEN q.seat ELSE q.seat + 1000 END LIMIT 1;

  IF _next IS NULL THEN
    -- 남은 액션 주체가 없으면 남은 카드까지 지급하고 결론
    IF _r.stage = 1 THEN
      PERFORM public.deal_next_card(_round_id);
      UPDATE public.game_rounds SET stage=2 WHERE id=_round_id;
    END IF;
    IF _r.game_mode = 'sutda3' THEN
      UPDATE public.game_rounds
         SET phase = 'FINAL_HAND_SUBMIT', current_turn_user_id = NULL,
             turn_deadline_at = now() + interval '20 seconds'
       WHERE id=_round_id;
      RETURN jsonb_build_object('phase','FINAL_HAND_SUBMIT');
    END IF;
    RETURN public.settle_round(_round_id);
  END IF;

  UPDATE public.game_rounds
     SET current_turn_user_id = _next, turn_deadline_at = now() + make_interval(secs => _turn)
   WHERE id=_round_id;

  RETURN jsonb_build_object('ok', true, 'turnUserId', _next, 'amount', _amount);
END; $function$;

-- ============================================================
-- settle_round: contextual 특수족보 + FOLD WIN 공개선택
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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

  -- 특수족보 contextual 적용 (암행어사/땡잡이/구사)
  _eff := public.apply_contextual_rules(_scores, _codes);

  -- 구사 재경기 발동 여부: 멍텅구리구사는 항상, 일반 구사는 38광땡 상대가 없을 때
  SELECT bool_or(v = 'gusa_meongteong'
                 OR (v = 'gusa' AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(_codes) t2(k2,v2)
                                                 WHERE t2.v2 = 'kwang38')))
    INTO _gusa FROM jsonb_each_text(_codes) t(k,v);
  _gusa := COALESCE(_gusa,false) AND _alive > 1;

  SELECT max(value::int) INTO _best FROM jsonb_each_text(_eff);
  SELECT array_agg(p.user_id ORDER BY p.seat) INTO _winners
    FROM public.game_round_players p
   WHERE p.round_id=_round_id AND p.folded=false
     AND COALESCE((_eff->>p.user_id::text)::int,-1) = _best;
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
         -- 상대 전원 다이 승리: 승자가 5초 내 공개 여부 선택
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

-- ============================================================
-- get_round_state: 공개패 / 카드 노출 정책 / 카드 정합성
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_round_state(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _seats jsonb; _finished boolean;
  _me public.game_round_players; _stage_bet bigint; _owed bigint; _bal bigint;
  _acts jsonb := '[]'::jsonb; _expected int; _bad int; _room public.game_rooms; _cnt int;
  _show boolean; _choice text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _r.room_id;
  _finished := _r.status = 'finished';

  _choice := _r.fold_win_reveal_choice;
  IF _choice = 'PENDING' AND _r.fold_win_reveal_deadline IS NOT NULL AND now() > _r.fold_win_reveal_deadline THEN
    _choice := 'TIMEOUT';
  END IF;
  -- 전원 다이 승리 라운드는 승자가 공개를 선택한 경우에만 카드 공개
  _show := _finished AND (_r.fold_win_reveal_choice IS NULL OR _choice = 'REVEALED');

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
                     WHERE c.round_id=_round_id AND c.user_id=p.user_id),
      'openCard', CASE WHEN _r.game_mode='sutda3' THEN p.open_card ELSE NULL END,
      'cards', CASE
        WHEN p.user_id = _uid OR (_show AND NOT p.folded) THEN
          COALESCE((SELECT jsonb_agg(c.card_code ORDER BY c.card_order) FROM public.game_cards c
             WHERE c.round_id=_round_id AND c.user_id=p.user_id), '[]'::jsonb)
        WHEN _r.game_mode='sutda3' AND p.open_card IS NOT NULL AND NOT p.folded THEN
          jsonb_build_array(p.open_card)
        ELSE '[]'::jsonb END,
      'handCode', CASE WHEN _show THEN p.hand_code ELSE NULL END,
      'handName', CASE WHEN _show OR (_finished AND p.user_id = _uid) THEN p.hand_rank ELSE NULL END,
      'selectedCards', CASE WHEN p.user_id=_uid OR _show THEN p.selected_cards ELSE NULL END
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
        LEAST(_owed + GREATEST(_r.pot / 2, _r.base_bet), _bal)),
      jsonb_build_object('action','quarter','amount',
        LEAST(_owed + GREATEST(_r.pot / 4, _r.base_bet), _bal)));
    SELECT count(*) INTO _cnt FROM public.game_actions
      WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','quarter','all_in');
    IF _cnt >= 2 AND COALESCE(_bal,0) > 0 THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','all_in','amount',_bal));
    END IF;
  END IF;

  -- 카드 정합성: 2장 모드 stage1=1장 / stage2=2장, 3장 모드 stage1=2장 / stage2=3장
  _expected := CASE WHEN _r.game_mode='sutda3' THEN _r.stage + 1 ELSE _r.stage END;
  SELECT count(*) INTO _bad FROM public.game_round_players p
   WHERE p.round_id=_round_id AND p.folded=false
     AND (SELECT count(*) FROM public.game_cards c
           WHERE c.round_id=_round_id AND c.user_id=p.user_id) <> _expected;

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
                           WHERE p.round_id=_round_id AND p.hand_code LIKE 'gusa%' AND p.folded=false)
             THEN 'GUSA' ELSE 'DRAW' END ELSE NULL END,
    'isRematchRound', COALESCE(_r.is_rematch,false),
    'roomMode', _room.game_mode,
    'carryIn', COALESCE(_r.carry_in,0), 'carryPot', COALESCE(_room.carry_pot,0),
    'pots', public.build_side_pots(_round_id),
    'availableActions', _acts,
    'cardIntegrityOk', (_bad = 0),
    'myCardCount', (SELECT count(*) FROM public.game_cards c WHERE c.round_id=_round_id AND c.user_id=_uid),
    'foldWinChoice', _choice,
    'foldWinDeadline', _r.fold_win_reveal_deadline,
    'iAmFoldWinner', (_r.fold_win_reveal_choice IS NOT NULL AND _r.winner_id = _uid),
    'seats', COALESCE(_seats, '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'type',a.action_type,
                          'amount',a.amount,'stage',a.turn_number,'at',a.created_at) ORDER BY a.created_at)
                         FROM public.game_actions a WHERE a.round_id=_round_id), '[]'::jsonb)
  );
END; $function$;