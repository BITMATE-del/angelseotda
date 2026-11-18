-- SUTDA3 OPEN CARD SIMULTANEOUS REVEAL
-- 공개패 선택 확정과 공개를 분리한다. 상대의 공개패 identity 는 대상자 전원 선택이 끝나
-- (서버 phase 가 OPEN_CARD_SELECTION 을 벗어난 뒤) 비로소 클라이언트로 전달된다.
-- 카드 배분/베팅/정산/족보/재경기/RLS/스키마 변경 없음 - 조회 마스킹 + 타이머 기준값 노출만.
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
  _a text; _amt bigint; _hide_first boolean;
  _open_revealed boolean; _open_pending int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _r.room_id;
  _finished := _r.status = 'finished';

  -- 3장 테이블의 구사/동점 재경기(2장 REMATCH)는 상대 첫 장도 비공개로 유지한다.
  _hide_first := COALESCE(_r.is_rematch,false) AND _room.game_mode = 'sutda3';

  -- 3장 섯다 공개패: "선택 확정"과 "공개"를 분리한다.
  -- 대상자 전원의 선택(수동 또는 서버 자동선택)이 끝나 서버 phase 가 OPEN_CARD_SELECTION 을
  -- 벗어난 시점에만 공개패 identity 를 상대 클라이언트로 내려준다(동시 공개).
  _open_revealed := _r.game_mode = 'sutda3' AND _r.phase <> 'OPEN_CARD_SELECTION';
  SELECT count(*) INTO _open_pending FROM public.game_round_players p
   WHERE p.round_id = _round_id AND p.folded = false AND p.open_card IS NULL;
  IF _r.game_mode <> 'sutda3' THEN _open_pending := 0; END IF;

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
      'openCard', CASE WHEN _r.game_mode='sutda3' AND (p.user_id = _uid OR _open_revealed)
                       THEN p.open_card ELSE NULL END,
      'openCardSelected', (_r.game_mode='sutda3' AND p.open_card IS NOT NULL),
      'cards', CASE
        WHEN p.user_id = _uid OR (_show AND NOT p.folded) THEN
          COALESCE((SELECT jsonb_agg(c.card_code ORDER BY c.card_order) FROM public.game_cards c
             WHERE c.round_id=_round_id AND c.user_id=p.user_id), '[]'::jsonb)
        WHEN _r.game_mode='sutda3' AND _open_revealed AND p.open_card IS NOT NULL AND NOT p.folded THEN
          jsonb_build_array(p.open_card)
        WHEN _r.game_mode='sutda2' AND NOT _hide_first THEN
          COALESCE((SELECT jsonb_agg(c.card_code ORDER BY c.card_order) FROM public.game_cards c
             WHERE c.round_id=_round_id AND c.user_id=p.user_id AND c.card_order=1), '[]'::jsonb)
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
    'serverNow', now(),
    'openCardRevealed', COALESCE(_open_revealed,false),
    'openCardPending', COALESCE(_open_pending,0),
    'dealerSeat', _r.dealer_seat,
    'settlementStatus', _r.settlement_status, 'roundNumber', _r.round_number,
    'rematch', (_r.settlement_status = 'REMATCH'),
    'rematchReason', CASE WHEN _r.settlement_status = 'REMATCH' THEN
        CASE
          WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                        WHERE p.round_id=_round_id AND p.hand_code = 'gusa_meongteong' AND p.folded=false)
            THEN 'GUSA_MEONGTEONG'
          WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                        WHERE p.round_id=_round_id AND p.hand_code = 'gusa' AND p.folded=false)
            THEN 'GUSA'
          ELSE 'DRAW' END ELSE NULL END,
    'isRematchRound', COALESCE(_r.is_rematch,false),
    'roomMode', _room.game_mode,
    'carryIn', COALESCE(_r.carry_in,0), 'carryPot', COALESCE(_room.carry_pot,0),
    'pots', _pots,
    'potSum', _pot_sum,
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