-- 1) 총판별 리베이트율(퍼센트) 컬럼
ALTER TABLE public.affiliates
  ADD COLUMN IF NOT EXISTS rebate_rate numeric(5,2) NOT NULL DEFAULT 2.00;

UPDATE public.affiliates SET rebate_rate = 2.00 WHERE rebate_rate IS NULL;

ALTER TABLE public.affiliates
  DROP CONSTRAINT IF EXISTS affiliates_rebate_rate_range;
ALTER TABLE public.affiliates
  ADD CONSTRAINT affiliates_rebate_rate_range CHECK (rebate_rate >= 0 AND rebate_rate <= 7);

-- 2) 거래별 rate snapshot (퍼센트). 기존 행은 저장돼 있던 비율을 그대로 옮겨 적는다(금액 재계산 없음)
ALTER TABLE public.affiliate_commissions
  ADD COLUMN IF NOT EXISTS applied_rebate_rate numeric(5,2);

UPDATE public.affiliate_commissions
   SET applied_rebate_rate = round(COALESCE(commission_rate, 0.02)::numeric * 100, 2)
 WHERE applied_rebate_rate IS NULL;

-- 3) 리베이트율 변경 RPC (관리자/최고관리자 전용)
CREATE OR REPLACE FUNCTION public.admin_set_affiliate_rebate_rate(
  _affiliate_id uuid, _rate numeric, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _old numeric; _code text; _new numeric;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF _rate IS NULL OR _rate < 0 OR _rate > 7 THEN
    RAISE EXCEPTION 'INVALID_AFFILIATE_REBATE_RATE';
  END IF;
  _new := round(_rate::numeric, 2);

  SELECT rebate_rate, affiliate_code INTO _old, _code
    FROM public.affiliates WHERE id = _affiliate_id FOR UPDATE;
  IF _code IS NULL THEN RAISE EXCEPTION 'AFFILIATE_NOT_FOUND'; END IF;

  UPDATE public.affiliates SET rebate_rate = _new WHERE id = _affiliate_id;

  INSERT INTO public.admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'AFFILIATE_REBATE_RATE_UPDATED', 'affiliate', _affiliate_id,
          jsonb_build_object('affiliate_code', _code, 'old_rate', _old, 'new_rate', _new,
                             'reason', NULLIF(trim(COALESCE(_reason,'')), '')));

  RETURN jsonb_build_object('ok', true, 'code', _code, 'oldRate', _old, 'newRate', _new);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_set_affiliate_rebate_rate(uuid, numeric, text) TO authenticated;

-- 4) 충전 승인: 코드별 리베이트율 사용 + snapshot 저장
CREATE OR REPLACE FUNCTION public.admin_process_charge(_request_id uuid, _status text, _admin_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _r charge_requests; _p profiles;
  _rate numeric; _fee_rate numeric; _comm_rate numeric;
  _fee numeric := 0; _comm numeric := 0; _company numeric := 0; _base numeric; _points bigint;
  _aff affiliates; _ticket boolean := false; _rebate_pct numeric := 0;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('REVIEWING','APPROVED','REJECTED') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT * INTO _r FROM charge_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
  IF _r.status IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION '이미 처리된 신청입니다.'; END IF;
  _ticket := COALESCE(_r.rake_free_ticket_used, false) AND _r.rake_free_ticket_id IS NOT NULL;

  IF _status = 'APPROVED' THEN
    SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
    SELECT (value#>>'{}')::numeric INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
    _rate := COALESCE(_rate, 1); _fee_rate := COALESCE(_fee_rate, 0.07);

    IF _ticket THEN
      UPDATE rake_free_tickets SET status = 'USED', used_at = now()
       WHERE id = _r.rake_free_ticket_id AND status IN ('ISSUED','RESERVED') AND charge_request_id = _r.id;
      IF NOT FOUND THEN RAISE EXCEPTION '면제권이 이미 사용되었습니다.'; END IF;
      _fee := 0;
    ELSE
      _fee := round(_r.requested_amount * _fee_rate);
    END IF;

    _base := _r.requested_amount - _fee;
    _points := floor(_base * _rate)::bigint;

    SELECT a.* INTO _aff FROM affiliates a
      JOIN profiles pr ON pr.referred_by_affiliate_id = a.id
     WHERE pr.id = _r.user_id AND a.status = 'active';

    _rebate_pct := CASE WHEN _aff.id IS NULL THEN 0 ELSE COALESCE(_aff.rebate_rate, 2.00) END;
    _comm_rate := _rebate_pct / 100.0;
    _comm := CASE WHEN _aff.id IS NULL THEN 0 ELSE round(_r.requested_amount * _comm_rate) END;
    IF _comm > _fee THEN _comm := _fee; END IF;
    _company := _fee - _comm;

    SELECT * INTO _p FROM profiles WHERE id = _r.user_id FOR UPDATE;
    UPDATE profiles SET game_points = game_points + _points WHERE id = _r.user_id;

    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, admin_id, memo)
    VALUES (_r.user_id, 'charge_approved', _points, _p.game_points, _p.game_points + _points,
            _p.locked_points, _p.locked_points, 'charge_request', _r.id, _uid,
            format('신청 %s원 / 수수료 %s원%s(총판 %s원, 운영 %s원) / 실충전기준 %s원 / 지급 %sP (환산 %s)',
                   _r.requested_amount, _fee, CASE WHEN _ticket THEN ' [레이크 면제권 사용] ' ELSE ' ' END,
                   _comm, _company, _base, _points, _rate));

    IF _aff.id IS NOT NULL AND _comm > 0 THEN
      INSERT INTO affiliate_commissions (affiliate_id, member_user_id, charge_request_id, base_amount, commission_amount, commission_rate, applied_rebate_rate)
      SELECT _aff.id, _r.user_id, _r.id, _r.requested_amount, _comm, _comm_rate, _rebate_pct
       WHERE NOT EXISTS (SELECT 1 FROM affiliate_commissions WHERE charge_request_id = _r.id);
    END IF;

    UPDATE charge_requests SET
      conversion_rate = _rate, point_amount = _points, credited_points = _points,
      credited_base_amount = _base, fee_amount = _fee,
      affiliate_commission_amount = _comm, company_fee_amount = _company,
      affiliate_id = _aff.id
    WHERE id = _request_id;
  ELSIF _status = 'REJECTED' AND _ticket THEN
    UPDATE rake_free_tickets SET status = 'ISSUED', reserved_at = NULL, charge_request_id = NULL
     WHERE id = _r.rake_free_ticket_id AND status = 'RESERVED';
  END IF;

  UPDATE charge_requests SET status = _status, admin_note = COALESCE(_admin_note, admin_note),
    processed_at = CASE WHEN _status = 'REVIEWING' THEN processed_at ELSE now() END,
    processed_by = _uid
  WHERE id = _request_id;

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'charge_' || lower(_status), 'charge_request', _request_id,
          jsonb_build_object('requested', _r.requested_amount, 'fee', _fee, 'affiliate_commission', _comm,
                             'company_fee', _company, 'base', _base, 'points', _points,
                             'affiliate_rebate_rate', _rebate_pct,
                             'rake_free_ticket', _ticket));

  IF _status = 'APPROVED' THEN
    PERFORM evaluate_member_rank(_r.user_id);
  END IF;
END; $function$;

-- 5) USDT 자동충전: 동일 규칙 적용
CREATE OR REPLACE FUNCTION public.credit_crypto_charge(_request_id uuid, _deposit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r crypto_charge_requests; _d chain_deposits; _p profiles;
  _fee_rate numeric; _comm_rate numeric; _points_per_won numeric;
  _fee numeric; _base numeric; _points bigint; _comm numeric := 0; _company numeric;
  _aff affiliates; _rebate_pct numeric := 0;
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
  SELECT COALESCE((value#>>'{}')::numeric, 1) INTO _points_per_won FROM app_settings WHERE key = 'points_per_won';
  _fee_rate := COALESCE(_fee_rate, 0.07);
  _points_per_won := COALESCE(_points_per_won, 1);

  _fee := round(_r.requested_krw * _fee_rate);
  _base := _r.requested_krw - _fee;
  _points := floor(_base * _points_per_won)::bigint;

  SELECT a.* INTO _aff FROM affiliates a
    JOIN profiles pr ON pr.referred_by_affiliate_id = a.id
   WHERE pr.id = _r.user_id AND a.status = 'active';

  _rebate_pct := CASE WHEN _aff.id IS NULL THEN 0 ELSE COALESCE(_aff.rebate_rate, 2.00) END;
  _comm_rate := _rebate_pct / 100.0;
  _comm := CASE WHEN _aff.id IS NULL THEN 0 ELSE round(_r.requested_krw * _comm_rate) END;
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
          format('USDT 자동충전 %s원 · %s USDT · TXID %s', _r.requested_krw, _d.amount_usdt, _d.txid));

  IF _aff.id IS NOT NULL AND _comm > 0 THEN
    INSERT INTO affiliate_commissions
      (affiliate_id, member_user_id, base_amount, commission_amount, commission_rate, applied_rebate_rate, status)
    VALUES (_aff.id, _r.user_id, _r.requested_krw, _comm, _comm_rate, _rebate_pct, 'PENDING');
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
END; $function$;

-- 6) 목록/센터 조회에 현재 리베이트율 노출
CREATE OR REPLACE FUNCTION public.admin_list_affiliates()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'createdAt') DESC) FROM (
      SELECT jsonb_build_object(
        'id', a.id,
        'userId', a.user_id,
        'code', a.affiliate_code,
        'status', a.status,
        'memo', a.memo,
        'createdAt', a.created_at,
        'rebateRate', a.rebate_rate,
        'username', p.username,
        'nickname', p.nickname,
        'members', (SELECT count(*) FROM public.affiliate_members m WHERE m.affiliate_id = a.id),
        'membersWeek', (SELECT count(*) FROM public.affiliate_members m
                        WHERE m.affiliate_id = a.id AND m.joined_at >= now() - interval '7 days'),
        'baseTotal', COALESCE(cs.base_sum, 0),
        'commissionTotal', COALESCE(cs.commission_sum, 0),
        'pending', COALESCE(cs.pending_sum, 0),
        'settled', COALESCE(cs.settled_sum, 0),
        'day7', COALESCE(cs.day7_sum, 0),
        'lastCommissionAt', cs.last_at
      ) AS x
      FROM public.affiliates a
      LEFT JOIN public.profiles p ON p.id = a.user_id
      LEFT JOIN (
        SELECT c.affiliate_id,
               SUM(c.base_amount) AS base_sum,
               SUM(c.commission_amount) AS commission_sum,
               SUM(c.commission_amount) FILTER (WHERE public.affiliate_commission_is_unsettled(c.status)) AS pending_sum,
               SUM(c.commission_amount) FILTER (WHERE public.affiliate_commission_is_settled(c.status)) AS settled_sum,
               SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '7 days') AS day7_sum,
               MAX(c.created_at) AS last_at
        FROM public.affiliate_commissions c
        GROUP BY c.affiliate_id
      ) cs ON cs.affiliate_id = a.id
    ) s
  ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.affiliate_overview(_affiliate_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _aff public.affiliates;
  _is_admin boolean;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  _is_admin := public.is_admin(_uid);

  IF _affiliate_id IS NULL THEN
    SELECT * INTO _aff FROM public.affiliates WHERE user_id = _uid;
  ELSE
    SELECT * INTO _aff FROM public.affiliates WHERE id = _affiliate_id;
    IF _aff.id IS NOT NULL AND NOT _is_admin AND _aff.user_id <> _uid THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
  END IF;

  IF _aff.id IS NULL THEN
    RETURN jsonb_build_object('affiliate', NULL);
  END IF;

  SELECT jsonb_build_object(
    'affiliate', jsonb_build_object(
      'id', _aff.id,
      'userId', _aff.user_id,
      'code', _aff.affiliate_code,
      'status', _aff.status,
      'memo', _aff.memo,
      'createdAt', _aff.created_at,
      'rebateRate', _aff.rebate_rate,
      'nickname', p.nickname,
      'username', p.username
    ),
    'totals', (
      SELECT jsonb_build_object(
        'members', (SELECT count(*) FROM public.affiliate_members m WHERE m.affiliate_id = _aff.id),
        'membersWeek', (SELECT count(*) FROM public.affiliate_members m
                        WHERE m.affiliate_id = _aff.id AND m.joined_at >= now() - interval '7 days'),
        'commissionTotal', COALESCE(SUM(c.commission_amount), 0),
        'commissionCount', count(*),
        'baseTotal', COALESCE(SUM(c.base_amount), 0),
        'pending', COALESCE(SUM(c.commission_amount) FILTER (WHERE public.affiliate_commission_is_unsettled(c.status)), 0),
        'settled', COALESCE(SUM(c.commission_amount) FILTER (WHERE public.affiliate_commission_is_settled(c.status)), 0),
        'day1', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '1 day'), 0),
        'day7', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '7 days'), 0),
        'day30', COALESCE(SUM(c.commission_amount) FILTER (WHERE c.created_at >= now() - interval '30 days'), 0)
      )
      FROM public.affiliate_commissions c WHERE c.affiliate_id = _aff.id
    ),
    'members', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'joinedAt') DESC) FROM (
        SELECT jsonb_build_object(
          'userId', m.member_user_id,
          'username', mp.username,
          'nickname', mp.nickname,
          'level', mp.level,
          'rank', mp.rank,
          'points', mp.game_points,
          'status', mp.status,
          'joinedAt', m.joined_at,
          'lastSeenAt', mp.last_seen_at,
          'chargeAmount', COALESCE(cs.base_sum, 0),
          'chargeCount', COALESCE(cs.cnt, 0),
          'commissionAmount', COALESCE(cs.commission_sum, 0),
          'commissionPending', COALESCE(cs.pending_sum, 0),
          'lastChargeAt', cs.last_at
        ) AS x
        FROM public.affiliate_members m
        LEFT JOIN public.profiles mp ON mp.id = m.member_user_id
        LEFT JOIN (
          SELECT c.member_user_id,
                 SUM(c.base_amount) AS base_sum,
                 SUM(c.commission_amount) AS commission_sum,
                 SUM(c.commission_amount) FILTER (WHERE public.affiliate_commission_is_unsettled(c.status)) AS pending_sum,
                 count(*) AS cnt,
                 MAX(c.created_at) AS last_at
          FROM public.affiliate_commissions c
          WHERE c.affiliate_id = _aff.id
          GROUP BY c.member_user_id
        ) cs ON cs.member_user_id = m.member_user_id
        WHERE m.affiliate_id = _aff.id
      ) s
    ), '[]'::jsonb),
    'commissions', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'createdAt') DESC) FROM (
        SELECT jsonb_build_object(
          'id', c.id,
          'createdAt', c.created_at,
          'memberUserId', c.member_user_id,
          'username', mp.username,
          'nickname', mp.nickname,
          'baseAmount', c.base_amount,
          'rate', c.commission_rate,
          'appliedRebateRate', c.applied_rebate_rate,
          'amount', c.commission_amount,
          'status', c.status,
          'settledAt', c.settled_at
        ) AS x
        FROM public.affiliate_commissions c
        LEFT JOIN public.profiles mp ON mp.id = c.member_user_id
        WHERE c.affiliate_id = _aff.id
        ORDER BY c.created_at DESC
        LIMIT 200
      ) s
    ), '[]'::jsonb),
    'activity', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'at') DESC) FROM (
        (
          SELECT jsonb_build_object(
            'at', m.joined_at, 'type', 'JOIN',
            'nickname', COALESCE(mp.nickname, '-'),
            'username', mp.username,
            'amount', 0
          ) AS x
          FROM public.affiliate_members m
          LEFT JOIN public.profiles mp ON mp.id = m.member_user_id
          WHERE m.affiliate_id = _aff.id
          ORDER BY m.joined_at DESC LIMIT 30
        )
        UNION ALL
        (
          SELECT jsonb_build_object(
            'at', c.created_at, 'type', 'COMMISSION',
            'nickname', COALESCE(mp.nickname, '-'),
            'username', mp.username,
            'amount', c.commission_amount,
            'baseAmount', c.base_amount,
            'status', c.status
          ) AS x
          FROM public.affiliate_commissions c
          LEFT JOIN public.profiles mp ON mp.id = c.member_user_id
          WHERE c.affiliate_id = _aff.id
          ORDER BY c.created_at DESC LIMIT 30
        )
      ) s
    ), '[]'::jsonb)
  )
  INTO _out
  FROM public.profiles p WHERE p.id = _aff.user_id;

  RETURN _out;
END;
$function$;