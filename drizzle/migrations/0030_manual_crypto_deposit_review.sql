-- 0030 자동입금 미매칭 건 수동 승인/취소
ALTER TABLE public.crypto_charge_requests
  ADD COLUMN IF NOT EXISTS manual_action text,
  ADD COLUMN IF NOT EXISTS manual_reason text,
  ADD COLUMN IF NOT EXISTS manual_admin_id uuid,
  ADD COLUMN IF NOT EXISTS manual_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_usdt numeric,
  ADD COLUMN IF NOT EXISTS credited_krw bigint;

CREATE OR REPLACE FUNCTION public.credit_crypto_charge(
  _request_id uuid,
  _deposit_id uuid,
  _allow_amount_mismatch boolean DEFAULT false,
  _override_krw bigint DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r crypto_charge_requests; _d chain_deposits; _p profiles;
  _fee_rate numeric; _comm_rate numeric; _points_per_won numeric;
  _fee numeric; _base numeric; _points bigint; _comm numeric := 0; _company numeric;
  _aff affiliates; _rebate_pct numeric := 0; _base_krw bigint;
BEGIN
  SELECT * INTO _d FROM chain_deposits WHERE id = _deposit_id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'DEPOSIT_NOT_FOUND'; END IF;
  IF _d.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_CREDITED'); END IF;
  IF NOT _d.confirmed THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_CONFIRMED'); END IF;

  SELECT * INTO _r FROM crypto_charge_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF _r.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_CREDITED'); END IF;
  IF _r.status NOT IN ('MATCHED','CONFIRMING','CREDITING') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATUS', 'status', _r.status);
  END IF;
  IF NOT _allow_amount_mismatch AND _r.expires_at < _d.detected_at THEN
    UPDATE chain_deposits SET status = 'EXPIRED_MATCH', processed_at = now(),
           note = COALESCE(note,'') || ' 만료 후 입금' WHERE id = _d.id;
    RETURN jsonb_build_object('ok', false, 'code', 'REQUEST_EXPIRED');
  END IF;
  IF NOT _allow_amount_mismatch AND _r.expected_usdt_atomic <> _d.amount_atomic THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AMOUNT_MISMATCH');
  END IF;
  IF EXISTS (SELECT 1 FROM crypto_charge_requests WHERE txid = _d.txid AND status = 'CREDITED') THEN
    UPDATE chain_deposits SET status = 'DUPLICATE', processed_at = now() WHERE id = _d.id;
    RETURN jsonb_build_object('ok', false, 'code', 'DUPLICATE_TXID');
  END IF;

  SELECT COALESCE((value#>>'{}')::numeric, 0.07) INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
  SELECT COALESCE((value#>>'{}')::numeric, 1) INTO _points_per_won FROM app_settings WHERE key = 'points_per_won';
  _fee_rate := COALESCE(_fee_rate, 0.07);
  _points_per_won := COALESCE(_points_per_won, 1);

  _base_krw := COALESCE(_override_krw, _r.requested_krw);
  IF _base_krw <= 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT'); END IF;

  _fee := round(_base_krw * _fee_rate);
  _base := _base_krw - _fee;
  _points := floor(_base * _points_per_won)::bigint;

  SELECT a.* INTO _aff FROM affiliates a
    JOIN profiles pr ON pr.referred_by_affiliate_id = a.id
   WHERE pr.id = _r.user_id AND a.status = 'active';

  _rebate_pct := CASE WHEN _aff.id IS NULL THEN 0 ELSE COALESCE(_aff.rebate_rate, 2.00) END;
  _comm_rate := _rebate_pct / 100.0;
  _comm := CASE WHEN _aff.id IS NULL THEN 0 ELSE round(_base_krw * _comm_rate) END;
  IF _comm > _fee THEN _comm := _fee; END IF;
  _company := _fee - _comm;

  SELECT * INTO _p FROM profiles WHERE id = _r.user_id FOR UPDATE;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;

  UPDATE profiles SET game_points = game_points + _points WHERE id = _r.user_id;

  INSERT INTO point_transactions
    (user_id, type, amount, balance_before, balance_after, locked_before, locked_after,
     reference_type, reference_id, memo)
  VALUES (_r.user_id, 'crypto_charge', _points, _p.game_points, _p.game_points + _points,
          _p.locked_points, _p.locked_points, 'crypto_charge_request', _r.id,
          format('USDT %s충전 %s원 · %s USDT · TXID %s',
                 CASE WHEN _override_krw IS NULL THEN '자동' ELSE '수동승인 ' END,
                 _base_krw, _d.amount_usdt, _d.txid));

  IF _aff.id IS NOT NULL AND _comm > 0 THEN
    INSERT INTO affiliate_commissions
      (affiliate_id, member_user_id, base_amount, commission_amount, commission_rate, applied_rebate_rate, status)
    VALUES (_aff.id, _r.user_id, _base_krw, _comm, _comm_rate, _rebate_pct, 'PENDING');
  END IF;

  UPDATE crypto_charge_requests
     SET status = 'CREDITED', txid = _d.txid, chain_deposit_id = _d.id,
         credited_points = _points, fee_amount = _fee, affiliate_commission = _comm,
         company_fee = _company, affiliate_id = _aff.id,
         actual_usdt = _d.amount_usdt, credited_krw = _base_krw,
         confirmed_at = COALESCE(confirmed_at, now()), credited_at = now()
   WHERE id = _r.id;

  UPDATE chain_deposits SET status = 'CREDITED', charge_request_id = _r.id, processed_at = now()
   WHERE id = _d.id;

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (_r.user_id, 'CRYPTO_CHARGE', 'USDT 충전이 완료되었습니다.',
          format('+%sP 지급 완료 (기준 %s원)', _points, _base_krw));

  PERFORM evaluate_member_rank(_r.user_id);

  RETURN jsonb_build_object('ok', true, 'points', _points, 'commission', _comm,
                            'company_fee', _company, 'txid', _d.txid, 'base_krw', _base_krw);
END; $function$;

REVOKE ALL ON FUNCTION public.credit_crypto_charge(uuid, uuid, boolean, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_crypto_charge(uuid, uuid, boolean, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.credit_crypto_charge(uuid, uuid, boolean, bigint) FROM authenticated;

CREATE OR REPLACE FUNCTION public.ingest_chain_deposit(_txid text, _to_address text, _from_address text, _token_contract text, _amount_atomic bigint, _confirmations integer, _block_number bigint, _block_timestamp timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _expected_addr text; _contract text; _req_conf int;
  _d chain_deposits; _r crypto_charge_requests; _match_count int; _confirmed boolean;
  _cand_id uuid; _cand_count int;
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

  IF _d.status IN ('CREDITED','CANCELLED','DUPLICATE') THEN
    RETURN jsonb_build_object('ok', true, 'code', 'SKIP_' || _d.status, 'deposit_id', _d.id);
  END IF;
  IF EXISTS (SELECT 1 FROM crypto_charge_requests WHERE txid = _d.txid AND status = 'CREDITED') THEN
    UPDATE chain_deposits SET status = 'DUPLICATE', processed_at = now() WHERE id = _d.id;
    RETURN jsonb_build_object('ok', true, 'code', 'DUPLICATE_TXID', 'deposit_id', _d.id);
  END IF;

  PERFORM expire_crypto_charge_requests();

  SELECT count(*) INTO _match_count FROM crypto_charge_requests
   WHERE expected_usdt_atomic = _d.amount_atomic
     AND status IN ('PENDING','MATCHED','CONFIRMING','CREDITING')
     AND expires_at >= _d.detected_at;

  IF _match_count <> 1 THEN
    UPDATE chain_deposits SET status = 'UNMATCHED', processed_at = now() WHERE id = _d.id;

    SELECT count(*), min(id) INTO _cand_count, _cand_id
      FROM crypto_charge_requests
     WHERE status IN ('PENDING','EXPIRED')
       AND created_at >= _d.detected_at - interval '24 hours'
       AND abs(expected_usdt_atomic - _d.amount_atomic) <= greatest(_d.amount_atomic * 0.05, 1000);
    IF _cand_count = 1 THEN
      UPDATE chain_deposits SET charge_request_id = _cand_id,
             note = COALESCE(note,'') || ' 수량 불일치 후보 연결' WHERE id = _d.id;
      UPDATE crypto_charge_requests SET status = 'REVIEW'
       WHERE id = _cand_id AND status IN ('PENDING','EXPIRED');
    END IF;

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
END; $function$;

REVOKE ALL ON FUNCTION public.ingest_chain_deposit(text, text, text, text, bigint, integer, bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_chain_deposit(text, text, text, text, bigint, integer, bigint, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.ingest_chain_deposit(text, text, text, text, bigint, integer, bigint, timestamptz) FROM authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_crypto_unmatched(_status text DEFAULT 'UNMATCHED', _limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rows jsonb; _fee_rate numeric; _ppw numeric; _rate_cache numeric;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE((value#>>'{}')::numeric, 0.07) INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
  SELECT COALESCE((value#>>'{}')::numeric, 1) INTO _ppw FROM app_settings WHERE key = 'points_per_won';
  SELECT COALESCE((value#>>'{}')::numeric, 0) INTO _rate_cache FROM app_settings WHERE key = 'crypto_rate_cache';
  _fee_rate := COALESCE(_fee_rate, 0.07); _ppw := COALESCE(_ppw, 1);

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'detected_at') DESC), '[]'::jsonb) INTO _rows
  FROM (
    SELECT jsonb_build_object(
      'deposit_id', d.id,
      'txid', d.txid,
      'from_address', d.from_address,
      'to_address', d.to_address,
      'actual_usdt', d.amount_usdt,
      'confirmations', d.confirmations,
      'confirmed', d.confirmed,
      'deposit_status', d.status,
      'detected_at', d.detected_at,
      'note', d.note,
      'request_id', r.id,
      'user_id', r.user_id,
      'nickname', p.nickname,
      'username', p.username,
      'requested_krw', r.requested_krw,
      'requested_usdt', r.expected_usdt,
      'rate_krw_per_usdt', COALESCE(r.rate_krw_per_usdt, NULLIF(_rate_cache, 0)),
      'request_status', r.status,
      'requested_at', r.created_at,
      'expires_at', r.expires_at,
      'manual_action', r.manual_action,
      'manual_reason', r.manual_reason,
      'diff_usdt', CASE WHEN r.id IS NULL THEN NULL ELSE d.amount_usdt - r.expected_usdt END,
      'settle_krw', CASE WHEN COALESCE(r.rate_krw_per_usdt, NULLIF(_rate_cache, 0)) IS NULL THEN NULL
                         ELSE round(d.amount_usdt * COALESCE(r.rate_krw_per_usdt, _rate_cache)) END,
      'fee_rate', _fee_rate,
      'est_fee', CASE WHEN COALESCE(r.rate_krw_per_usdt, NULLIF(_rate_cache, 0)) IS NULL THEN NULL
                      ELSE round(round(d.amount_usdt * COALESCE(r.rate_krw_per_usdt, _rate_cache)) * _fee_rate) END,
      'est_points', CASE WHEN COALESCE(r.rate_krw_per_usdt, NULLIF(_rate_cache, 0)) IS NULL THEN NULL
                         ELSE floor((round(d.amount_usdt * COALESCE(r.rate_krw_per_usdt, _rate_cache))
                              - round(round(d.amount_usdt * COALESCE(r.rate_krw_per_usdt, _rate_cache)) * _fee_rate)) * _ppw) END
    ) AS x
    FROM chain_deposits d
    LEFT JOIN crypto_charge_requests r ON r.id = d.charge_request_id
    LEFT JOIN profiles p ON p.id = r.user_id
    WHERE (_status = 'ALL' OR d.status = _status)
    ORDER BY d.detected_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 200))
  ) s;
  RETURN _rows;
END; $function$;

REVOKE ALL ON FUNCTION public.admin_list_crypto_unmatched(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_crypto_unmatched(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_crypto_unmatched(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_manual_credit_crypto_deposit(
  _deposit_id uuid,
  _request_id uuid,
  _reason text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _admin uuid := auth.uid(); _d chain_deposits; _r crypto_charge_requests;
  _krw bigint; _res jsonb; _prev text;
BEGIN
  IF NOT is_admin(_admin) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 2 THEN RAISE EXCEPTION '처리 사유를 입력해 주세요.'; END IF;

  SELECT * INTO _d FROM chain_deposits WHERE id = _deposit_id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION '입금 기록을 찾을 수 없습니다.'; END IF;
  IF _d.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CREDITED'); END IF;
  IF _d.status IN ('CANCELLED','DUPLICATE') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DEPOSIT_' || _d.status);
  END IF;
  IF NOT _d.confirmed THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_CONFIRMED'); END IF;

  SELECT * INTO _r FROM crypto_charge_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '충전 신청을 찾을 수 없습니다.'; END IF;
  IF _r.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CREDITED'); END IF;
  IF _r.status = 'CANCELLED' THEN RETURN jsonb_build_object('ok', false, 'code', 'REQUEST_CANCELLED'); END IF;
  IF _r.status NOT IN ('PENDING','REVIEW','MATCHED','CONFIRMING','CREDITING','EXPIRED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATUS', 'status', _r.status);
  END IF;
  IF EXISTS (SELECT 1 FROM crypto_charge_requests WHERE txid = _d.txid AND status = 'CREDITED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DUPLICATE_TXID');
  END IF;
  IF _r.rate_krw_per_usdt IS NULL OR _r.rate_krw_per_usdt <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_MISSING');
  END IF;

  _prev := _r.status;
  _krw := round(_d.amount_usdt * _r.rate_krw_per_usdt)::bigint;

  UPDATE crypto_charge_requests
     SET status = 'CREDITING', txid = _d.txid, chain_deposit_id = _d.id,
         matched_at = COALESCE(matched_at, now())
   WHERE id = _r.id;
  UPDATE chain_deposits SET charge_request_id = _r.id WHERE id = _d.id;

  _res := credit_crypto_charge(_r.id, _d.id, true, _krw);

  IF COALESCE((_res->>'ok')::boolean, false) THEN
    UPDATE crypto_charge_requests
       SET manual_action = 'MANUAL_APPROVED', manual_reason = btrim(_reason),
           manual_admin_id = _admin, manual_at = now()
     WHERE id = _r.id;
    UPDATE chain_deposits
       SET note = COALESCE(note,'') || ' 수동승인: ' || btrim(_reason) WHERE id = _d.id;

    PERFORM admin_log_event('CRYPTO_MANUAL_APPROVE', jsonb_build_object(
      'request_id', _r.id, 'deposit_id', _d.id, 'user_id', _r.user_id,
      'txid', _d.txid, 'requested_usdt', _r.expected_usdt, 'actual_usdt', _d.amount_usdt,
      'settle_krw', _krw, 'points', _res->'points', 'reason', btrim(_reason)));
  ELSE
    UPDATE crypto_charge_requests SET status = _prev WHERE id = _r.id;
  END IF;

  RETURN _res || jsonb_build_object('settle_krw', _krw);
END; $function$;

REVOKE ALL ON FUNCTION public.admin_manual_credit_crypto_deposit(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_manual_credit_crypto_deposit(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_manual_credit_crypto_deposit(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_crypto_deposit(
  _deposit_id uuid,
  _request_id uuid,
  _reason text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _admin uuid := auth.uid(); _d chain_deposits; _r crypto_charge_requests;
BEGIN
  IF NOT is_admin(_admin) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 2 THEN RAISE EXCEPTION '처리 사유를 입력해 주세요.'; END IF;

  IF _deposit_id IS NOT NULL THEN
    SELECT * INTO _d FROM chain_deposits WHERE id = _deposit_id FOR UPDATE;
    IF _d.id IS NULL THEN RAISE EXCEPTION '입금 기록을 찾을 수 없습니다.'; END IF;
    IF _d.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CREDITED'); END IF;
  END IF;

  IF _request_id IS NOT NULL THEN
    SELECT * INTO _r FROM crypto_charge_requests WHERE id = _request_id FOR UPDATE;
    IF _r.id IS NULL THEN RAISE EXCEPTION '충전 신청을 찾을 수 없습니다.'; END IF;
    IF _r.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CREDITED'); END IF;
    IF _r.status = 'CANCELLED' THEN RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_CANCELLED'); END IF;
    UPDATE crypto_charge_requests
       SET status = 'CANCELLED', cancelled_at = now(),
           manual_action = 'MANUAL_CANCELLED', manual_reason = btrim(_reason),
           manual_admin_id = _admin, manual_at = now()
     WHERE id = _r.id;
  END IF;

  IF _d.id IS NOT NULL THEN
    UPDATE chain_deposits
       SET status = 'CANCELLED', processed_at = now(),
           note = COALESCE(note,'') || ' 수동취소: ' || btrim(_reason)
     WHERE id = _d.id;
  END IF;

  PERFORM admin_log_event('CRYPTO_MANUAL_CANCEL', jsonb_build_object(
    'request_id', _request_id, 'deposit_id', _deposit_id,
    'user_id', _r.user_id, 'txid', _d.txid,
    'requested_usdt', _r.expected_usdt, 'actual_usdt', _d.amount_usdt,
    'reason', btrim(_reason)));

  RETURN jsonb_build_object('ok', true);
END; $function$;

REVOKE ALL ON FUNCTION public.admin_cancel_crypto_deposit(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_crypto_deposit(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_crypto_deposit(uuid, uuid, text) TO authenticated;
