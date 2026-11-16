-- 3장 섯다 진행 순서 변경: 3번째 카드 지급 → 쪼기/최종 베팅 → 최종 2장 선택 → SHOWDOWN
CREATE OR REPLACE FUNCTION public.place_bet_action(_round_id uuid, _action_id uuid, _action_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);

  IF _acted = _alive AND COALESCE(_equal,false) THEN
    -- 1차 베팅 종료 → 3번째 카드 공개(쪼기) + 최종 베팅
    IF _r.game_mode = 'sutda3' AND _r.stage = 1 THEN
      UPDATE public.game_rounds
         SET stage = 2, phase = 'FINAL_BETTING', current_bet = 0,
             current_turn_user_id = (SELECT user_id FROM public.game_round_players
                                      WHERE round_id=_round_id AND folded=false AND is_all_in=false
                                      ORDER BY seat LIMIT 1),
             turn_deadline_at = now() + make_interval(secs => _turn)
       WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=false, player_status='SQUEEZING'
        WHERE round_id=_round_id AND folded=false;
      RETURN jsonb_build_object('phase','FINAL_BETTING','stage',2);
    END IF;
    -- 최종 베팅 종료 → 최종 승부패 2장 제출 단계
    IF _r.game_mode = 'sutda3' AND _r.stage >= 2 THEN
      UPDATE public.game_rounds
         SET phase = 'FINAL_HAND_SUBMIT', current_turn_user_id = NULL,
             turn_deadline_at = now() + interval '20 seconds'
       WHERE id=_round_id;
      UPDATE public.game_round_players SET player_status='HAND_SELECTION'
        WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
      RETURN jsonb_build_object('phase','FINAL_HAND_SUBMIT');
    END IF;
    RETURN public.settle_round(_round_id);
  END IF;

  SELECT user_id INTO _next FROM (
    SELECT user_id, seat FROM public.game_round_players
     WHERE round_id=_round_id AND folded=false AND is_all_in=false
  ) q ORDER BY (q.seat > _me.seat) DESC, CASE WHEN q.seat > _me.seat THEN q.seat ELSE q.seat + 1000 END LIMIT 1;

  IF _next IS NULL THEN
    IF _r.game_mode = 'sutda3' AND _r.stage >= 2 THEN
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

CREATE OR REPLACE FUNCTION public.select_final_hand(_round_id uuid, _card1 text, _card2 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _owned int; _pending int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id FOR UPDATE;
  IF _r.id IS NULL OR _r.status='finished' THEN RAISE EXCEPTION '진행 중인 라운드가 아닙니다.'; END IF;
  IF _r.phase NOT IN ('FINAL_HAND_SUBMIT','HAND_SELECTION') THEN
    RAISE EXCEPTION '지금은 승부패를 선택할 수 없습니다.';
  END IF;
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
    UPDATE public.game_rounds SET phase='SHOWDOWN', current_turn_user_id=NULL, turn_deadline_at=NULL
     WHERE id=_round_id;
    RETURN public.settle_round(_round_id);
  END IF;
  RETURN jsonb_build_object('ok', true, 'pending', _pending);
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_turn_timeout(_round_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.game_rounds; _u uuid; _stage_bet bigint; _act text; _p record; _turn int := 15;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL OR _r.status='finished' OR _r.turn_deadline_at IS NULL
     OR _r.turn_deadline_at > now() THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';
  _turn := COALESCE(_turn, 15);

  -- 최종 승부패 미제출자는 서버가 최고 족보 조합으로 자동 확정한다
  IF _r.phase IN ('FINAL_HAND_SUBMIT','HAND_SELECTION') THEN
    FOR _p IN SELECT * FROM public.game_round_players
               WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL LOOP
      UPDATE public.game_round_players
         SET selected_cards = (SELECT public.sutda_best_pair(array_agg(c.card_code ORDER BY c.card_order))->'cards'
                                 FROM public.game_cards c WHERE c.round_id=_round_id AND c.user_id=_p.user_id),
             selection_confirmed_at = now(), player_status='HAND_SELECTED'
       WHERE id = _p.id;
    END LOOP;
    UPDATE public.game_rounds SET phase='SHOWDOWN', current_turn_user_id=NULL, turn_deadline_at=NULL
     WHERE id=_round_id;
    RETURN public.settle_round(_round_id);
  END IF;

  _u := _r.current_turn_user_id;
  IF _u IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
    WHERE round_id=_round_id AND user_id=_u AND turn_number=_r.stage;
  _act := CASE WHEN _stage_bet >= _r.current_bet THEN 'check' ELSE 'die' END;

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
  IF (SELECT bool_and(acted OR is_all_in) FROM public.game_round_players
        WHERE round_id=_round_id AND folded=false) THEN
    IF _r.game_mode='sutda3' AND _r.stage=1 THEN
      UPDATE public.game_rounds SET stage=2, phase='FINAL_BETTING', current_bet=0,
             current_turn_user_id=(SELECT user_id FROM public.game_round_players
                                    WHERE round_id=_round_id AND folded=false AND is_all_in=false
                                    ORDER BY seat LIMIT 1),
             turn_deadline_at=now() + make_interval(secs => _turn)
       WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=false, player_status='SQUEEZING'
        WHERE round_id=_round_id AND folded=false;
      RETURN jsonb_build_object('ok', true, 'phase','FINAL_BETTING');
    END IF;
    IF _r.game_mode='sutda3' AND _r.stage>=2 THEN
      UPDATE public.game_rounds SET phase='FINAL_HAND_SUBMIT', current_turn_user_id=NULL,
             turn_deadline_at=now() + interval '20 seconds'
       WHERE id=_round_id;
      RETURN jsonb_build_object('ok', true, 'phase','FINAL_HAND_SUBMIT');
    END IF;
    RETURN public.settle_round(_round_id);
  END IF;

  UPDATE public.game_rounds
     SET current_turn_user_id = (
           SELECT user_id FROM (SELECT user_id, seat FROM public.game_round_players
                                 WHERE round_id=_round_id AND folded=false AND is_all_in=false) q
            ORDER BY (q.seat > (SELECT seat FROM public.game_round_players
                                 WHERE round_id=_round_id AND user_id=_u)) DESC,
                     q.seat LIMIT 1),
         turn_deadline_at = now() + make_interval(secs => _turn)
   WHERE id=_round_id;
  RETURN jsonb_build_object('ok', true, 'auto', _act);
END;
$function$;