-- 수동 승인/취소 감사 로그를 프로젝트 표준 admin_logs 직접 기록 방식으로 교정
CREATE OR REPLACE FUNCTION public.admin_manual_credit_crypto_deposit(_deposit_id uuid, _request_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

    INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (_admin, 'crypto_manual_approve', 'crypto_charge_request', _r.id,
            jsonb_build_object('request_id', _r.id, 'deposit_id', _d.id, 'user_id', _r.user_id,
              'txid', _d.txid, 'requested_usdt', _r.expected_usdt, 'actual_usdt', _d.amount_usdt,
              'settle_krw', _krw, 'points', _res->'points', 'reason', btrim(_reason)));
  ELSE
    UPDATE crypto_charge_requests SET status = _prev WHERE id = _r.id;
  END IF;

  RETURN _res || jsonb_build_object('settle_krw', _krw);
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_crypto_deposit(_deposit_id uuid, _request_id uuid, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_admin, 'crypto_manual_cancel', 'crypto_charge_request', COALESCE(_request_id, _deposit_id),
          jsonb_build_object('request_id', _request_id, 'deposit_id', _deposit_id,
            'user_id', _r.user_id, 'txid', _d.txid,
            'requested_usdt', _r.expected_usdt, 'actual_usdt', _d.amount_usdt,
            'reason', btrim(_reason)));

  RETURN jsonb_build_object('ok', true);
END; $function$;

REVOKE ALL ON FUNCTION public.admin_manual_credit_crypto_deposit(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_crypto_deposit(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manual_credit_crypto_deposit(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_crypto_deposit(uuid, uuid, text) TO authenticated;
