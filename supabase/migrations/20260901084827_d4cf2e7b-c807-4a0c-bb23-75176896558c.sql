ALTER TABLE public.game_round_players
  ADD COLUMN IF NOT EXISTS selected_cards jsonb,
  ADD COLUMN IF NOT EXISTS selection_confirmed_at timestamptz;

CREATE OR REPLACE FUNCTION public.game_round_players_selection_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.selected_cards IS DISTINCT FROM OLD.selected_cards AND NEW.selected_cards IS NOT NULL THEN
    IF OLD.selected_cards IS NOT NULL THEN
      RAISE EXCEPTION '이미 확정된 승부패는 변경할 수 없습니다.';
    END IF;
    NEW.selection_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_round_players_selection_guard ON public.game_round_players;
CREATE TRIGGER trg_round_players_selection_guard
BEFORE UPDATE ON public.game_round_players
FOR EACH ROW EXECUTE FUNCTION public.game_round_players_selection_guard();