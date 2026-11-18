REVOKE ALL ON FUNCTION public.ingest_chain_deposit(text, text, text, text, bigint, integer, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_chain_deposit(text, text, text, text, bigint, integer, bigint, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.expire_crypto_charge_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_crypto_charge_requests() TO service_role;
REVOKE ALL ON FUNCTION public.crypto_setting_text(text) FROM PUBLIC, anon, authenticated;