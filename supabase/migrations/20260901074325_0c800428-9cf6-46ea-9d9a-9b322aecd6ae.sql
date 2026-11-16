REVOKE EXECUTE ON FUNCTION public.join_room(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room(uuid, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_level(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_level(uuid, integer, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_grant_item(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_item(uuid, uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_update_room_type(text, bigint, bigint, integer, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_room_type(text, bigint, bigint, integer, boolean, boolean, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_update_setting(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_setting(text, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_update_card_asset(text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_card_asset(text, text, boolean, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_handle_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_handle_report(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_recalc_season_rankings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recalc_season_rankings() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_set_season_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_season_status(uuid, text) TO authenticated, service_role;