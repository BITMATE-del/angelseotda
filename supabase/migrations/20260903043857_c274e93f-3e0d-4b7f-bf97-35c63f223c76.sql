CREATE OR REPLACE FUNCTION public.test_seed_round_cards(_round_id uuid, _map jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _r public.game_rounds; _n int; _i int := 0; _p record; _need int; _have int;
  _deck text[]; _cards text[]; _all text[] := '{}'; _k int; _pos int;
BEGIN
  PERFORM public.test_driver_assert(NULL);
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  PERFORM public.test_driver_assert(_r.room_id);
  IF _r.settled THEN RAISE EXCEPTION 'ROUND_ALREADY_SETTLED'; END IF;

  _need := CASE WHEN _r.game_mode = 'sutda3' THEN 3 ELSE 2 END;
  SELECT count(*) INTO _n FROM public.game_round_players WHERE round_id = _round_id;
  _deck := _r.deck;

  FOR _p IN SELECT * FROM public.game_round_players WHERE round_id = _round_id ORDER BY seat LOOP
    _i := _i + 1;
    SELECT array_agg(t ORDER BY ord) INTO _cards
      FROM jsonb_array_elements_text(_map -> _p.user_id::text) WITH ORDINALITY x(t, ord);
    IF _cards IS NULL OR array_length(_cards, 1) <> _need THEN
      RAISE EXCEPTION 'TEST_DRIVER_BAD_SEED: user % 카드 %장 필요', _p.user_id, _need;
    END IF;
    _all := _all || _cards;
    SELECT count(*) INTO _have FROM public.game_cards WHERE round_id = _round_id AND user_id = _p.user_id;
    DELETE FROM public.game_cards WHERE round_id = _round_id AND user_id = _p.user_id;
    FOR _k IN 1.._have LOOP
      INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
      VALUES (_round_id, _p.user_id, _cards[_k], _k);
    END LOOP;
    FOR _k IN (_have + 1).._need LOOP
      _pos := (_k - 1) * _n + _i;
      IF _pos > array_length(_deck, 1) THEN RAISE EXCEPTION 'TEST_DRIVER_BAD_SEED: deck overflow'; END IF;
      _deck[_pos] := _cards[_k];
    END LOOP;
  END LOOP;

  IF (SELECT count(DISTINCT c) FROM unnest(_all) c) <> array_length(_all, 1) THEN
    RAISE EXCEPTION 'TEST_DRIVER_BAD_SEED: 중복 카드';
  END IF;

  UPDATE public.game_rounds SET deck = _deck WHERE id = _round_id;
  PERFORM public.log_room_event(_r.room_id, 'TEST_SEED_CARDS', NULL, _round_id, NULL, NULL,
    _r.pot, _r.pot, '{}'::jsonb, jsonb_build_object('players', _n, 'mode', _r.game_mode),
    NULL, 'OK', NULL);
  RETURN jsonb_build_object('ok', true, 'players', _n, 'mode', _r.game_mode);
END $$;

CREATE OR REPLACE FUNCTION public.test_pot_report(_case_key text, _round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r public.game_rounds; _rep jsonb; _contrib bigint; _pots jsonb; _potsum bigint;
BEGIN
  PERFORM public.test_driver_assert(NULL);
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  PERFORM public.test_driver_assert(_r.room_id);

  _pots := public.build_side_pots(_round_id);
  SELECT COALESCE(sum((v->>'amount')::bigint),0) INTO _potsum FROM jsonb_array_elements(_pots) v;
  SELECT COALESCE(sum(amount),0) + COALESCE(_r.carry_in,0) INTO _contrib
    FROM public.game_actions WHERE round_id = _round_id;

  _rep := jsonb_build_object(
    'caseKey', _case_key, 'roundId', _round_id, 'mode', _r.game_mode,
    'settlementStatus', _r.settlement_status, 'roundPot', _r.pot, 'carryIn', _r.carry_in,
    'contributionSum', _contrib, 'potLayerSum', _potsum, 'pots', _pots,
    'players', (SELECT jsonb_agg(jsonb_build_object(
        'seat', p.seat, 'nickname', pr.nickname, 'userId', p.user_id,
        'totalBet', p.total_bet, 'folded', p.folded, 'allIn', p.is_all_in,
        'handCode', p.hand_code, 'resultType', p.result_type,
        'payout', COALESCE((SELECT sum(t.amount) FROM public.point_transactions t
                            WHERE t.reference_id = _round_id AND t.user_id = p.user_id
                              AND t.type = 'game_win'), 0)
      ) ORDER BY p.seat)
      FROM public.game_round_players p JOIN public.profiles pr ON pr.id = p.user_id
      WHERE p.round_id = _round_id),
    'payoutSum', COALESCE((SELECT sum(amount) FROM public.point_transactions
                           WHERE reference_id = _round_id AND type = 'game_win'), 0)
  );
  INSERT INTO public.test_pot_reports(case_key, round_id, report) VALUES (_case_key, _round_id, _rep);
  RETURN _rep;
END $$;