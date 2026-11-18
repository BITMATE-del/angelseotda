-- FIX: sutda3 FIRST_BETTING 에서 한 명만 남았을 때(다이 승) 판이 종료되지 않아
-- 남은 1명도 다이할 수 있었고 POT 이 아무에게도 지급되지 않던 문제.
-- 기존 sutda2 / FINAL_BETTING 처리와 동일한 경로(3번째 카드 지급 → SHOWDOWN → settle_round)만 추가한다.
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

  -- 남은 생존자가 나 혼자면 이 판은 이미 끝난 판이다 (다이 승). 마지막 1명의 다이는 허용하지 않는다.
  IF _action_type IN ('die','jjol') THEN
    SELECT count(*) INTO _alive FROM public.game_round_players
     WHERE round_id=_round_id AND folded=false;
    IF _alive <= 1 THEN RAISE EXCEPTION '마지막 남은 참가자는 다이할 수 없습니다.'; END IF;
  END IF;

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
    -- [FIX] sutda3 1차 베팅에서 다이 승이 확정된 경우: 3번째 카드까지 지급한 뒤 즉시 정산한다.
    IF _r.phase='FIRST_BETTING' AND _r.game_mode='sutda3' THEN
      IF NOT public.transition_game_round_phase(_round_id,'FIRST_BETTING','LAST_CARD_DEALT') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      PERFORM public.deal_next_card(_round_id);
      IF NOT public.transition_game_round_phase(_round_id,'LAST_CARD_DEALT','FINAL_BETTING') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      UPDATE public.game_rounds
        SET stage=2, current_bet=0, current_turn_user_id=NULL, turn_deadline_at=NULL, last_activity_at=now()
        WHERE id=_round_id;
      UPDATE public.game_round_players SET acted=true
        WHERE round_id=_round_id AND folded=false;
      IF NOT public.transition_game_round_phase(_round_id,'FINAL_BETTING','SHOWDOWN') THEN
        RETURN jsonb_build_object('ok',false,'error','INVALID_PHASE_TRANSITION');
      END IF;
      RETURN public.settle_round(_round_id);
    END IF;
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