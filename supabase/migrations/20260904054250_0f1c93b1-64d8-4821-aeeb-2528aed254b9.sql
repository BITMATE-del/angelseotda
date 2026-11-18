-- 1) 좌석번호 1-base 전환 (unique(room_id,seat) 충돌 없이 2단계 이동)
UPDATE public.game_room_players SET seat = seat - 1000 WHERE seat >= 0;
UPDATE public.game_room_players SET seat = seat + 1001 WHERE seat < 0;

UPDATE public.game_round_players SET seat = seat - 1000
 WHERE seat >= 0 AND round_id IN (SELECT id FROM public.game_rounds WHERE status <> 'finished');
UPDATE public.game_round_players SET seat = seat + 1001 WHERE seat < 0;

UPDATE public.game_rounds SET dealer_seat = dealer_seat + 1
 WHERE status <> 'finished';

ALTER TABLE public.game_room_players
  DROP CONSTRAINT IF EXISTS game_room_players_seat_min;
ALTER TABLE public.game_room_players
  ADD CONSTRAINT game_room_players_seat_min CHECK (seat >= 1);

-- 2) 자동 배정 입장도 1번 좌석부터
CREATE OR REPLACE FUNCTION public.join_room(_room_id uuid, _spectator boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _room game_rooms; _rt room_types; _p profiles; _seat integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  SELECT * INTO _rt FROM room_types WHERE id = _room.room_type;
  SELECT * INTO _p FROM profiles WHERE id = _uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION '회원 정보를 찾을 수 없습니다.'; END IF;
  IF _p.status = 'suspended' THEN RAISE EXCEPTION '이용이 정지된 계정입니다.'; END IF;

  IF public.ops_flag('maintenance_enabled') AND NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '현재 서버 점검 중입니다. 진행 중인 게임은 정상 종료되며 새로운 게임 입장은 잠시 제한됩니다.';
  END IF;

  IF _room.is_test_room AND NOT _p.is_test_user AND NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '테스트 전용 방입니다. 테스트 계정만 입장할 수 있습니다.';
  END IF;
  IF NOT _room.is_test_room AND _p.is_test_user AND public.ops_flag('game_lock') THEN
    RAISE EXCEPTION '현재 신규 게임 입장이 제한되어 있습니다.';
  END IF;

  IF NOT _spectator AND _rt.id IS NOT NULL THEN
    IF NOT _rt.active THEN RAISE EXCEPTION '%은 현재 이용할 수 없습니다.', _rt.name; END IF;
    IF _p.game_points < _rt.min_points THEN
      RAISE EXCEPTION '% 입장을 위해 최소 %P가 필요합니다.', _rt.name, to_char(_rt.min_points, 'FM999,999,999');
    END IF;
  END IF;

  SELECT seat INTO _seat FROM game_room_players WHERE room_id = _room_id AND user_id = _uid;
  IF _seat IS NOT NULL THEN RETURN _seat; END IF;

  IF NOT _spectator THEN
    IF (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false) >= _room.max_players THEN
      RAISE EXCEPTION '방 정원이 가득 찼습니다.';
    END IF;
  END IF;

  -- 좌석번호는 1..max_players 로 고정한다 (빈 좌석만 채운다)
  SELECT COALESCE(min(s.n), 1) INTO _seat
  FROM generate_series(1, GREATEST(_room.max_players, 1)) AS s(n)
  WHERE NOT EXISTS (SELECT 1 FROM game_room_players gp
    WHERE gp.room_id = _room_id AND gp.seat = s.n);

  INSERT INTO game_room_players (room_id, user_id, seat, is_spectator, entry_balance_snapshot)
  VALUES (_room_id, _uid, _seat, _spectator, _p.game_points);

  UPDATE game_rooms SET current_players =
    (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
  WHERE id = _room_id;

  RETURN _seat;
END; $function$;

-- 3) 빈 좌석 직접 착석 / 게임 중 좌석 이동 금지 / 동시 착석 원자성
CREATE OR REPLACE FUNCTION public.select_seat(_room_id uuid, _seat integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _room game_rooms; _cur integer; _active boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF _seat < 1 OR _seat > _room.max_players THEN RAISE EXCEPTION '잘못된 좌석입니다.'; END IF;

  SELECT seat INTO _cur FROM game_room_players WHERE room_id = _room_id AND user_id = _uid;
  IF _cur = _seat THEN RETURN _seat; END IF;

  SELECT EXISTS (SELECT 1 FROM public.game_rounds
                  WHERE room_id = _room_id AND status <> 'finished') INTO _active;
  -- 진행 중인 판에서는 좌석을 이동할 수 없다 (WAITING 상태에서만 빈 자리 이동 허용)
  IF _active AND _cur IS NOT NULL THEN
    RAISE EXCEPTION '게임 진행 중에는 좌석을 이동할 수 없습니다.';
  END IF;

  IF EXISTS (SELECT 1 FROM game_room_players
              WHERE room_id = _room_id AND seat = _seat AND user_id <> _uid) THEN
    RAISE EXCEPTION '이미 사용 중인 좌석입니다.';
  END IF;

  BEGIN
    IF _cur IS NULL THEN
      INSERT INTO game_room_players (room_id, user_id, seat, is_spectator, seat_status,
                                     connection_status, last_seen_at, entry_balance_snapshot)
      VALUES (_room_id, _uid, _seat, false, 'OCCUPIED', 'CONNECTED', now(),
              (SELECT game_points FROM public.profiles WHERE id = _uid));
    ELSE
      UPDATE game_room_players
         SET seat = _seat, is_spectator = false, seat_status = 'OCCUPIED',
             connection_status = 'CONNECTED', last_seen_at = now()
       WHERE room_id = _room_id AND user_id = _uid;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- 동시 착석 경합: unique(room_id, seat) 로 한 명만 성공한다
    RAISE EXCEPTION '이미 사용 중인 좌석입니다.';
  END;

  UPDATE game_rooms SET current_players =
    (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
   WHERE id = _room_id;
  RETURN _seat;
END; $function$;

-- 4) 선(先) 순환: 첫 판 1명 확정 → 이후 정상판마다 좌석번호 순환(빈 좌석 skip), REMATCH 중 유지
CREATE OR REPLACE FUNCTION public.start_game_round(_room_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _room public.game_rooms;
  _deck text[] := ARRAY['01-gwang','01-normal','02-a','02-b','03-gwang','03-normal','04-a','04-b',
                        '05-a','05-b','06-a','06-b','07-a','07-b','08-gwang','08-normal',
                        '09-a','09-b','10-a','10-b'];
  _shuffled text[]; _players record;
  _n int; _idx int := 0; _initial int; _round_id uuid; _num int; _turn int := 15;
  _mode text; _first_seat int; _prev_dealer int; _carry bigint := 0; _rematch boolean := false;
  _rusers uuid[]; _carrybet bigint; _k int; _ante bigint; _ante_sum bigint := 0;
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

  -- 신규 판만 기본 베팅 잔액을 요구한다. 재경기는 올인 참가자(잔액 0P) 포함해 반드시 진행되어야 한다.
  IF NOT _rematch AND EXISTS (
    SELECT 1 FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
      AND pr.game_points < _room.base_bet
  ) THEN RAISE EXCEPTION '기본 베팅 포인트가 부족한 참가자가 있습니다.'; END IF;

  SELECT COALESCE((value->>'turn_seconds')::int, 15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);
  SELECT COALESCE(max(round_number),0)+1 INTO _num FROM public.game_rounds WHERE room_id=_room_id;

  -- 선(先) 결정: 직전 판의 선 기준으로 좌석번호 순환. 빈 좌석은 skip.
  SELECT dealer_seat INTO _prev_dealer FROM public.game_rounds
   WHERE room_id=_room_id ORDER BY round_number DESC LIMIT 1;

  IF _rematch AND _prev_dealer IS NOT NULL THEN
    -- REMATCH 체인 중에는 선이 이동하지 않는다
    _first_seat := _prev_dealer;
  ELSIF _prev_dealer IS NULL THEN
    -- 첫 정규판: 가장 낮은 좌석번호를 선으로 확정
    SELECT min(rp.seat) INTO _first_seat FROM public.game_room_players rp
     WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
       AND (NOT _rematch OR rp.user_id = ANY(_rusers));
  ELSE
    SELECT rp.seat INTO _first_seat FROM public.game_room_players rp
     WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
       AND (NOT _rematch OR rp.user_id = ANY(_rusers))
     ORDER BY ((rp.seat - _prev_dealer - 1 + 100) % 100) ASC
     LIMIT 1;
  END IF;

  IF _first_seat IS NULL THEN
    SELECT min(rp.seat) INTO _first_seat FROM public.game_room_players rp
     WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
       AND (NOT _rematch OR rp.user_id = ANY(_rusers));
  END IF;

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

  -- 카드 지급 순서는 선 좌석부터 좌석번호 순환 순서를 따른다
  FOR _players IN
    SELECT rp.user_id, rp.seat, pr.game_points
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id=_room_id AND rp.is_spectator=false AND rp.leave_pending=false
      AND (NOT _rematch OR rp.user_id = ANY(_rusers))
    ORDER BY ((rp.seat - _first_seat + 100) % 100) ASC
  LOOP
    _idx := _idx + 1;
    _carrybet := CASE WHEN _rematch
      THEN COALESCE((_room.carry_caps->>_players.user_id::text)::bigint, 0) ELSE 0 END;

    -- 재경기에서 이미 올인한 참가자는 잔액만큼만(0P 포함) 앤티를 부담하고 ALL_IN 상태로 유지한다.
    _ante := CASE WHEN _rematch
      THEN LEAST(_room.base_bet, GREATEST(COALESCE(_players.game_points,0), 0))
      ELSE _room.base_bet END;
    _ante_sum := _ante_sum + _ante;

    INSERT INTO public.game_round_players(round_id, user_id, seat, initial_points, folded,
                                          player_status, connection_status, acted, total_bet, carry_bet,
                                          is_all_in)
    VALUES (_round_id, _players.user_id, _players.seat, _players.game_points, false,
            CASE WHEN _mode='sutda3' THEN 'OPEN_CARD_SELECTION'
                 WHEN _ante < _room.base_bet THEN 'ALL_IN' ELSE 'ACTIVE' END,
            'CONNECTED', false, 0, _carrybet,
            _ante < _room.base_bet);

    -- 초기 카드만 지급 (2장모드=1장, 3장모드=2장)
    FOR _k IN 1.._initial LOOP
      INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
      VALUES (_round_id, _players.user_id, _shuffled[(_k-1)*_n + _idx], _k);
    END LOOP;

    IF _ante > 0 THEN
      PERFORM public.game_take_bet(_players.user_id, _ante, _round_id);
    END IF;
    INSERT INTO public.game_actions(round_id, user_id, action_type, amount, turn_number, action_id)
    VALUES (_round_id, _players.user_id, 'ante', _ante, 1, gen_random_uuid());
    UPDATE public.game_round_players SET total_bet = _ante + _carrybet
      WHERE round_id=_round_id AND user_id=_players.user_id;
  END LOOP;

  -- 첫 action 순서도 선 좌석부터
  UPDATE public.game_rounds
     SET pot = _ante_sum + _carry,
         current_turn_user_id = CASE WHEN _mode='sutda3' THEN NULL ELSE
           (SELECT user_id FROM public.game_round_players
             WHERE round_id=_round_id AND is_all_in = false
             ORDER BY ((seat - _first_seat + 100) % 100) ASC LIMIT 1) END
   WHERE id = _round_id;

  UPDATE public.game_rooms
     SET status = 'playing', carry_pot = 0, current_round_id = _round_id,
         rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
   WHERE id = _room_id;
  RETURN _round_id;
END; $function$;

-- 5) 모든 클라이언트가 같은 선 배지를 보도록 라운드 상태에 dealerSeat 를 노출
CREATE OR REPLACE FUNCTION public.get_round_state(_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _seats jsonb; _finished boolean;
  _me public.game_round_players; _stage_bet bigint; _owed bigint; _bal bigint;
  _acts jsonb := '[]'::jsonb; _expected int; _bad int; _room public.game_rooms; _cnt int;
  _show boolean; _choice text; _pots jsonb; _pot_sum bigint; _my_contrib bigint;
  _a text; _amt bigint;
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
  _my_contrib := COALESCE(_me.total_bet,0);
  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
    WHERE round_id=_round_id AND user_id=_uid AND turn_number=_r.stage;
  _owed := GREATEST(_r.current_bet - COALESCE(_stage_bet,0), 0);

  IF _me.id IS NOT NULL AND NOT _finished AND NOT _me.folded AND NOT _me.is_all_in
     AND _r.current_turn_user_id = _uid
     AND _r.phase IN ('BETTING','FIRST_BETTING','FINAL_BETTING') THEN
    SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;
    SELECT count(*) INTO _cnt FROM public.game_actions
      WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','quarter','all_in');

    _acts := jsonb_build_array(jsonb_build_object(
      'action','die','amount',0,'additionalAmount',0,'totalTarget',_stage_bet,'enabled',true));

    FOREACH _a IN ARRAY ARRAY['check','call','ping','ttadang','half','quarter','all_in'] LOOP
      CONTINUE WHEN _a='check'   AND _owed <> 0;
      CONTINUE WHEN _a='call'    AND _owed = 0;
      CONTINUE WHEN _a='ping'    AND _r.current_bet > _r.base_bet;
      CONTINUE WHEN _a='all_in'  AND (_cnt < 2 OR COALESCE(_bal,0) <= 0);
      _amt := public.bet_additional_amount(_a,_r.pot,_r.current_bet,_r.base_bet,COALESCE(_stage_bet,0),COALESCE(_bal,0));
      _acts := _acts || jsonb_build_array(jsonb_build_object(
        'action', _a,
        'amount', _amt,
        'additionalAmount', _amt,
        'totalTarget', COALESCE(_stage_bet,0) + _amt,
        'enabled', true));
    END LOOP;
  END IF;

  _expected := CASE WHEN _r.game_mode='sutda3' THEN _r.stage + 1 ELSE _r.stage END;
  SELECT count(*) INTO _bad FROM public.game_round_players p
   WHERE p.round_id=_round_id AND p.folded=false
     AND (SELECT count(*) FROM public.game_cards c
           WHERE c.round_id=_round_id AND c.user_id=p.user_id) <> _expected;

  _pots := public.build_side_pots(_round_id);
  SELECT COALESCE(sum((e->>'amount')::bigint),0) INTO _pot_sum
    FROM jsonb_array_elements(_pots) e;

  RETURN jsonb_build_object(
    'roundId', _r.id, 'roomId', _r.room_id, 'roomNumber', _room.room_number,
    'mode', _r.game_mode, 'status', _r.status,
    'phase', _r.phase, 'stage', _r.stage, 'pot', _r.pot, 'baseBet', _r.base_bet,
    'currentBet', _r.current_bet, 'turnUserId', _r.current_turn_user_id,
    'turnDeadline', _r.turn_deadline_at, 'winnerId', _r.winner_id,
    'dealerSeat', _r.dealer_seat,
    'settlementStatus', _r.settlement_status, 'roundNumber', _r.round_number,
    'rematch', (_r.settlement_status = 'REMATCH'),
    'rematchReason', CASE WHEN _r.settlement_status = 'REMATCH' THEN
        CASE WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                           WHERE p.round_id=_round_id AND p.hand_code LIKE 'gusa%' AND p.folded=false)
             THEN 'GUSA' ELSE 'DRAW' END ELSE NULL END,
    'isRematchRound', COALESCE(_r.is_rematch,false),
    'roomMode', _room.game_mode,
    'carryIn', COALESCE(_r.carry_in,0), 'carryPot', COALESCE(_room.carry_pot,0),
    'pots', _pots,
    'potSum', _pot_sum,
    -- 이월 POT은 game_rounds.pot(= 참가자 total_bet 합계)에 이미 포함되어 있으므로 중복 합산하지 않는다.
    'potSumOk', (_pot_sum = _r.pot),
    'myContribution', _my_contrib,
    'myOwed', _owed,
    'expectedCardCount', _expected,
    'availableActions', _acts,
    'cardIntegrityOk', (_bad = 0),
    'myCardCount', (SELECT count(*) FROM public.game_cards c WHERE c.round_id=_round_id AND c.user_id=_uid),
    'foldWinChoice', _choice,
    'foldWinDeadline', _r.fold_win_reveal_deadline,
    'iAmFoldWinner', (_r.fold_win_reveal_choice IS NOT NULL AND _r.winner_id = _uid),
    'seats', COALESCE(_seats, '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'actionId',a.action_id,
                          'userId',a.user_id,'type',a.action_type,
                          'amount',a.amount,'stage',a.turn_number,'at',a.created_at) ORDER BY a.created_at)
                         FROM public.game_actions a WHERE a.round_id=_round_id), '[]'::jsonb)
  );
END; $function$;
