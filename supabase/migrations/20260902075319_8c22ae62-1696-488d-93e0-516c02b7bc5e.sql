-- ============ 1. 운영 설정 ============
INSERT INTO public.app_settings (key, value) VALUES
  ('crypto_charge_enabled', 'false'::jsonb),
  ('crypto_deposit_address', '""'::jsonb),
  ('crypto_usdt_contract', '"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"'::jsonb),
  ('crypto_required_confirmations', '19'::jsonb),
  ('crypto_request_ttl_minutes', '30'::jsonb),
  ('crypto_watcher_interval_seconds', '60'::jsonb),
  ('crypto_rate_sheet_id', '""'::jsonb),
  ('crypto_rate_sheet_gid', '"0"'::jsonb),
  ('crypto_rate_cell', '"A1"'::jsonb),
  ('crypto_rate_cache', 'null'::jsonb),
  ('crypto_rate_cached_at', 'null'::jsonb),
  ('crypto_rate_error', 'null'::jsonb),
  ('crypto_watcher_last_run', 'null'::jsonb),
  ('crypto_watcher_last_cursor', 'null'::jsonb),
  ('crypto_watcher_last_error', 'null'::jsonb),
  ('crypto_min_krw', '10000'::jsonb),
  ('crypto_max_krw', '5000000'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============ 2. crypto_charge_requests ============
CREATE TABLE IF NOT EXISTS public.crypto_charge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_krw bigint NOT NULL,
  rate_krw_per_usdt numeric NOT NULL,
  requested_usdt numeric(20,6) NOT NULL,
  expected_usdt numeric(20,6) NOT NULL,
  expected_usdt_atomic bigint NOT NULL,
  wallet_address text NOT NULL,
  asset text NOT NULL DEFAULT 'USDT',
  network text NOT NULL DEFAULT 'TRC20',
  status text NOT NULL DEFAULT 'PENDING',
  txid text,
  chain_deposit_id uuid,
  affiliate_id uuid,
  credited_points bigint,
  fee_amount numeric,
  affiliate_commission numeric,
  company_fee numeric,
  error_code text,
  error_message text,
  expires_at timestamptz NOT NULL,
  matched_at timestamptz,
  confirmed_at timestamptz,
  credited_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crypto_charge_requests_status_chk CHECK (
    status IN ('PENDING','MATCHED','CONFIRMING','CREDITING','CREDITED','EXPIRED','CANCELLED','ERROR')
  )
);

-- 활성 신청끼리 expected_usdt 중복 금지 (DB 차원 보호)
CREATE UNIQUE INDEX IF NOT EXISTS crypto_charge_active_amount_uniq
  ON public.crypto_charge_requests (expected_usdt_atomic)
  WHERE status IN ('PENDING','MATCHED','CONFIRMING','CREDITING');
CREATE INDEX IF NOT EXISTS crypto_charge_user_idx ON public.crypto_charge_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crypto_charge_status_idx ON public.crypto_charge_requests (status, created_at DESC);

GRANT SELECT ON public.crypto_charge_requests TO authenticated;
GRANT ALL ON public.crypto_charge_requests TO service_role;
ALTER TABLE public.crypto_charge_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own crypto charge select" ON public.crypto_charge_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- ============ 3. chain_deposits ============
CREATE TABLE IF NOT EXISTS public.chain_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid text NOT NULL UNIQUE,
  network text NOT NULL DEFAULT 'TRC20',
  block_number bigint,
  block_timestamp timestamptz,
  from_address text,
  to_address text NOT NULL,
  token_contract text NOT NULL,
  amount_usdt numeric(20,6) NOT NULL,
  amount_atomic bigint NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  confirmations integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DETECTED',
  charge_request_id uuid,
  note text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chain_deposits_status_chk CHECK (
    status IN ('DETECTED','MATCHED','CREDITED','UNMATCHED','EXPIRED_MATCH','DUPLICATE','ERROR')
  )
);
CREATE INDEX IF NOT EXISTS chain_deposits_status_idx ON public.chain_deposits (status, detected_at DESC);
CREATE INDEX IF NOT EXISTS chain_deposits_amount_idx ON public.chain_deposits (amount_atomic);

GRANT SELECT ON public.chain_deposits TO authenticated;
GRANT ALL ON public.chain_deposits TO service_role;
ALTER TABLE public.chain_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin chain deposits select" ON public.chain_deposits
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- updated_at 트리거
CREATE OR REPLACE FUNCTION public.crypto_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS crypto_charge_touch ON public.crypto_charge_requests;
CREATE TRIGGER crypto_charge_touch BEFORE UPDATE ON public.crypto_charge_requests
  FOR EACH ROW EXECUTE FUNCTION public.crypto_touch_updated_at();
DROP TRIGGER IF EXISTS chain_deposits_touch ON public.chain_deposits;
CREATE TRIGGER chain_deposits_touch BEFORE UPDATE ON public.chain_deposits
  FOR EACH ROW EXECUTE FUNCTION public.crypto_touch_updated_at();

-- ============ 4. 설정 helper ============
CREATE OR REPLACE FUNCTION public.crypto_setting_text(_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT value#>>'{}' FROM app_settings WHERE key = _key
$$;

-- ============ 5. 신청 생성 ============
CREATE OR REPLACE FUNCTION public.create_crypto_charge_request(_krw bigint, _rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _enabled boolean; _addr text; _ttl int; _min bigint; _max bigint;
  _base numeric; _atomic bigint; _suffix int; _try int := 0; _id uuid; _exists uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _rate IS NULL OR _rate <= 0 THEN RAISE EXCEPTION '환율 정보가 없습니다.'; END IF;

  _enabled := COALESCE(crypto_setting_text('crypto_charge_enabled')::boolean, false);
  IF NOT _enabled THEN RAISE EXCEPTION 'USDT 자동충전이 현재 중지되어 있습니다.'; END IF;
  _addr := COALESCE(crypto_setting_text('crypto_deposit_address'), '');
  IF _addr = '' THEN RAISE EXCEPTION '입금주소가 설정되지 않았습니다.'; END IF;
  _ttl := COALESCE(crypto_setting_text('crypto_request_ttl_minutes')::int, 30);
  _min := COALESCE(crypto_setting_text('crypto_min_krw')::bigint, 10000);
  _max := COALESCE(crypto_setting_text('crypto_max_krw')::bigint, 5000000);
  IF _krw < _min OR _krw > _max THEN
    RAISE EXCEPTION '충전 금액은 % ~ % 원 사이여야 합니다.', _min, _max;
  END IF;

  -- 만료 정리 후 활성 신청 확인
  UPDATE crypto_charge_requests SET status = 'EXPIRED'
   WHERE user_id = _uid AND status = 'PENDING' AND expires_at < now();

  SELECT id INTO _exists FROM crypto_charge_requests
   WHERE user_id = _uid AND status IN ('PENDING','MATCHED','CONFIRMING','CREDITING')
   ORDER BY created_at DESC LIMIT 1;
  IF _exists IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACTIVE_REQUEST_EXISTS', 'request_id', _exists);
  END IF;

  _base := floor((_krw::numeric / _rate) * 1000)::numeric / 1000;  -- 소수 3자리까지 기본
  LOOP
    _try := _try + 1;
    _suffix := floor(random() * 900 + 100)::int;                    -- 4~6자리 고유 suffix
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
REVOKE ALL ON FUNCTION public.create_crypto_charge_request(bigint, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_crypto_charge_request(bigint, numeric) TO authenticated;

-- ============ 6. 신청 취소 ============
CREATE OR REPLACE FUNCTION public.cancel_my_crypto_charge(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _r crypto_charge_requests;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM crypto_charge_requests WHERE id = _id AND user_id = _uid FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
  IF _r.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_CANCELLABLE', 'status', _r.status);
  END IF;
  UPDATE crypto_charge_requests SET status = 'CANCELLED', cancelled_at = now() WHERE id = _id;
  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.cancel_my_crypto_charge(uuid) TO authenticated;

-- ============ 7. 만료 처리 ============
CREATE OR REPLACE FUNCTION public.expire_crypto_charge_requests()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  UPDATE crypto_charge_requests SET status = 'EXPIRED'
   WHERE status = 'PENDING' AND expires_at < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

-- ============ 8. 자동 지급 (atomic) ============
CREATE OR REPLACE FUNCTION public.credit_crypto_charge(_request_id uuid, _deposit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r crypto_charge_requests; _d chain_deposits; _p profiles;
  _fee_rate numeric; _comm_rate numeric; _points_per_won numeric;
  _fee numeric; _base numeric; _points bigint; _comm numeric := 0; _company numeric;
  _aff affiliates;
BEGIN
  SELECT * INTO _d FROM chain_deposits WHERE id = _deposit_id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'DEPOSIT_NOT_FOUND'; END IF;
  IF _d.status = 'CREDITED' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_CREDITED');
  END IF;
  IF NOT _d.confirmed THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_CONFIRMED'); END IF;

  SELECT * INTO _r FROM crypto_charge_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF _r.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_CREDITED'); END IF;
  IF _r.status NOT IN ('MATCHED','CONFIRMING','CREDITING') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATUS', 'status', _r.status);
  END IF;
  IF _r.expires_at < _d.detected_at THEN
    UPDATE chain_deposits SET status = 'EXPIRED_MATCH', processed_at = now(),
           note = COALESCE(note,'') || ' 만료 후 입금' WHERE id = _d.id;
    RETURN jsonb_build_object('ok', false, 'code', 'REQUEST_EXPIRED');
  END IF;
  IF _r.expected_usdt_atomic <> _d.amount_atomic THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AMOUNT_MISMATCH');
  END IF;
  IF EXISTS (SELECT 1 FROM crypto_charge_requests WHERE txid = _d.txid AND status = 'CREDITED') THEN
    UPDATE chain_deposits SET status = 'DUPLICATE', processed_at = now() WHERE id = _d.id;
    RETURN jsonb_build_object('ok', false, 'code', 'DUPLICATE_TXID');
  END IF;

  SELECT COALESCE((value#>>'{}')::numeric, 0.07) INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
  SELECT COALESCE((value#>>'{}')::numeric, 0.02) INTO _comm_rate FROM app_settings WHERE key = 'affiliate_commission_rate';
  SELECT COALESCE((value#>>'{}')::numeric, 1) INTO _points_per_won FROM app_settings WHERE key = 'points_per_won';
  _fee_rate := COALESCE(_fee_rate, 0.07); _comm_rate := COALESCE(_comm_rate, 0.02);
  _points_per_won := COALESCE(_points_per_won, 1);

  _fee := round(_r.requested_krw * _fee_rate);
  _base := _r.requested_krw - _fee;
  _points := floor(_base * _points_per_won)::bigint;

  SELECT a.* INTO _aff FROM affiliates a
    JOIN profiles pr ON pr.referred_by_affiliate_id = a.id
   WHERE pr.id = _r.user_id AND a.status = 'active';
  _comm := CASE WHEN _aff.id IS NULL THEN 0 ELSE round(_r.requested_krw * _comm_rate) END;
  _company := _fee - _comm;

  SELECT * INTO _p FROM profiles WHERE id = _r.user_id FOR UPDATE;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;

  UPDATE profiles
     SET game_points = game_points + _points,
         total_charge_amount = total_charge_amount + _r.requested_krw,
         total_charge_count = total_charge_count + 1
   WHERE id = _r.user_id;

  INSERT INTO point_transactions
    (user_id, type, amount, balance_before, balance_after, locked_before, locked_after,
     reference_type, reference_id, memo)
  VALUES (_r.user_id, 'crypto_charge', _points, _p.game_points, _p.game_points + _points,
          _p.locked_points, _p.locked_points, 'crypto_charge_request', _r.id,
          format('USDT 자동충전 %s원 · %s USDT · TXID %s', _r.requested_krw, _d.amount_usdt, _d.txid));

  IF _aff.id IS NOT NULL AND _comm > 0 THEN
    INSERT INTO affiliate_commissions
      (affiliate_id, member_user_id, base_amount, commission_amount, commission_rate, status)
    VALUES (_aff.id, _r.user_id, _r.requested_krw, _comm, _comm_rate, 'PENDING');
  END IF;

  UPDATE crypto_charge_requests
     SET status = 'CREDITED', txid = _d.txid, chain_deposit_id = _d.id,
         credited_points = _points, fee_amount = _fee, affiliate_commission = _comm,
         company_fee = _company, affiliate_id = _aff.id,
         confirmed_at = COALESCE(confirmed_at, now()), credited_at = now()
   WHERE id = _r.id;

  UPDATE chain_deposits SET status = 'CREDITED', charge_request_id = _r.id, processed_at = now()
   WHERE id = _d.id;

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (_r.user_id, 'CRYPTO_CHARGE', 'USDT 충전이 완료되었습니다.',
          format('+%sP 지급 완료 (신청 %s원)', _points, _r.requested_krw));

  PERFORM evaluate_member_rank(_r.user_id);

  RETURN jsonb_build_object('ok', true, 'points', _points, 'commission', _comm,
                            'company_fee', _company, 'txid', _d.txid);
END; $$;
REVOKE ALL ON FUNCTION public.credit_crypto_charge(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_crypto_charge(uuid, uuid) TO service_role;

-- ============ 9. watcher 입금 기록 + 자동 매칭 ============
CREATE OR REPLACE FUNCTION public.ingest_chain_deposit(
  _txid text, _to_address text, _from_address text, _token_contract text,
  _amount_atomic bigint, _confirmations integer, _block_number bigint,
  _block_timestamp timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _expected_addr text; _contract text; _req_conf int;
  _d chain_deposits; _r crypto_charge_requests; _match_count int; _confirmed boolean;
BEGIN
  _expected_addr := COALESCE(crypto_setting_text('crypto_deposit_address'), '');
  _contract := COALESCE(crypto_setting_text('crypto_usdt_contract'), '');
  _req_conf := COALESCE(crypto_setting_text('crypto_required_confirmations')::int, 19);
  _confirmed := _confirmations >= _req_conf;

  IF _expected_addr = '' OR lower(_to_address) <> lower(_expected_addr) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WRONG_TO_ADDRESS');
  END IF;
  IF _contract = '' OR lower(_token_contract) <> lower(_contract) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'WRONG_TOKEN');
  END IF;

  INSERT INTO chain_deposits
    (txid, to_address, from_address, token_contract, amount_usdt, amount_atomic,
     confirmations, confirmed, block_number, block_timestamp, status)
  VALUES (_txid, _to_address, _from_address, _token_contract,
          (_amount_atomic::numeric / 1000000), _amount_atomic,
          _confirmations, _confirmed, _block_number, _block_timestamp, 'DETECTED')
  ON CONFLICT (txid) DO UPDATE
     SET confirmations = GREATEST(chain_deposits.confirmations, EXCLUDED.confirmations),
         confirmed = chain_deposits.confirmed OR EXCLUDED.confirmed,
         block_number = COALESCE(EXCLUDED.block_number, chain_deposits.block_number)
  RETURNING * INTO _d;

  IF _d.status = 'CREDITED' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_CREDITED', 'deposit_id', _d.id);
  END IF;

  PERFORM expire_crypto_charge_requests();

  SELECT count(*) INTO _match_count FROM crypto_charge_requests
   WHERE expected_usdt_atomic = _d.amount_atomic
     AND status IN ('PENDING','MATCHED','CONFIRMING','CREDITING')
     AND expires_at >= _d.detected_at;

  IF _match_count <> 1 THEN
    UPDATE chain_deposits SET status = 'UNMATCHED', processed_at = now() WHERE id = _d.id;
    RETURN jsonb_build_object('ok', true, 'code', 'UNMATCHED', 'deposit_id', _d.id);
  END IF;

  SELECT * INTO _r FROM crypto_charge_requests
   WHERE expected_usdt_atomic = _d.amount_atomic
     AND status IN ('PENDING','MATCHED','CONFIRMING','CREDITING')
     AND expires_at >= _d.detected_at
   FOR UPDATE;

  UPDATE crypto_charge_requests
     SET status = CASE WHEN _d.confirmed THEN 'CREDITING' ELSE 'CONFIRMING' END,
         txid = _d.txid, chain_deposit_id = _d.id,
         matched_at = COALESCE(matched_at, now())
   WHERE id = _r.id;
  UPDATE chain_deposits SET status = 'MATCHED', charge_request_id = _r.id WHERE id = _d.id;

  IF _d.confirmed THEN
    RETURN credit_crypto_charge(_r.id, _d.id) || jsonb_build_object('deposit_id', _d.id, 'request_id', _r.id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'CONFIRMING', 'deposit_id', _d.id, 'request_id', _r.id);
END; $$;
REVOKE ALL ON FUNCTION public.ingest_chain_deposit(text, text, text, text, bigint, integer, bigint, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_chain_deposit(text, text, text, text, bigint, integer, bigint, timestamptz) TO service_role;

-- ============ 10. 관리자 포인트 지급/회수 (방향 + 사유 + 중복방지) ============
CREATE OR REPLACE FUNCTION public.admin_adjust_points_v2(
  _user_id uuid, _direction text, _amount bigint, _reason text, _request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _p profiles; _delta bigint; _exists uuid;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _direction NOT IN ('ADD','REMOVE') THEN RAISE EXCEPTION '지급 또는 회수만 가능합니다.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION '금액을 확인해 주세요.'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 2 THEN RAISE EXCEPTION '처리 사유를 입력해 주세요.'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION '요청 식별자가 필요합니다.'; END IF;
  IF _amount > 1000000 AND NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION '100만P를 초과하는 조정은 최고관리자만 가능합니다.';
  END IF;

  -- 중복 요청(더블클릭) 방지
  SELECT id INTO _exists FROM point_transactions
   WHERE reference_type = 'admin_point_request' AND reference_id = _request_id;
  IF _exists IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_APPLIED');
  END IF;

  _delta := CASE WHEN _direction = 'ADD' THEN _amount ELSE -_amount END;

  SELECT * INTO _p FROM profiles WHERE id = _user_id FOR UPDATE;
  IF _p.id IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  IF _p.game_points + _delta < 0 THEN RAISE EXCEPTION '보유 포인트보다 많이 회수할 수 없습니다.'; END IF;

  UPDATE profiles SET game_points = game_points + _delta WHERE id = _user_id;

  INSERT INTO point_transactions
    (user_id, type, amount, balance_before, balance_after, locked_before, locked_after,
     reference_type, reference_id, admin_id, memo)
  VALUES (_user_id, CASE WHEN _direction = 'ADD' THEN 'ADMIN_ADD' ELSE 'ADMIN_REMOVE' END,
          _delta, _p.game_points, _p.game_points + _delta, _p.locked_points, _p.locked_points,
          'admin_point_request', _request_id, _uid, _reason);

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, CASE WHEN _direction = 'ADD' THEN 'POINT_ADD' ELSE 'POINT_REMOVE' END,
          'profile', _user_id,
          jsonb_build_object('amount', _amount, 'direction', _direction,
                             'balance_before', _p.game_points,
                             'balance_after', _p.game_points + _delta,
                             'request_id', _request_id),
          _reason);

  RETURN jsonb_build_object('ok', true, 'balance_after', _p.game_points + _delta);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_points_v2(uuid, text, bigint, text, uuid) TO authenticated;

-- ============ 11. 관리자 자동충전 조회/설정 ============
CREATE OR REPLACE FUNCTION public.admin_crypto_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  RETURN jsonb_build_object(
    'enabled', COALESCE(crypto_setting_text('crypto_charge_enabled')::boolean, false),
    'deposit_address', crypto_setting_text('crypto_deposit_address'),
    'usdt_contract', crypto_setting_text('crypto_usdt_contract'),
    'required_confirmations', crypto_setting_text('crypto_required_confirmations'),
    'ttl_minutes', crypto_setting_text('crypto_request_ttl_minutes'),
    'sheet_id', crypto_setting_text('crypto_rate_sheet_id'),
    'sheet_gid', crypto_setting_text('crypto_rate_sheet_gid'),
    'rate_cell', crypto_setting_text('crypto_rate_cell'),
    'rate_cache', crypto_setting_text('crypto_rate_cache'),
    'rate_cached_at', crypto_setting_text('crypto_rate_cached_at'),
    'rate_error', crypto_setting_text('crypto_rate_error'),
    'watcher_last_run', crypto_setting_text('crypto_watcher_last_run'),
    'watcher_last_cursor', crypto_setting_text('crypto_watcher_last_cursor'),
    'watcher_last_error', crypto_setting_text('crypto_watcher_last_error'),
    'pending', (SELECT count(*) FROM crypto_charge_requests WHERE status = 'PENDING'),
    'confirming', (SELECT count(*) FROM crypto_charge_requests WHERE status IN ('MATCHED','CONFIRMING','CREDITING')),
    'credited_today', (SELECT count(*) FROM crypto_charge_requests WHERE status = 'CREDITED' AND credited_at::date = current_date),
    'credited_today_krw', (SELECT COALESCE(sum(requested_krw),0) FROM crypto_charge_requests WHERE status = 'CREDITED' AND credited_at::date = current_date),
    'unmatched', (SELECT count(*) FROM chain_deposits WHERE status IN ('UNMATCHED','EXPIRED_MATCH'))
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_crypto_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_crypto_settings(_patch jsonb, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _k text; _allowed text[] := ARRAY[
  'crypto_charge_enabled','crypto_deposit_address','crypto_usdt_contract',
  'crypto_required_confirmations','crypto_request_ttl_minutes','crypto_watcher_interval_seconds',
  'crypto_rate_sheet_id','crypto_rate_sheet_gid','crypto_rate_cell','crypto_min_krw','crypto_max_krw'];
BEGIN
  IF NOT public.is_super_admin(_uid) THEN RAISE EXCEPTION '최고관리자만 변경할 수 있습니다.'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 2 THEN RAISE EXCEPTION '변경 사유를 입력해 주세요.'; END IF;
  FOR _k IN SELECT jsonb_object_keys(_patch) LOOP
    IF NOT (_k = ANY(_allowed)) THEN RAISE EXCEPTION '허용되지 않은 설정입니다: %', _k; END IF;
    INSERT INTO app_settings (key, value, updated_at) VALUES (_k, _patch -> _k, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END LOOP;
  INSERT INTO admin_logs (admin_id, action, target_type, metadata, reason)
  VALUES (_uid, 'CRYPTO_SETTINGS_UPDATED', 'app_settings', _patch, _reason);
  RETURN jsonb_build_object('ok', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_update_crypto_settings(jsonb, text) TO authenticated;