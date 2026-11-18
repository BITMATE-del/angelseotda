DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.game_rounds r
    WHERE r.game_mode = 'sutda2'
      AND r.status <> 'finished'
      AND r.phase = 'FIRST_BETTING'
      AND r.stage = 1
  ) THEN
    UPDATE public.game_rounds
    SET turn_deadline_at = GREATEST(COALESCE(turn_deadline_at, now()), now() + interval '15 seconds')
    WHERE game_mode = 'sutda2'
      AND status <> 'finished'
      AND phase = 'FIRST_BETTING'
      AND stage = 1;
  END IF;
END $$;