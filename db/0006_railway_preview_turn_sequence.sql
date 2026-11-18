-- Preserve deterministic server turn action order even when many actions
-- are inserted in one PostgreSQL transaction (now() timestamps are equal).
-- Legacy PREVIEW_PASS events retain NULL action_index and sort first.
ALTER TABLE public.angel_game_actions
  ADD COLUMN IF NOT EXISTS action_index integer
  CHECK (action_index > 0);
CREATE UNIQUE INDEX IF NOT EXISTS angel_game_actions_round_sequence_idx
  ON public.angel_game_actions(round_id,action_index)
  WHERE action_index IS NOT NULL;
INSERT INTO public.angel_schema_migrations(version)
VALUES('0006_preview_turn_sequence') ON CONFLICT(version) DO NOTHING;
