-- Staging-only settlement audit receipt. No runtime payout access is granted.
-- The rollback-only audit must leave this table empty.
CREATE TABLE IF NOT EXISTS public.angel_settlement_audit_receipts (
  round_id uuid PRIMARY KEY REFERENCES public.angel_rounds(id) ON DELETE RESTRICT,
  ledger_event_id uuid NOT NULL UNIQUE REFERENCES public.angel_ledger_events(id) ON DELETE RESTRICT,
  gross_pot numeric(20,3) NOT NULL CHECK (gross_pot >= 0),
  rake_amount numeric(20,3) NOT NULL CHECK (rake_amount >= 0),
  payouts jsonb NOT NULL CHECK (jsonb_typeof(payouts)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT angel_audit_rake_within_pot CHECK (rake_amount <= gross_pot)
);
INSERT INTO public.angel_schema_migrations(version)
VALUES ('0008_settlement_rollback_audit') ON CONFLICT (version) DO NOTHING;
