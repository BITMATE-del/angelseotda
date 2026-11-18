-- Staging-only transaction receipts. These are NOT permission to wager or settle.
-- No public SQL execution grants or wallet top-ups are introduced.
CREATE TABLE IF NOT EXISTS public.angel_bet_receipts (
  request_id text PRIMARY KEY CHECK (length(request_id) BETWEEN 12 AND 100),
  round_id uuid NOT NULL REFERENCES public.angel_rounds(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action = 'SANDBOX_DEBIT'),
  amount numeric(20,3) NOT NULL CHECK (amount > 0),
  wallet_after numeric(20,3) NOT NULL CHECK (wallet_after >= 0),
  pot_after numeric(20,3) NOT NULL CHECK (pot_after >= 0),
  ledger_event_id uuid NOT NULL UNIQUE REFERENCES public.angel_ledger_events(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS angel_bet_receipts_round_account_idx
  ON public.angel_bet_receipts(round_id, account_id);

-- Only one sandbox debit per user/round while the real betting state machine
-- (repeat calls, raises, calls, side pots) remains unimplemented.
CREATE UNIQUE INDEX IF NOT EXISTS angel_one_sandbox_debit_per_player
  ON public.angel_bet_receipts(round_id, account_id);

INSERT INTO public.angel_schema_migrations(version)
VALUES ('0004_sandbox_bet_receipts')
ON CONFLICT(version) DO NOTHING;
