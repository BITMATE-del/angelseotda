-- ANGEL SUTDA staging-only schema baseline.
-- This creates independent PostgreSQL structures; it does NOT migrate Supabase
-- auth, RPC functions, or game settlements. Never connect clients directly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.angel_schema_migrations (
  version text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.angel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL UNIQUE CHECK (telegram_id > 0),
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 40),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.angel_wallets (
  account_id uuid PRIMARY KEY REFERENCES public.angel_accounts(id) ON DELETE RESTRICT,
  balance numeric(20,3) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  locked_balance numeric(20,3) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT angel_wallet_locked_not_overbalance CHECK (locked_balance <= balance)
);

CREATE TABLE IF NOT EXISTS public.angel_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('SUTDA2','SUTDA3','DORI')),
  room_name text NOT NULL CHECK (char_length(room_name) BETWEEN 1 AND 80),
  base_bet numeric(20,3) NOT NULL CHECK (base_bet > 0),
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','PLAYING','CLOSED')),
  owner_id uuid NOT NULL REFERENCES public.angel_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.angel_room_seats (
  room_id uuid NOT NULL REFERENCES public.angel_rooms(id) ON DELETE CASCADE,
  seat_number integer NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id,seat_number),
  UNIQUE (room_id,account_id)
);

CREATE TABLE IF NOT EXISTS public.angel_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.angel_rooms(id),
  round_number integer NOT NULL CHECK (round_number > 0),
  phase text NOT NULL DEFAULT 'WAITING',
  pot numeric(20,3) NOT NULL DEFAULT 0 CHECK (pot >= 0),
  rake_amount numeric(20,3) NOT NULL DEFAULT 0 CHECK (rake_amount >= 0),
  settlement_status text NOT NULL DEFAULT 'PENDING' CHECK (settlement_status IN ('PENDING','POSTED','VOID')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (room_id,round_number)
);

CREATE TABLE IF NOT EXISTS public.angel_round_players (
  round_id uuid NOT NULL REFERENCES public.angel_rounds(id),
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id),
  seat_number integer NOT NULL CHECK (seat_number BETWEEN 1 AND 10),
  committed_amount numeric(20,3) NOT NULL DEFAULT 0 CHECK (committed_amount >= 0),
  payout_amount numeric(20,3) NOT NULL DEFAULT 0 CHECK (payout_amount >= 0),
  result text,
  PRIMARY KEY (round_id,account_id),
  UNIQUE (round_id,seat_number)
);

CREATE TABLE IF NOT EXISTS public.angel_game_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.angel_rounds(id),
  actor_id uuid NOT NULL REFERENCES public.angel_accounts(id),
  request_id text NOT NULL UNIQUE CHECK (char_length(request_id) BETWEEN 1 AND 128),
  action_type text NOT NULL,
  amount numeric(20,3) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS angel_actions_round_idx ON public.angel_game_actions(round_id,created_at);

CREATE TABLE IF NOT EXISTS public.angel_ledger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 160),
  event_type text NOT NULL,
  round_id uuid REFERENCES public.angel_rounds(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.angel_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.angel_ledger_events(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id) ON DELETE RESTRICT,
  amount numeric(20,3) NOT NULL CHECK (amount <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS angel_ledger_account_idx ON public.angel_ledger_entries(account_id,created_at);
CREATE INDEX IF NOT EXISTS angel_ledger_event_idx ON public.angel_ledger_entries(event_id);

CREATE TABLE IF NOT EXISTS public.angel_app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.angel_app_settings(key,value) VALUES
 ('deposit_fee_rate','0'::jsonb),
 ('withdrawal_fee_rate','0'::jsonb),
 ('pot_rake_rate','0.03'::jsonb),
 ('payments_enabled','false'::jsonb),
 ('settlement_enabled','false'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.angel_schema_migrations(version) VALUES ('0001_staging_baseline')
ON CONFLICT (version) DO NOTHING;
