-- NON-MONETARY betting exercise. Stores only synthetic state and event log.
-- Never references angel_wallets, angel_ledger_events or angel_ledger_entries.
CREATE TABLE IF NOT EXISTS public.angel_wager_simulations(
  round_id uuid PRIMARY KEY REFERENCES public.angel_rounds(id) ON DELETE RESTRICT,
  state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.angel_wager_sim_actions(
  request_id text PRIMARY KEY CHECK(length(request_id) BETWEEN 12 AND 100),
  round_id uuid NOT NULL REFERENCES public.angel_wager_simulations(round_id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN ('die','check','call','ping','ttadang','half','quarter','all_in')),
  revision integer NOT NULL CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(round_id,revision)
);
CREATE INDEX IF NOT EXISTS angel_wager_sim_actions_round_idx
  ON public.angel_wager_sim_actions(round_id,revision);
INSERT INTO public.angel_schema_migrations(version)
VALUES('0007_wager_simulation') ON CONFLICT(version) DO NOTHING;
