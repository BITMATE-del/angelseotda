REVOKE ALL ON public.telegram_links FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.telegram_links FROM authenticated;
CREATE POLICY "admin read telegram links" ON public.telegram_links FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));