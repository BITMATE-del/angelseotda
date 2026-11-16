-- 미매칭 후보 조회에서 uuid 집계 오류 수정 (로직 동일, 집계 방식만 교정)
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

    SELECT count(*) INTO _cand_count
      FROM crypto_charge_requests
     WHERE status IN ('PENDING','EXPIRED')
       AND created_at >= _d.detected_at - interval '24 hours'
       AND abs(expected_usdt_atomic - _d.amount_atomic) <= greatest(_d.amount_atomic * 0.05, 1000);
    IF _cand_count = 1 THEN
      SELECT id INTO _cand_id
        FROM crypto_charge_requests
       WHERE status IN ('PENDING','EXPIRED')
         AND created_at >= _d.detected_at - interval '24 hours'
         AND abs(expected_usdt_atomic - _d.amount_atomic) <= greatest(_d.amount_atomic * 0.05, 1000)
       LIMIT 1;
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
