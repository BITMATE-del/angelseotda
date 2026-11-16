REVOKE EXECUTE ON FUNCTION public.admin_adjust_points_v2(uuid, text, bigint, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_crypto_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_crypto_settings(jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_my_crypto_charge(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_crypto_charge_request(bigint, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_adjust_points_v2(uuid, text, bigint, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_crypto_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_crypto_settings(jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_my_crypto_charge(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_crypto_charge_request(bigint, numeric) TO authenticated, service_role;