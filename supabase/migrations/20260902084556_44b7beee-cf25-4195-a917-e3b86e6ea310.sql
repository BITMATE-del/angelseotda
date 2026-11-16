INSERT INTO public.app_settings (key, value, updated_at) VALUES
  ('crypto_test_mode', 'true'::jsonb, now()),
  ('crypto_watcher_lock_status', '"IDLE"'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crypto_watcher_begin(_stale_seconds int DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _status text; _started timestamptz;
BEGIN
  PERFORM 1 FROM app_settings WHERE key = 'crypto_watcher_lock_status' FOR UPDATE;
  _status := crypto_setting_text('crypto_watcher_lock_status');
  _started := NULLIF(crypto_setting_text('crypto_watcher_last_started_at'), '')::timestamptz;
  IF _status = 'RUNNING' AND _started IS NOT NULL
     AND _started > now() - make_interval(secs => _stale_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'LOCKED', 'started_at', _started);
  END IF;
  INSERT INTO app_settings (key, value, updated_at) VALUES
    ('crypto_watcher_lock_status', '"RUNNING"'::jsonb, now()),
    ('crypto_watcher_last_started_at', to_jsonb(now()::text), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.crypto_watcher_finish(_stats jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ok boolean := COALESCE((_stats->>'ok')::boolean, false); _now timestamptz := now();
BEGIN
  INSERT INTO app_settings (key, value, updated_at) VALUES
    ('crypto_watcher_lock_status', '"IDLE"'::jsonb, _now),
    ('crypto_watcher_last_completed_at', to_jsonb(_now::text), _now),
    ('crypto_watcher_last_duration_ms', COALESCE(_stats->'duration_ms', '0'::jsonb), _now),
    ('crypto_watcher_detected_count', COALESCE(_stats->'detected', '0'::jsonb), _now),
    ('crypto_watcher_matched_count', COALESCE(_stats->'matched', '0'::jsonb), _now),
    ('crypto_watcher_credited_count', COALESCE(_stats->'credited', '0'::jsonb), _now)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = _now;

  IF _ok THEN
    INSERT INTO app_settings (key, value, updated_at) VALUES
      ('crypto_watcher_last_success_at', to_jsonb(_now::text), _now),
      ('crypto_watcher_fail_streak', '0'::jsonb, _now)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = _now;
  ELSE
    INSERT INTO app_settings (key, value, updated_at) VALUES
      ('crypto_watcher_last_error_at', to_jsonb(_now::text), _now),
      ('crypto_watcher_fail_streak',
        to_jsonb(COALESCE(NULLIF(crypto_setting_text('crypto_watcher_fail_streak'), '')::int, 0) + 1), _now)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = _now;
  END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.crypto_watcher_begin(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crypto_watcher_finish(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crypto_watcher_begin(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.crypto_watcher_finish(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crypto_preflight_db()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'deposit_address', COALESCE(crypto_setting_text('crypto_deposit_address'), ''),
    'address_ok', COALESCE(crypto_setting_text('crypto_deposit_address'), '') ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$',
    'usdt_contract', COALESCE(crypto_setting_text('crypto_usdt_contract'), ''),
    'contract_ok', COALESCE(crypto_setting_text('crypto_usdt_contract'), '') ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$',
    'sheet_id', COALESCE(crypto_setting_text('crypto_rate_sheet_id'), ''),
    'sheet_gid', COALESCE(crypto_setting_text('crypto_rate_sheet_gid'), ''),
    'rate_cell', COALESCE(crypto_setting_text('crypto_rate_cell'), ''),
    'rate_cache', NULLIF(crypto_setting_text('crypto_rate_cache'), '')::numeric,
    'rate_cached_at', NULLIF(crypto_setting_text('crypto_rate_cached_at'), ''),
    'rate_error', crypto_setting_text('crypto_rate_error'),
    'watcher_last_started_at', NULLIF(crypto_setting_text('crypto_watcher_last_started_at'), ''),
    'watcher_last_completed_at', NULLIF(crypto_setting_text('crypto_watcher_last_completed_at'), ''),
    'watcher_last_success_at', NULLIF(crypto_setting_text('crypto_watcher_last_success_at'), ''),
    'watcher_last_error_at', NULLIF(crypto_setting_text('crypto_watcher_last_error_at'), ''),
    'watcher_last_error', crypto_setting_text('crypto_watcher_last_error'),
    'watcher_lock_status', crypto_setting_text('crypto_watcher_lock_status'),
    'watcher_fail_streak', COALESCE(NULLIF(crypto_setting_text('crypto_watcher_fail_streak'), '')::int, 0),
    'watcher_duration_ms', COALESCE(NULLIF(crypto_setting_text('crypto_watcher_last_duration_ms'), '')::int, 0),
    'watcher_detected_count', COALESCE(NULLIF(crypto_setting_text('crypto_watcher_detected_count'), '')::int, 0),
    'watcher_matched_count', COALESCE(NULLIF(crypto_setting_text('crypto_watcher_matched_count'), '')::int, 0),
    'watcher_credited_count', COALESCE(NULLIF(crypto_setting_text('crypto_watcher_credited_count'), '')::int, 0),
    'watcher_cursor', crypto_setting_text('crypto_watcher_last_cursor'),
    'test_mode', COALESCE(crypto_setting_text('crypto_test_mode')::boolean, true),
    'enabled', COALESCE(crypto_setting_text('crypto_charge_enabled')::boolean, false)
  );
$$;
REVOKE ALL ON FUNCTION public.crypto_preflight_db() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crypto_preflight_db() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_crypto_preflight()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  RETURN crypto_preflight_db();
END; $$;
REVOKE ALL ON FUNCTION public.admin_crypto_preflight() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_crypto_preflight() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_update_crypto_settings(_patch jsonb, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _k text; _pf jsonb; _missing text[] := '{}';
  _before jsonb := '{}'::jsonb; _was boolean;
  _allowed text[] := ARRAY[
  'crypto_charge_enabled','crypto_deposit_address','crypto_usdt_contract',
  'crypto_required_confirmations','crypto_request_ttl_minutes','crypto_watcher_interval_seconds',
  'crypto_rate_sheet_id','crypto_rate_sheet_gid','crypto_rate_cell','crypto_min_krw','crypto_max_krw',
  'crypto_test_mode'];
BEGIN
  IF NOT public.is_super_admin(_uid) THEN RAISE EXCEPTION '최고관리자만 변경할 수 있습니다.'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 2 THEN RAISE EXCEPTION '변경 사유를 입력해 주세요.'; END IF;

  IF _patch ? 'crypto_deposit_address'
     AND COALESCE(_patch->>'crypto_deposit_address', '') <> ''
     AND (_patch->>'crypto_deposit_address') !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
    RAISE EXCEPTION 'TRC20 입금주소 형식이 올바르지 않습니다.';
  END IF;
  IF _patch ? 'crypto_usdt_contract'
     AND COALESCE(_patch->>'crypto_usdt_contract', '') <> ''
     AND (_patch->>'crypto_usdt_contract') !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
    RAISE EXCEPTION 'USDT 컨트랙트 주소 형식이 올바르지 않습니다.';
  END IF;

  _was := COALESCE(crypto_setting_text('crypto_charge_enabled')::boolean, false);

  IF COALESCE((_patch->>'crypto_charge_enabled')::boolean, false) AND NOT _was THEN
    _pf := crypto_preflight_db();
    IF NOT COALESCE((_pf->>'address_ok')::boolean, false) THEN _missing := _missing || '입금주소'; END IF;
    IF NOT COALESCE((_pf->>'contract_ok')::boolean, false) THEN _missing := _missing || 'USDT 컨트랙트'; END IF;
    IF COALESCE(_pf->>'sheet_id', '') = '' THEN _missing := _missing || '환율 시트 설정'; END IF;
    IF (_pf->>'rate_cache') IS NULL OR (_pf->>'rate_cache')::numeric <= 0 THEN _missing := _missing || '최근 정상 환율'; END IF;
    IF (_pf->>'watcher_last_success_at') IS NULL
       OR (_pf->>'watcher_last_success_at')::timestamptz < now() - interval '10 minutes' THEN
      _missing := _missing || '감시기 최근 정상 실행';
    END IF;
    IF array_length(_missing, 1) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'PREFLIGHT_FAILED', 'missing', to_jsonb(_missing));
    END IF;
  END IF;

  FOR _k IN SELECT jsonb_object_keys(_patch) LOOP
    IF NOT (_k = ANY(_allowed)) THEN RAISE EXCEPTION '허용되지 않은 설정입니다: %', _k; END IF;
    _before := _before || jsonb_build_object(_k, (SELECT value FROM app_settings WHERE key = _k));
    INSERT INTO app_settings (key, value, updated_at) VALUES (_k, _patch -> _k, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END LOOP;

  INSERT INTO admin_logs (admin_id, action, target_type, metadata, reason)
  VALUES (_uid, 'CRYPTO_SETTINGS_UPDATED', 'app_settings',
          jsonb_build_object('before', _before, 'after', _patch), _reason);

  IF _patch ? 'crypto_charge_enabled'
     AND COALESCE((_patch->>'crypto_charge_enabled')::boolean, false) <> _was THEN
    INSERT INTO admin_logs (admin_id, action, target_type, metadata, reason)
    VALUES (_uid,
            CASE WHEN COALESCE((_patch->>'crypto_charge_enabled')::boolean, false)
                 THEN 'AUTO_CHARGE_ENABLED' ELSE 'AUTO_CHARGE_DISABLED' END,
            'app_settings', jsonb_build_object('before', _was), _reason);
  END IF;

  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.create_crypto_charge_request(_krw bigint, _rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  IF _krw < _min OR _krw > _max THEN
    RAISE EXCEPTION '충전 금액은 % ~ % 원 사이여야 합니다.', _min, _max;
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
END; $$;

CREATE OR REPLACE FUNCTION public.admin_crypto_feed(_limit int DEFAULT 40)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _rows jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'at') DESC), '[]'::jsonb) INTO _rows FROM (
    (SELECT jsonb_build_object(
      'at', d.detected_at, 'kind', 'DEPOSIT_' || d.status,
      'amount_usdt', d.amount_usdt, 'txid', d.txid, 'nickname', NULL::text,
      'krw', NULL::bigint, 'points', NULL::bigint) AS x
     FROM chain_deposits d ORDER BY d.detected_at DESC LIMIT _limit)
    UNION ALL
    (SELECT jsonb_build_object(
      'at', COALESCE(r.credited_at, r.confirmed_at, r.matched_at, r.created_at),
      'kind', 'REQUEST_' || r.status,
      'amount_usdt', r.expected_usdt, 'txid', r.txid,
      'nickname', p.nickname, 'krw', r.requested_krw, 'points', r.credited_points) AS x
     FROM crypto_charge_requests r LEFT JOIN profiles p ON p.id = r.user_id
     ORDER BY COALESCE(r.credited_at, r.confirmed_at, r.matched_at, r.created_at) DESC LIMIT _limit)
  ) s;
  RETURN _rows;
END; $$;
REVOKE ALL ON FUNCTION public.admin_crypto_feed(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_crypto_feed(int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_crypto_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  RETURN crypto_preflight_db() || jsonb_build_object(
    'required_confirmations', crypto_setting_text('crypto_required_confirmations'),
    'ttl_minutes', crypto_setting_text('crypto_request_ttl_minutes'),
    'watcher_last_run', crypto_setting_text('crypto_watcher_last_run'),
    'watcher_last_cursor', crypto_setting_text('crypto_watcher_last_cursor'),
    'pending', (SELECT count(*) FROM crypto_charge_requests WHERE status = 'PENDING'),
    'confirming', (SELECT count(*) FROM crypto_charge_requests WHERE status IN ('MATCHED','CONFIRMING','CREDITING')),
    'credited_today', (SELECT count(*) FROM crypto_charge_requests WHERE status = 'CREDITED' AND credited_at::date = current_date),
    'credited_today_krw', (SELECT COALESCE(sum(requested_krw),0) FROM crypto_charge_requests WHERE status = 'CREDITED' AND credited_at::date = current_date),
    'unmatched', (SELECT count(*) FROM chain_deposits WHERE status IN ('UNMATCHED','EXPIRED_MATCH'))
  );
END; $$;