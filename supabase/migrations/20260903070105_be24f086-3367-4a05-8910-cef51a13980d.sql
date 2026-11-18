DROP POLICY IF EXISTS profiles_public_read ON public.profiles;
CREATE POLICY profiles_auth_read ON public.profiles FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;