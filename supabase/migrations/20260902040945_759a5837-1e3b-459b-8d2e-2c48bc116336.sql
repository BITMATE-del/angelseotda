UPDATE public.game_rounds
SET turn_deadline_at = GREATEST(COALESCE(turn_deadline_at, now()), now() + interval '15 seconds')
WHERE game_mode = 'sutda2'
  AND status <> 'finished'
  AND phase = 'FIRST_BETTING'
  AND stage = 1;