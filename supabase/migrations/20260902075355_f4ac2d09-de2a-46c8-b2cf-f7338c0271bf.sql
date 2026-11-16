REVOKE ALL ON FUNCTION public.crypto_setting_text(text) FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.crypto_touch_updated_at() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.expire_crypto_charge_requests() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.expire_crypto_charge_requests() TO service_role;