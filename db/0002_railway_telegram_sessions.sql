-- Railway staging only. Session tokens are random and stored as SHA-256 hashes.
-- No Supabase dependency and no credentials in the client bundle.
CREATE TABLE IF NOT EXISTS public.angel_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.angel_accounts(id) ON DELETE CASCADE,
  token_sha256 char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT angel_session_expiration CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS angel_auth_sessions_account_idx
ON public.angel_auth_sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS angel_auth_sessions_active_idx
ON public.angel_auth_sessions(expires_at) WHERE revoked_at IS NULL;
INSERT INTO public.angel_schema_migrations (version)
VALUES ('0002_telegram_sessions')
ON CONFLICT (version) DO NOTHING;
