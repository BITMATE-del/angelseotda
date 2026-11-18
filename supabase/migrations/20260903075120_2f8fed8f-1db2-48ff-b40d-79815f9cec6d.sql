REVOKE EXECUTE ON FUNCTION public.admin_dashboard_overview() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_recent_activity(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_global_search(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_my_items() FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_user_items(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_user_items(uuid) FROM authenticated;