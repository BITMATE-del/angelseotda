REVOKE ALL ON FUNCTION public.build_side_pots(uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_side_pots(uuid) TO service_role;