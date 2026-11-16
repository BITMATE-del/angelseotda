-- Staging-only encrypted? No: private hands are server-only DB rows and are
-- NEVER read by public room/list endpoints. Only authenticated server handlers
-- select a single verified account's own cards. No browser DB credentials.
-- The schema is isolated from the legacy Supabase-based game engine.
CREATE TABLE IF NOT EXISTS public.angel_round_private_hands (
  round_id uuid NOT NULL REFERENCES public.angel_rounds(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id) ON DELETE RESTRICT,
  card_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id,account_id),
  CONSTRAINT angel_cards_are_json_array CHECK (jsonb_typeof(card_ids)='array')
);
CREATE TABLE IF NOT EXISTS public.angel_round_runtime (
  round_id uuid PRIMARY KEY REFERENCES public.angel_rounds(id) ON DELETE RESTRICT,
  turn_seat integer NOT NULL CHECK (turn_seat BETWEEN 1 AND 10),
  dealt_at timestamptz NOT NULL DEFAULT now(),
  -- No betting actions are accepted until a separate audited round engine exists.
  accepts_bets boolean NOT NULL DEFAULT false CHECK (accepts_bets=false)
);
CREATE INDEX IF NOT EXISTS angel_round_hands_account_idx
  ON public.angel_round_private_hands(account_id,round_id);
INSERT INTO public.angel_schema_migrations(version)
VALUES ('0003_private_preview_deals') ON CONFLICT (version) DO NOTHING;
