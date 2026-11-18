-- Rollback-only Sutda ttaeng escrow exercise. No public endpoint.
-- Holds are represented in both wallet.locked_balance and per-round receipts.
CREATE TABLE IF NOT EXISTS public.angel_ttaeng_audit_escrows (
  round_id uuid NOT NULL REFERENCES public.angel_rounds(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id) ON DELETE RESTRICT,
  reserved numeric(20,3) NOT NULL CHECK(reserved >= 0),
  charged numeric(20,3) NOT NULL DEFAULT 0 CHECK(charged >= 0),
  state text NOT NULL DEFAULT 'HELD' CHECK(state IN ('HELD','SETTLED','REFUNDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(round_id,account_id),
  CONSTRAINT angel_ttaeng_audit_charge_cap CHECK (charged <= reserved)
);
CREATE INDEX IF NOT EXISTS angel_ttaeng_audit_escrows_account_idx
 ON public.angel_ttaeng_audit_escrows(account_id,state);
INSERT INTO public.angel_schema_migrations(version)
VALUES('0009_ttaeng_rollback_audit') ON CONFLICT(version) DO NOTHING;
