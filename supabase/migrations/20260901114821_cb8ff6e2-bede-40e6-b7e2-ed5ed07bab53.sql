DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname AS n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = 'public'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants g
       WHERE g.table_schema='public' AND g.table_name=t.n AND g.grantee='authenticated'
         AND g.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
    ) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t.n);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants g
       WHERE g.table_schema='public' AND g.table_name=t.n AND g.grantee='service_role'
         AND g.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
    ) THEN
      EXECUTE format('GRANT ALL ON public.%I TO service_role', t.n);
    END IF;
  END LOOP;
END $$;

GRANT SELECT ON public.notices TO anon;
GRANT SELECT ON public.room_types TO anon;
GRANT SELECT ON public.card_assets TO anon;
GRANT SELECT ON public.items TO anon;
GRANT SELECT ON public.rank_requirements TO anon;
GRANT SELECT ON public.achievements TO anon;