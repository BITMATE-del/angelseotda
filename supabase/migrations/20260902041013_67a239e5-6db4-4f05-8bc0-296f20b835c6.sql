DO $$
DECLARE
  _place text;
  _settle text;
  _timeout text;
  _bad int;
BEGIN
  SELECT pg_get_functiondef('public.place_bet_action(uuid,uuid,text)'::regprocedure) INTO _place;
  SELECT pg_get_functiondef('public.settle_round(uuid)'::regprocedure) INTO _settle;
  SELECT pg_get_functiondef('public.enforce_turn_timeout(uuid)'::regprocedure) INTO _timeout;

  IF position('complete_sutda2_first_betting' in _place) = 0
     OR position('ROUND_NOT_READY_FOR_SHOWDOWN' in _settle) = 0
     OR position('complete_sutda2_first_betting' in _timeout) = 0 THEN
    RAISE EXCEPTION 'TWO_CARD_STATE_MACHINE_GUARD_MISSING';
  END IF;

  SELECT count(*) INTO _bad
  FROM public.game_rounds r
  JOIN public.game_round_players p ON p.round_id = r.id AND p.folded = false
  WHERE r.game_mode = 'sutda2' AND r.status <> 'finished'
    AND ((r.stage = 1 AND (SELECT count(*) FROM public.game_cards c WHERE c.round_id=r.id AND c.user_id=p.user_id) <> 1)
      OR (r.stage = 2 AND (SELECT count(*) FROM public.game_cards c WHERE c.round_id=r.id AND c.user_id=p.user_id) <> 2));
  IF _bad > 0 THEN RAISE EXCEPTION 'ROUND_CARD_INTEGRITY_ERROR: %', _bad; END IF;
END $$;