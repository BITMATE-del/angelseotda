CREATE OR REPLACE FUNCTION public.sutda_round_result(_round_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _r public.game_rounds;
  _room public.game_rooms;
  _alive int; _total int;
  _choice text; _show boolean; _fold_win boolean;
  _players jsonb; _payouts jsonb; _pots jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id;
  IF _r.id IS NULL THEN RETURN jsonb_build_object('ready', false); END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _r.room_id;

  -- 이 방에 참여했던 회원만 조회할 수 있다 (관전/좌석 포함)
  IF NOT EXISTS (SELECT 1 FROM public.game_round_players p
                  WHERE p.round_id = _round_id AND p.user_id = _uid)
     AND NOT EXISTS (SELECT 1 FROM public.game_room_players rp
                      WHERE rp.room_id = _r.room_id AND rp.user_id = _uid) THEN
    RETURN jsonb_build_object('ready', false);
  END IF;

  IF _r.status <> 'finished' OR _r.settlement_status = 'PENDING' THEN
    RETURN jsonb_build_object('ready', false);
  END IF;

  SELECT count(*) FILTER (WHERE folded = false), count(*)
    INTO _alive, _total
    FROM public.game_round_players WHERE round_id = _round_id;

  _choice := _r.fold_win_reveal_choice;
  IF _choice = 'PENDING' AND _r.fold_win_reveal_deadline IS NOT NULL
     AND now() > _r.fold_win_reveal_deadline THEN
    _choice := 'TIMEOUT';
  END IF;
  _fold_win := _r.fold_win_reveal_choice IS NOT NULL;
  -- 공개 정책: 정상 쇼다운은 생존자 전원 공개, 폴드승은 승자가 REVEALED 를 고른 경우만
  _show := (_r.fold_win_reveal_choice IS NULL) OR (_choice = 'REVEALED');

  _pots := public.build_side_pots(_round_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'seat')::int), '[]'::jsonb) INTO _players FROM (
    SELECT jsonb_build_object(
      'userId', p.user_id,
      'seat', p.seat,
      'nickname', pr.nickname,
      'isMe', p.user_id = _uid,
      'folded', p.folded,
      'resultType', p.result_type,
      'net', COALESCE(p.final_points, 0) - COALESCE(p.initial_points, 0),
      'finalPoints', p.final_points,
      'totalBet', p.total_bet,
      'payout', COALESCE((SELECT sum(t.amount) FROM public.point_transactions t
                           WHERE t.reference_type = 'game_round' AND t.reference_id = _round_id
                             AND t.user_id = p.user_id AND t.type = 'game_win'), 0),
      'revealed', (_show AND NOT p.folded),
      'cards', CASE WHEN _show AND NOT p.folded THEN
          COALESCE((SELECT jsonb_agg(c.card_code ORDER BY c.card_order)
                      FROM public.game_cards c
                     WHERE c.round_id = _round_id AND c.user_id = p.user_id), '[]'::jsonb)
        ELSE '[]'::jsonb END,
      'handLabel', CASE WHEN _show AND NOT p.folded THEN p.hand_rank ELSE NULL END,
      'stillSeated', EXISTS (SELECT 1 FROM public.game_room_players rp
                              WHERE rp.room_id = _r.room_id AND rp.user_id = p.user_id
                                AND rp.seat_status = 'SEATED')
    ) AS x
    FROM public.game_round_players p
    JOIN public.profiles pr ON pr.id = p.user_id
    WHERE p.round_id = _round_id
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'userId', t.user_id,
           'nickname', (SELECT nickname FROM public.profiles WHERE id = t.user_id),
           'amount', t.amount) ORDER BY t.created_at), '[]'::jsonb)
    INTO _payouts
    FROM public.point_transactions t
   WHERE t.reference_type = 'game_round' AND t.reference_id = _round_id
     AND t.type = 'game_win' AND t.amount > 0;

  RETURN jsonb_build_object(
    'ready', true,
    'roundId', _r.id,
    'roundNumber', _r.round_number,
    'mode', _r.game_mode,
    'pot', _r.pot,
    'settlementStatus', _r.settlement_status,
    'rematch', (_r.settlement_status = 'REMATCH'),
    'rematchReason', CASE WHEN _r.settlement_status = 'REMATCH' THEN
        CASE WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                           WHERE p.round_id = _round_id AND p.folded = false
                             AND p.hand_code LIKE 'gusa%')
             THEN 'GUSA' ELSE 'DRAW' END ELSE NULL END,
    'carryPot', COALESCE(_room.carry_pot, 0),
    'showdown', NOT _fold_win,
    'foldWin', _fold_win,
    'revealMode', CASE WHEN NOT _fold_win THEN 'SHOWDOWN'
                       WHEN _choice = 'REVEALED' THEN 'REVEALED' ELSE 'HIDDEN' END,
    'revealChoice', _choice,
    'canChooseReveal', (_choice = 'PENDING' AND _r.winner_id = _uid),
    'pots', _pots,
    'payouts', _payouts,
    'players', _players
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sutda_round_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sutda_round_result(uuid) TO authenticated;