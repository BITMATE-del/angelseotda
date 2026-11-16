CREATE OR REPLACE FUNCTION public.create_crypto_charge_request(_krw bigint, _rate numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _enabled boolean; _addr text; _ttl int; _min bigint; _max bigint;
  _base numeric; _atomic bigint; _suffix int; _try int := 0; _id uuid; _exists uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _rate IS NULL OR _rate <= 0 THEN RAISE EXCEPTION '환율 정보가 없습니다.'; END IF;

  _enabled := COALESCE(crypto_setting_text('crypto_charge_enabled')::boolean, false);
  IF NOT _enabled THEN RAISE EXCEPTION 'USDT 자동충전이 현재 중지되어 있습니다.'; END IF;

  IF COALESCE(crypto_setting_text('crypto_test_mode')::boolean, false) THEN
    IF NOT (COALESCE((SELECT is_test_user FROM profiles WHERE id = _uid), false) OR is_admin(_uid)) THEN
      RAISE EXCEPTION 'USDT 자동충전은 현재 테스트 계정만 이용할 수 있습니다.';
    END IF;
  END IF;

  _addr := COALESCE(crypto_setting_text('crypto_deposit_address'), '');
  IF _addr = '' THEN RAISE EXCEPTION '입금주소가 설정되지 않았습니다.'; END IF;
  _ttl := COALESCE(crypto_setting_text('crypto_request_ttl_minutes')::int, 30);
  _min := COALESCE(crypto_setting_text('crypto_min_krw')::bigint, 10000);
  _max := COALESCE(crypto_setting_text('crypto_max_krw')::bigint, 5000000);

  IF _krw < _min THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MIN_CHARGE_NOT_MET', 'min_krw', _min,
      'message', format('최소 충전금액은 %s원입니다.', to_char(_min, 'FM999,999,999')));
  END IF;
  IF _krw > _max THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MAX_CHARGE_EXCEEDED', 'max_krw', _max,
      'message', format('최대 충전금액은 %s원입니다.', to_char(_max, 'FM999,999,999')));
  END IF;

  UPDATE crypto_charge_requests SET status = 'EXPIRED'
   WHERE user_id = _uid AND status = 'PENDING' AND expires_at < now();

  SELECT id INTO _exists FROM crypto_charge_requests
   WHERE user_id = _uid AND status IN ('PENDING','MATCHED','CONFIRMING','CREDITING')
   ORDER BY created_at DESC LIMIT 1;
  IF _exists IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTIVE_REQUEST_EXISTS', 'request_id', _exists);
  END IF;

  _base := floor((_krw::numeric / _rate) * 1000)::numeric / 1000;
  LOOP
    _try := _try + 1;
    _suffix := floor(random() * 900 + 100)::int;
    _atomic := (round(_base * 1000000))::bigint + _suffix;
    BEGIN
      INSERT INTO crypto_charge_requests
        (user_id, requested_krw, rate_krw_per_usdt, requested_usdt, expected_usdt,
         expected_usdt_atomic, wallet_address, expires_at)
      VALUES (_uid, _krw, _rate, _base, (_atomic::numeric / 1000000), _atomic, _addr,
              now() + make_interval(mins => _ttl))
      RETURNING id INTO _id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF _try >= 30 THEN RAISE EXCEPTION '고유 충전금액 생성에 실패했습니다. 다시 시도해 주세요.'; END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'request_id', _id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_crypto_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  RETURN crypto_preflight_db() || jsonb_build_object(
    'required_confirmations', crypto_setting_text('crypto_required_confirmations'),
    'ttl_minutes', crypto_setting_text('crypto_request_ttl_minutes'),
    'min_krw', COALESCE(crypto_setting_text('crypto_min_krw'), '10000'),
    'max_krw', COALESCE(crypto_setting_text('crypto_max_krw'), '5000000'),
    'watcher_last_run', crypto_setting_text('crypto_watcher_last_run'),
    'watcher_last_cursor', crypto_setting_text('crypto_watcher_last_cursor'),
    'pending', (SELECT count(*) FROM crypto_charge_requests WHERE status = 'PENDING'),
    'confirming', (SELECT count(*) FROM crypto_charge_requests WHERE status IN ('MATCHED','CONFIRMING','CREDITING')),
    'credited_today', (SELECT count(*) FROM crypto_charge_requests WHERE status = 'CREDITED' AND credited_at::date = current_date),
    'credited_today_krw', (SELECT COALESCE(sum(requested_krw),0) FROM crypto_charge_requests WHERE status = 'CREDITED' AND credited_at::date = current_date),
    'unmatched', (SELECT count(*) FROM chain_deposits WHERE status IN ('UNMATCHED','EXPIRED_MATCH'))
  );
END;
$$;