DO $do$
DECLARE _def text;
BEGIN
  FOR _def IN
    SELECT pg_get_functiondef(oid) FROM pg_proc
     WHERE proname IN ('affiliate_overview','admin_list_affiliates')
  LOOP
    _def := replace(_def, 'c.status = ''pending''', 'public.affiliate_commission_is_unsettled(c.status)');
    _def := replace(_def, 'c.status = ''settled''', 'public.affiliate_commission_is_settled(c.status)');
    EXECUTE _def;
  END LOOP;

  SELECT pg_get_functiondef(oid) INTO _def FROM pg_proc WHERE proname = 'admin_dashboard_overview';
  _def := replace(_def, 'status IN (''PENDING'',''UNSETTLED'')', 'public.affiliate_commission_is_unsettled(status)');
  EXECUTE _def;
END
$do$;
