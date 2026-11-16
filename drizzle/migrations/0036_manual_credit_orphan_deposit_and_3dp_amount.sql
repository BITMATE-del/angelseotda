-- 1) 신청 없는 실제 입금을 관리자가 회원에게 연결해 수동 승인하는 경로
--    지급 계산/원장 기록은 기존 credit_crypto_charge 를 그대로 재사용한다.

CREATE OR REPLACE FUNCTION public.admin_search_members(_q text, _limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _rows jsonb; _t text := btrim(COALESCE(_q, ''));
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF length(_t) < 2 THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'username'), '[]'::jsonb) INTO _rows
  FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'username', p.username, 'nickname', p.nickname,
      'game_points', p.game_points, 'status', p.status
    ) AS x
    FROM profiles p
    WHERE p.username ILIKE '%' || _t || '%'
       OR p.nickname ILIKE '%' || _t || '%'
       OR p.id::text = _t
    ORDER BY p.username
    LIMIT GREATEST(1, LEAST(_limit, 50))
  ) s;
  RETURN _rows;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_manual_credit_orphan_deposit(
  _deposit_id uuid, _user_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _admin uuid := auth.uid(); _d chain_deposits; _rate numeric; _krw bigint;
  _req uuid; _res jsonb;
BEGIN
  IF NOT is_admin(_admin) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 2 THEN RAISE EXCEPTION '처리 사유를 입력해 주세요.'; END IF;
  IF _user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'USER_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_NOT_FOUND');
  END IF;

  SELECT * INTO _d FROM chain_deposits WHERE id = _deposit_id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION '입금 기록을 찾을 수 없습니다.'; END IF;
  IF _d.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CREDITED'); END IF;
  IF _d.status IN ('CANCELLED','DUPLICATE') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DEPOSIT_' || _d.status);
  END IF;
  IF NOT _d.confirmed THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_CONFIRMED'); END IF;
  IF _d.charge_request_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'REQUEST_LINKED', 'request_id', _d.charge_request_id);
  END IF;
  IF COALESCE(_d.amount_usdt, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT');
  END IF;
  -- 동일 TXID 는 어떤 경로로도 1회만 지급된다.
  IF EXISTS (SELECT 1 FROM crypto_charge_requests WHERE txid = _d.txid AND status = 'CREDITED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DUPLICATE_TXID');
  END IF;

  SELECT COALESCE((value#>>'{}')::numeric, 0) INTO _rate FROM app_settings WHERE key = 'crypto_rate_cache';
  IF COALESCE(_rate, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'RATE_MISSING'); END IF;

  -- 지급 기준: 실제 감지된 입금 수량 × 적용 환율 (관리자 임의 입력 없음)
  _krw := round(_d.amount_usdt * _rate)::bigint;
  IF _krw <= 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT'); END IF;

  INSERT INTO crypto_charge_requests
    (user_id, requested_krw, rate_krw_per_usdt, requested_usdt, expected_usdt,
     expected_usdt_atomic, wallet_address, status, txid, chain_deposit_id,
     expires_at, matched_at, manual_action, manual_reason, manual_admin_id, manual_at)
  VALUES (_user_id, _krw, _rate, _d.amount_usdt, _d.amount_usdt,
          _d.amount_atomic, _d.to_address, 'CREDITING', _d.txid, _d.id,
          now(), now(), 'MANUAL_LINKED', btrim(_reason), _admin, now())
  RETURNING id INTO _req;

  UPDATE chain_deposits SET charge_request_id = _req WHERE id = _d.id;

  _res := credit_crypto_charge(_req, _d.id, true, _krw);

  IF COALESCE((_res->>'ok')::boolean, false) THEN
    UPDATE crypto_charge_requests
       SET manual_action = 'MANUAL_APPROVED', manual_reason = btrim(_reason),
           manual_admin_id = _admin, manual_at = now()
     WHERE id = _req;
    UPDATE chain_deposits
       SET note = COALESCE(note,'') || ' 수동승인(회원연결): ' || btrim(_reason) WHERE id = _d.id;

    INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (_admin, 'crypto_manual_approve_orphan', 'crypto_charge_request', _req,
            jsonb_build_object('request_id', _req, 'deposit_id', _d.id, 'user_id', _user_id,
              'txid', _d.txid, 'actual_usdt', _d.amount_usdt, 'to_address', _d.to_address,
              'settle_krw', _krw, 'rate_krw_per_usdt', _rate,
              'points', _res->'points', 'reason', btrim(_reason)));
  ELSE
    -- 실패 시 임시 생성한 신청/연결을 되돌린다.
    UPDATE chain_deposits SET charge_request_id = NULL WHERE id = _d.id;
    DELETE FROM crypto_charge_requests WHERE id = _req AND status <> 'CREDITED';
  END IF;

  RETURN _res || jsonb_build_object('settle_krw', _krw);
END; $function$;

REVOKE ALL ON FUNCTION public.admin_search_members(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_manual_credit_orphan_deposit(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_members(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manual_credit_orphan_deposit(uuid, uuid, text) TO authenticated;

-- 2) 자동충전 송금 금액을 소수점 3자리로 생성 (고유 식별 자리수는 0.001 단위 유지)
CREATE OR REPLACE FUNCTION public.create_crypto_charge_request(_krw bigint, _rate numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- 0.01 단위 기본 금액 + 0.001~0.009 고유 식별 → 표시/송금 모두 소수점 3자리
  _base := floor((_krw::numeric / _rate) * 100)::numeric / 100;
  LOOP
    _try := _try + 1;
    _suffix := floor(random() * 999 + 1)::int;   -- 0.001 ~ 0.999
    _atomic := (round(_base * 1000000))::bigint + (_suffix * 1000);
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
END; $function$;