CREATE OR REPLACE FUNCTION public.evaluate_member_rank(_user_id uuid)
RETURNS app_rank LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _p profiles; _amt numeric; _cnt integer; _att integer; _cur int; _req rank_requirements; _items jsonb;
  _amt2 numeric; _cnt2 integer;
BEGIN
  SELECT * INTO _p FROM profiles WHERE id = _user_id FOR UPDATE;
  IF _p.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(requested_amount),0), COUNT(*)::int INTO _amt, _cnt
    FROM charge_requests WHERE user_id = _user_id AND status = 'APPROVED';
  SELECT COALESCE(SUM(requested_krw),0), COUNT(*)::int INTO _amt2, _cnt2
    FROM crypto_charge_requests WHERE user_id = _user_id AND status = 'CREDITED';
  _amt := _amt + COALESCE(_amt2, 0);
  _cnt := _cnt + COALESCE(_cnt2, 0);

  SELECT COUNT(*)::int INTO _att FROM user_attendance WHERE user_id = _user_id;

  UPDATE profiles SET total_charge_amount = _amt, total_charge_count = _cnt, attendance_count = _att
   WHERE id = _user_id;

  SELECT sort_order INTO _cur FROM rank_requirements WHERE rank = _p.rank;
  LOOP
    SELECT * INTO _req FROM rank_requirements WHERE sort_order = _cur + 1;
    EXIT WHEN _req.rank IS NULL;
    EXIT WHEN _amt < _req.min_charge_amount OR _cnt < _req.min_charge_count OR _att < _req.min_attendance;

    INSERT INTO rank_promotions (user_id, from_rank, to_rank, charge_amount_at, charge_count_at, attendance_at)
    SELECT _user_id, r.rank, _req.rank, _amt, _cnt, _att FROM rank_requirements r WHERE r.sort_order = _cur;
    UPDATE profiles SET rank = _req.rank WHERE id = _user_id;
    _cur := _cur + 1;

    INSERT INTO user_items (user_id, item_id, source_type, source_rank)
    SELECT _user_id, i.id, 'RANK_REWARD', _req.rank FROM items i
     WHERE i.rank_required = _req.rank AND i.enabled = true
    ON CONFLICT DO NOTHING;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category)), '[]'::jsonb)
      INTO _items FROM items i WHERE i.rank_required = _req.rank AND i.enabled = true;

    INSERT INTO rank_reward_claims (user_id, rank, points_reward, items_reward)
    VALUES (_user_id, _req.rank, _req.points_reward, _items)
    ON CONFLICT (user_id, rank) DO NOTHING;

    IF FOUND THEN
      PERFORM grant_points_internal(_user_id, _req.points_reward, 'rank_reward',
        format('%s 계급 달성 보상', _req.label), 'rank', NULL, NULL);
    END IF;
  END LOOP;

  RETURN (SELECT rank FROM profiles WHERE id = _user_id);
END; $function$;

-- 자동충전 지급: 누적 실적은 계급 평가에서 재계산하므로 직접 증가시키지 않는다.
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
  IF _d.status = 'CREDITED' THEN RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_CREDITED'); END IF;
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

  UPDATE profiles SET game_points = game_points + _points WHERE id = _r.user_id;

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
REVOKE ALL ON FUNCTION public.credit_crypto_charge(uuid, uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.credit_crypto_charge(uuid, uuid) TO service_role;