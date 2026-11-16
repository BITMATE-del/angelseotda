CREATE TABLE public.telegram_links (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL UNIQUE,
  telegram_username text,
  telegram_first_name text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
GRANT SELECT ON public.telegram_links TO authenticated;
GRANT ALL ON public.telegram_links TO service_role;
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own telegram link" ON public.telegram_links FOR SELECT TO authenticated USING (auth.uid() = user_id);