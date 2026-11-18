-- 베팅 추가 차감액 단일 계산기.
-- 반환값은 항상 "이번 액션으로 내 잔액에서 실제 추가 차감되는 금액"이다.
CREATE OR REPLACE FUNCTION public.bet_additional_amount(
  _action_type text,
  _pot bigint,
  _current_bet bigint,
  _base_bet bigint,
  _stage_bet bigint,
  _balance bigint
) RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _owed bigint;
  _eff_pot bigint;
  _amount bigint := 0;
  _target bigint;
BEGIN
  _owed := GREATEST(COALESCE(_current_bet,0) - COALESCE(_stage_bet,0), 0);
  -- 콜을 맞춘 직후의 유효 POT (레이즈 기준). pot_after_action 을 미리 쓰지 않는다.
  _eff_pot := COALESCE(_pot,0) + _owed;

  IF _action_type IN ('die','jjol','check') THEN
    _amount := 0;
  ELSIF _action_type = 'call' THEN
    _amount := _owed;
  ELSIF _action_type = 'ping' THEN
    _amount := _owed + _base_bet;
  ELSIF _action_type = 'ttadang' THEN
    -- 따당: 직전 유효 베팅의 2배가 목표 총액. 이미 낸 금액은 다시 더하지 않는다.
    _target := GREATEST(COALESCE(_current_bet,0), _base_bet) * 2;
    _amount := GREATEST(_target - COALESCE(_stage_bet,0), _owed + _base_bet);
  ELSIF _action_type = 'half' THEN
    _amount := _owed + GREATEST(_eff_pot / 2, _base_bet);
  ELSIF _action_type = 'quarter' THEN
    _amount := _owed + GREATEST(_eff_pot / 4, _base_bet);
  ELSIF _action_type = 'all_in' THEN
    _amount := GREATEST(COALESCE(_balance,0), 0);
  ELSE
    RETURN NULL;
  END IF;

  IF _amount > COALESCE(_balance,0) THEN _amount := GREATEST(COALESCE(_balance,0),0); END IF;
  RETURN GREATEST(_amount, 0);
END $function$;

GRANT EXECUTE ON FUNCTION public.bet_additional_amount(text,bigint,bigint,bigint,bigint,bigint) TO authenticated, service_role;

-- place_bet_action: 금액 계산을 bet_additional_amount 로 통합 (그 외 흐름은 기존 그대로)
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
  IF _r.phase NOT IN ('FIRST_BETTING','FINAL_BETTING') THEN RAISE EXCEPTION '지금은 베팅할 수 없습니다.'; END IF;

  SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
  WHERE round_id=_round_id AND user_id=_uid AND turn_number=_r.stage;
  _owed := GREATEST(_r.current_bet - _stage_bet, 0);
  _new_bet := _r.current_bet;
  SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;

  IF _action_type IN ('die','jjol') THEN
    UPDATE public.game_round_players SET folded=true, player_status='FOLDED', acted=true WHERE id=_me.id;
  ELSIF _action_type = 'check' THEN
    IF _owed > 0 THEN RAISE EXCEPTION '체크할 수 없습니다.'; END IF;
  ELSIF _action_type IN ('call','ping','ttadang','half','quarter','all_in') THEN
    IF _action_type = 'all_in' THEN
      SELECT count(*) INTO _cnt FROM public.game_actions
      WHERE round_id=_round_id AND action_type IN ('call','ping','ttadang','half','quarter','all_in');
      IF _cnt < 2 THEN RAISE EXCEPTION '올인은 베팅이 2회 이상 진행된 후에 사용할 수 있습니다.'; END IF;
      IF COALESCE(_bal,0) <= 0 THEN RAISE EXCEPTION '보유 포인트가 없습니다.'; END IF;
    END IF;
    _amount := public.bet_additional_amount(_action_type,_r.pot,_r.current_bet,_r.base_bet,_stage_bet,_bal);
    IF _action_type = 'call' THEN
      _new_bet := _r.current_bet;
    ELSE
      _new_bet := GREATEST(_r.current_bet, _stage_bet + _amount);
    END IF;
  ELSE RAISE EXCEPTION '알 수 없는 행동입니다: %', _action_type;
  END IF;

  IF _amount > _bal THEN _amount := _bal; _new_bet := GREATEST(_new_bet,_stage_bet+_amount); END IF;
  IF _amount > 0 THEN PERFORM public.game_take_bet(_uid,_amount,_round_id); END IF;
  INSERT INTO public.game_actions(round_id,user_id,action_type,amount,turn_number,action_id)
  VALUES (_round_id,_uid,_action_type,_amount,_r.stage,_action_id);
  UPDATE public.game_round_players
  SET acted=true,total_bet=total_bet+_amount,
      is_all_in=CASE WHEN folded THEN false WHEN _action_type='all_in' OR _bal-_amount<=0 THEN true ELSE is_all_in END,
      all_in_at=CASE WHEN NOT folded AND (_action_type='all_in' OR _bal-_amount<=0) THEN COALESCE(all_in_at,now()) ELSE all_in_at END,
      player_status=CASE WHEN folded THEN 'FOLDED' WHEN _action_type='all_in' OR _bal-_amount<=0 THEN 'ALL_IN' ELSE 'ACTIVE' END
  WHERE id=_me.id;
  IF _new_bet > _r.current_bet THEN
    UPDATE public.game_round_players SET acted=false
    WHERE round_id=_round_id AND folded=false AND user_id<>_uid AND is_all_in=false;
  END IF;
  UPDATE public.game_rounds SET pot=pot+_amount,current_bet=GREATEST(_new_bet,current_bet) WHERE id=_round_id;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;

  SELECT count(*) INTO _alive FROM public.game_round_players WHERE round_id=_round_id AND folded=false;
  IF _alive <= 1 THEN
    IF _r.phase='FIRST_BETTING' AND _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF _r.phase='FINAL_BETTING' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      RETURN public.settle_round(_round_id);
    END IF;
  END IF;

  SELECT count(*) INTO _acted FROM public.game_round_players
  WHERE round_id=_round_id AND folded=false AND (acted=true OR is_all_in=true);
  SELECT bool_and(COALESCE(sb.s,0)=_r.current_bet OR p.is_all_in) INTO _equal
  FROM public.game_round_players p
  LEFT JOIN (SELECT user_id,sum(amount) s FROM public.game_actions
             WHERE round_id=_round_id AND turn_number=_r.stage GROUP BY user_id) sb ON sb.user_id=p.user_id
  WHERE p.round_id=_round_id AND p.folded=false;
  SELECT COALESCE((value->>'turn_seconds')::int,15) INTO _turn FROM public.app_settings WHERE key='game_rules';

  IF _acted=_alive AND COALESCE(_equal,false) THEN
    IF _r.stage=1 AND _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF _r.stage=1 AND _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      PERFORM public.deal_next_card(_round_id);
      IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds SET stage=2,current_bet=0,
        current_turn_user_id=(SELECT user_id FROM public.game_round_players WHERE round_id=_round_id AND folded=false AND is_all_in=false ORDER BY seat LIMIT 1),
        turn_deadline_at=now()+make_interval(secs=>COALESCE(_turn,15)) WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=false,player_status=CASE WHEN is_all_in THEN 'ALL_IN' ELSE 'ACTIVE' END
      WHERE round_id=_round_id AND folded=false;
      RETURN jsonb_build_object('phase','FINAL_BETTING','stage',2,'dealt',true);
    END IF;
    IF _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','FINAL_HAND_SUBMIT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds SET current_turn_user_id=NULL,turn_deadline_at=now()+interval '20 seconds' WHERE id=_round_id;
      UPDATE public.game_round_players SET player_status='HAND_SELECTION'
      WHERE round_id=_round_id AND folded=false AND selection_confirmed_at IS NULL;
      RETURN jsonb_build_object('phase','FINAL_HAND_SUBMIT');
    END IF;
    IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
      RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
    END IF;
    UPDATE public.game_rounds SET current_turn_user_id=NULL,turn_deadline_at=NULL WHERE id=_round_id;
    RETURN public.settle_round(_round_id);
  END IF;

  SELECT user_id INTO _next FROM public.game_round_players
  WHERE round_id=_round_id AND folded=false AND is_all_in=false AND user_id<>_uid
  ORDER BY CASE WHEN seat>_me.seat THEN 0 ELSE 1 END,seat LIMIT 1;
  IF _next IS NULL THEN
    IF _r.stage=1 AND _r.game_mode='sutda2' THEN RETURN public.complete_sutda2_first_betting(_round_id); END IF;
    IF _r.phase='FINAL_BETTING' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      RETURN public.settle_round(_round_id);
    END IF;
    RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
  END IF;
  UPDATE public.game_rounds SET current_turn_user_id=_next,turn_deadline_at=now()+make_interval(secs=>COALESCE(_turn,15)) WHERE id=_round_id;
  RETURN jsonb_build_object('ok',true,'turnUserId',_next,'amount',_amount);
END $function$;

-- get_round_state: availableActions 를 동일 계산기로 통일 + 금액 의미 필드 명시 + POT 합계 검증값 추가
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
      -- 사용 조건
      CONTINUE WHEN _a='check'   AND _owed <> 0;
      CONTINUE WHEN _a='call'    AND _owed = 0;
      CONTINUE WHEN _a='ping'    AND _r.current_bet > _r.base_bet;
      CONTINUE WHEN _a='all_in'  AND (_cnt < 2 OR COALESCE(_bal,0) <= 0);
      _amt := public.bet_additional_amount(_a,_r.pot,_r.current_bet,_r.base_bet,COALESCE(_stage_bet,0),COALESCE(_bal,0));
      _acts := _acts || jsonb_build_array(jsonb_build_object(
        'action', _a,
        'amount', _amt,                       -- 실제 추가 차감액 (UI 표시값)
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
    'potSumOk', (_pot_sum = _r.pot + COALESCE(_r.carry_in,0)),
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