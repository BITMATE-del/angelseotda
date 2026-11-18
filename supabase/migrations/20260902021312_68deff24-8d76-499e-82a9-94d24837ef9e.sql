-- ============ 1. 방 번호 / 이월 판돈 ============
CREATE SEQUENCE IF NOT EXISTS public.room_number_seq START WITH 100001 INCREMENT BY 1;

ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS room_number integer;
UPDATE public.game_rooms SET room_number = nextval('public.room_number_seq') WHERE room_number IS NULL;
ALTER TABLE public.game_rooms ALTER COLUMN room_number SET DEFAULT nextval('public.room_number_seq');
ALTER TABLE public.game_rooms ALTER COLUMN room_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS game_rooms_room_number_key ON public.game_rooms(room_number);

ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS carry_pot bigint NOT NULL DEFAULT 0;
ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS current_round_id uuid;
ALTER TABLE public.game_rounds ADD COLUMN IF NOT EXISTS carry_in bigint NOT NULL DEFAULT 0;

-- ============ 2. 나가기 예약 ============
ALTER TABLE public.game_room_players ADD COLUMN IF NOT EXISTS leave_pending boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_room_players ADD COLUMN IF NOT EXISTS leave_requested_at timestamptz;

-- ============ 3. 구사(4+9) 판정 ============
CREATE OR REPLACE FUNCTION public.evaluate_sutda_hand(_c1 text, _c2 text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
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

  -- 구사: 4월 + 9월 (광 여부 무관) → 재경기
  IF lo=4 AND hi=9 THEN RETURN jsonb_build_object('code','gusa','name','구사','category','gusa','score',850); END IF;

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
$function$;

-- 3장 섯다 best pair 는 구사를 최적패로 고르지 않는다 (score 850 이 높게 잡히지 않도록)
CREATE OR REPLACE FUNCTION public.sutda_best_pair(_cards text[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE i int; j int; _h jsonb; _best jsonb; _bestcards text[]; _sc int; _bsc int := -1;
BEGIN
  IF _cards IS NULL OR array_length(_cards,1) < 2 THEN RETURN NULL; END IF;
  FOR i IN 1..array_length(_cards,1)-1 LOOP
    FOR j IN i+1..array_length(_cards,1) LOOP
      _h := public.evaluate_sutda_hand(_cards[i], _cards[j]);
      _sc := (_h->>'score')::int;
      -- 구사는 자동 선택 대상에서 후순위 (재경기 유발)
      IF _h->>'category' = 'gusa' THEN _sc := 0; END IF;
      IF _sc > _bsc THEN
        _bsc := _sc; _best := _h; _bestcards := ARRAY[_cards[i], _cards[j]];
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('cards', to_jsonb(_bestcards), 'hand', _best);
END;
$function$;

-- ============ 4. 나가기 처리 ============
CREATE OR REPLACE FUNCTION public.close_or_hold_room(_room_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _n int; _spec int; _next text;
BEGIN
  SELECT count(*) INTO _n FROM public.game_room_players
   WHERE room_id=_room_id AND is_spectator=false AND leave_pending=false;
  SELECT count(*) INTO _spec FROM public.game_room_players
   WHERE room_id=_room_id AND is_spectator=true;
  IF _n = 0 AND _spec = 0 THEN
    _next := 'closed';
  ELSIF public.ops_flag('game_lock') OR public.ops_flag('maintenance_enabled') THEN
    _next := 'paused';
  ELSIF _n < 2 THEN
    _next := 'waiting';
  ELSE
    _next := 'playing';
  END IF;
  UPDATE public.game_rooms SET status = _next WHERE id = _room_id;
  RETURN _next;
END; $function$;

-- 예약된 나가기를 실제 퇴장으로 확정
CREATE OR REPLACE FUNCTION public.process_leave_pending(_room_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RETURN 0;
  END IF;
  DELETE FROM public.game_room_players WHERE room_id=_room_id AND leave_pending=true;
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.game_rooms SET current_players =
    (SELECT count(*) FROM public.game_room_players WHERE room_id=_room_id AND is_spectator=false)
   WHERE id=_room_id;
  PERFORM public.close_or_hold_room(_room_id);
  RETURN _n;
END; $function$;

-- 사용자 나가기 요청: 진행 중이면 예약, 아니면 즉시 퇴장
CREATE OR REPLACE FUNCTION public.request_leave_room(_room_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _p public.game_room_players; _live boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _p FROM public.game_room_players WHERE room_id=_room_id AND user_id=_uid FOR UPDATE;
  IF _p.id IS NULL THEN
    PERFORM public.close_or_hold_room(_room_id);
    RETURN 'LEFT';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.game_rounds r
     JOIN public.game_round_players rp ON rp.round_id = r.id AND rp.user_id = _uid
    WHERE r.room_id = _room_id AND r.status <> 'finished'
  ) INTO _live;

  IF _live THEN
    UPDATE public.game_room_players
       SET leave_pending = true, leave_requested_at = now(), seat_status = 'LEAVE_PENDING'
     WHERE id = _p.id;
    RETURN 'LEAVE_PENDING';
  END IF;

  DELETE FROM public.game_room_players WHERE id = _p.id;
  UPDATE public.game_rooms SET current_players =
    (SELECT count(*) FROM public.game_room_players WHERE room_id=_room_id AND is_spectator=false)
   WHERE id=_room_id;
  PERFORM public.close_or_hold_room(_room_id);
  RETURN 'LEFT';
END; $function$;

-- 나가기 예약 취소
CREATE OR REPLACE FUNCTION public.cancel_leave_room(_room_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.game_room_players
     SET leave_pending=false, leave_requested_at=NULL, seat_status='ACTIVE'
   WHERE room_id=_room_id AND user_id=auth.uid();
END; $function$;

-- ============ 5. 정산: 구사 재경기 + 나가기 확정 ============
CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _r public.game_rounds; _p record; _best int := -1; _winners uuid[] := '{}';
  _hand jsonb; _pot bigint; _share bigint; _rem bigint; _first uuid; _season uuid;
  _alive int := 0; _win_code text; _bal bigint; _gusa boolean := false;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _r.settled OR _r.settlement_status IN ('SETTLED','REMATCH') THEN
    RETURN jsonb_build_object('alreadySettled', true, 'roundId', _round_id);
  END IF;

  FOR _p IN SELECT * FROM public.game_round_players WHERE round_id=_round_id AND folded=false ORDER BY seat LOOP
    _alive := _alive + 1;
    _hand := public.round_player_hand(_round_id, _p.user_id);
    UPDATE public.game_round_players
       SET hand_code = _hand->'hand'->>'code', hand_rank = _hand->'hand'->>'name'
     WHERE id = _p.id;
    IF _hand->'hand'->>'code' = 'gusa' THEN _gusa := true; END IF;
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

  _pot := COALESCE((SELECT sum(amount) FROM public.game_actions WHERE round_id=_round_id), 0)
          + COALESCE(_r.carry_in, 0);

  -- 구사 재경기: 승자 없음 · 정산 없음 · POT 이월
  IF _gusa AND _alive > 1 THEN
    UPDATE public.game_round_players
       SET result = NULL, result_type = 'REMATCH', player_status = 'FINISHED',
           final_points = (SELECT game_points FROM public.profiles WHERE id = game_round_players.user_id)
     WHERE round_id = _round_id;
    UPDATE public.game_rounds
       SET status='finished', phase='FINISHED', pot=_pot, settled=true, settlement_status='REMATCH',
           settled_at=now(), finished_at=now(), current_turn_user_id=NULL, turn_deadline_at=NULL,
           winner_id=NULL
     WHERE id=_round_id;
    UPDATE public.game_rooms SET carry_pot = _pot WHERE id = _r.room_id;
    PERFORM public.process_leave_pending(_r.room_id);
    PERFORM public.close_or_hold_room(_r.room_id);
    RETURN jsonb_build_object('roundId',_round_id,'rematch',true,'carryPot',_pot);
  END IF;

  IF array_length(_winners,1) IS NULL THEN
    SELECT array_agg(user_id) INTO _winners FROM public.game_round_players WHERE round_id=_round_id;
  END IF;

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

  UPDATE public.game_rooms SET carry_pot = 0 WHERE id = _r.room_id;
  PERFORM public.process_leave_pending(_r.room_id);
  PERFORM public.close_or_hold_room(_r.room_id);

  RETURN jsonb_build_object('roundId',_round_id,'pot',_pot,'winners',to_jsonb(_winners),'handCode',_win_code);
END;
$function$;

-- ============ 6. 라운드 시작: 퇴장자 제외 + POT 이월 ============
CREATE OR REPLACE FUNCTION public.start_game_round(_room_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.game_rooms;
  _deck text[] := ARRAY['01-gwang','01-normal','02-a','02-b','03-gwang','03-normal','04-a','04-b',
                        '05-a','05-b','06-a','06-b','07-a','07-b','08-gwang','08-normal',
                        '09-a','09-b','10-a','10-b'];
  _shuffled text[];
  _players record;
  _n int; _idx int := 0; _per int; _round_id uuid; _num int; _turn int := 15;
  _mode text; _first_seat int; _carry bigint := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '존재하지 않는 방입니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RETURN (SELECT id FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished' ORDER BY started_at DESC LIMIT 1);
  END IF;

  -- 나가기 예약자를 먼저 퇴장 처리한다 (다음 판 참가 대상에서 제외)
  PERFORM public.process_leave_pending(_room_id);

  IF NOT EXISTS (SELECT 1 FROM public.game_room_players
    WHERE room_id=_room_id AND user_id=_uid AND is_spectator=false AND leave_pending=false) THEN
    RAISE EXCEPTION '방 참가자만 게임을 시작할 수 있습니다.';
  END IF;

  PERFORM public.assert_round_start_allowed();

  _mode := _room.game_mode;
  _per := CASE WHEN _mode = 'sutda3' THEN 3 ELSE 2 END;
  SELECT count(*) INTO _n FROM public.game_room_players
   WHERE room_id=_room_id AND is_spectator=false AND leave_pending=false;
  IF _n < 2 THEN RAISE EXCEPTION '최소 2명이 필요합니다.'; END IF;
  IF _n * _per > 20 THEN RAISE EXCEPTION '인원이 너무 많습니다.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
      AND pr.game_points < _room.base_bet
  ) THEN RAISE EXCEPTION '기본 베팅 포인트가 부족한 참가자가 있습니다.'; END IF;

  SELECT COALESCE((value->>'turn_seconds')::int, 15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);
  SELECT COALESCE(max(round_number),0)+1 INTO _num FROM public.game_rounds WHERE room_id=_room_id;
  SELECT min(seat) INTO _first_seat FROM public.game_room_players
   WHERE room_id=_room_id AND is_spectator=false AND leave_pending=false;
  _carry := GREATEST(COALESCE(_room.carry_pot,0), 0);

  INSERT INTO public.game_rounds(room_id, round_number, game_mode, status, pot, phase, stage,
                                 base_bet, current_bet, dealer_seat, turn_deadline_at, carry_in)
  VALUES (_room_id, _num, _mode, 'betting', 0,
          CASE WHEN _mode='sutda3' THEN 'FIRST_BETTING' ELSE 'BETTING' END,
          1, _room.base_bet, _room.base_bet, _first_seat, now() + make_interval(secs => _turn), _carry)
  RETURNING id INTO _round_id;

  SELECT array_agg(c ORDER BY gen_random_uuid()) INTO _shuffled FROM unnest(_deck) c;

  FOR _players IN
    SELECT rp.user_id, rp.seat, pr.game_points
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false ORDER BY rp.seat
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
     SET pot = _room.base_bet * _n + _carry,
         current_turn_user_id = (SELECT user_id FROM public.game_round_players
                                  WHERE round_id=_round_id ORDER BY seat LIMIT 1)
   WHERE id = _round_id;

  UPDATE public.game_rooms
     SET status = 'playing', carry_pot = 0, current_round_id = _round_id
   WHERE id = _room_id;
  RETURN _round_id;
END; $function$;

-- ============ 7. 조회 함수 확장 ============
CREATE OR REPLACE FUNCTION public.room_table_state(_room_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _room public.game_rooms; _seats jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;
  IF _room.id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(x ORDER BY (x->>'seat')::int) INTO _seats FROM (
    SELECT jsonb_build_object(
      'userId', rp.user_id,
      'seat', rp.seat,
      'nickname', pr.nickname,
      'rank', pr.rank,
      'points', pr.game_points,
      'avatarUrl', pr.avatar_url,
      'isSpectator', rp.is_spectator,
      'connection', rp.connection_status,
      'seatStatus', rp.seat_status,
      'leavePending', rp.leave_pending,
      'isMe', rp.user_id = _uid,
      'character', public.equipped_item_asset(rp.user_id, 'character'),
      'title', public.equipped_item_asset(rp.user_id, 'title')
    ) AS x
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id = _room_id
  ) s;

  RETURN jsonb_build_object(
    'roomId', _room.id, 'roomNumber', _room.room_number, 'title', _room.title,
    'status', _room.status, 'mode', _room.game_mode, 'baseBet', _room.base_bet,
    'maxPlayers', _room.max_players, 'carryPot', _room.carry_pot,
    'seats', COALESCE(_seats, '[]'::jsonb)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.get_round_state(_round_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _seats jsonb; _finished boolean;
  _me public.game_round_players; _stage_bet bigint; _owed bigint; _bal bigint;
  _acts jsonb := '[]'::jsonb; _expected int; _bad int; _room public.game_rooms;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _r.room_id;
  _finished := _r.status = 'finished';

  SELECT jsonb_agg(x ORDER BY (x->>'seat')::int) INTO _seats FROM (
    SELECT jsonb_build_object(
      'userId', p.user_id,
      'seat', p.seat,
      'nickname', pr.nickname,
      'level', pr.level,
      'rank', pr.rank,
      'avatarUrl', pr.avatar_url,
      'points', pr.game_points,
      'initialPoints', p.initial_points,
      'finalPoints', p.final_points,
      'folded', p.folded,
      'status', p.player_status,
      'connection', p.connection_status,
      'acted', p.acted,
      'totalBet', p.total_bet,
      'resultType', p.result_type,
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
  IF _me.id IS NOT NULL AND NOT _finished AND NOT _me.folded
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
    'carryIn', COALESCE(_r.carry_in,0), 'carryPot', COALESCE(_room.carry_pot,0),
    'availableActions', _acts,
    'cardIntegrityOk', (_bad = 0),
    'seats', COALESCE(_seats, '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'type',a.action_type,
                          'amount',a.amount,'stage',a.turn_number,'at',a.created_at) ORDER BY a.created_at)
                         FROM public.game_actions a WHERE a.round_id=_round_id), '[]'::jsonb)
  );
END; $function$;

-- 빈 방 일괄 정리 (관리자/주기 실행용)
CREATE OR REPLACE FUNCTION public.cleanup_empty_rooms()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _n int := 0;
BEGIN
  UPDATE public.game_rooms r SET status='closed', current_players=0
   WHERE r.status <> 'closed'
     AND NOT EXISTS (SELECT 1 FROM public.game_room_players p WHERE p.room_id=r.id)
     AND NOT EXISTS (SELECT 1 FROM public.game_rounds g WHERE g.room_id=r.id AND g.status <> 'finished');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $function$;