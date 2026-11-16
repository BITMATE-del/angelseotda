REVOKE EXECUTE ON FUNCTION public.admin_adjust_points_v2(uuid, text, bigint, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_crypto_overview() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_crypto_settings(jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_my_crypto_charge(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_crypto_charge_request(bigint, numeric) FROM anon;

UPDATE public.app_settings SET value = to_jsonb(false), updated_at = now() WHERE key = 'crypto_charge_enabled';
UPDATE public.app_settings SET value = 'null'::jsonb, updated_at = now() WHERE key = 'crypto_watcher_last_error';