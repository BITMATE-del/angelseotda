CREATE OR REPLACE FUNCTION public.is_valid_tron_address(_addr text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _addr IS NOT NULL
     AND _addr ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$';
$$;

CREATE OR REPLACE FUNCTION public.request_withdrawal(_points bigint, _method text, _details jsonb, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _rate numeric;
  _usdt_rate numeric;
  _p profiles;
  _req uuid;
  _addr text;
  _save boolean;
  _payout_details jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF NOT public.ops_flag('withdraw_enabled') THEN RAISE EXCEPTION '현재 출금 신청이 중단되었습니다.'; END IF;
  IF public.ops_flag('maintenance_enabled') AND public.ops_flag('maintenance_block_withdraw') THEN
    RAISE EXCEPTION '서버 점검 중에는 출금 신청을 받을 수 없습니다.';
  END IF;
  IF _points <= 0 THEN RAISE EXCEPTION '출금 포인트가 올바르지 않습니다.'; END IF;

  IF COALESCE(lower(_method), '') NOT IN ('usdt', 'usdt_trc20') THEN
    RAISE EXCEPTION '출금은 USDT(TRC20)만 지원합니다.';
  END IF;

  _addr := NULLIF(regexp_replace(COALESCE(_details->>'address', ''), '\s', '', 'g'), '');
  IF NOT public.is_valid_tron_address(_addr) THEN
    RAISE EXCEPTION 'USDT(TRC20) 주소 형식이 올바르지 않습니다.';
  END IF;
  _save := COALESCE((_details->>'save_default')::boolean, false);

  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  _rate := COALESCE(_rate, 1);
  IF _rate <= 0 THEN _rate := 1; END IF;

  SELECT (value#>>'{}')::numeric INTO _usdt_rate FROM app_settings WHERE key = 'crypto_rate_cache';

  SELECT * INTO _p FROM profiles WHERE id = _uid FOR UPDATE;
  IF _p.game_points < _points THEN RAISE EXCEPTION '보유 포인트가 부족합니다.'; END IF;

  UPDATE profiles SET game_points = game_points - _points,
                      locked_points = locked_points + _points
  WHERE id = _uid;

  IF _save THEN
    UPDATE profiles SET wallet_address = _addr WHERE id = _uid;
  END IF;

  _payout_details := jsonb_build_object(
    'address', _addr,
    'network', 'TRC20',
    'asset', 'USDT',
    'krw_per_usdt', _usdt_rate,
    'expected_usdt', CASE WHEN COALESCE(_usdt_rate, 0) > 0
                          THEN round((_points / _rate) / _usdt_rate, 6)
                          ELSE NULL END
  );

  INSERT INTO withdrawal_requests (user_id, requested_points, payout_amount, conversion_rate, payout_method, payout_details, user_note)
  VALUES (_uid, _points, _points / _rate, _rate, 'usdt_trc20', _payout_details, _note)
  RETURNING id INTO _req;

  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id)
  VALUES (_uid, 'withdraw_requested', -_points, _p.game_points, _p.game_points - _points,
          _p.locked_points, _p.locked_points + _points, 'withdrawal_request', _req);
  RETURN _req;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_list_withdrawals(_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  nickname text,
  username text,
  requested_at timestamptz,
  processed_at timestamptz,
  requested_points bigint,
  payout_amount numeric,
  conversion_rate numeric,
  payout_method text,
  address text,
  network text,
  krw_per_usdt numeric,
  expected_usdt numeric,
  status text,
  user_note text,
  admin_note text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  RETURN QUERY
  SELECT w.id, w.user_id, p.nickname, p.username, w.requested_at, w.processed_at,
         w.requested_points, w.payout_amount, w.conversion_rate, w.payout_method,
         COALESCE(w.payout_details->>'address', w.payout_details->>'wallet_address'),
         w.payout_details->>'network',
         NULLIF(w.payout_details->>'krw_per_usdt', '')::numeric,
         NULLIF(w.payout_details->>'expected_usdt', '')::numeric,
         w.status, w.user_note, w.admin_note
  FROM withdrawal_requests w
  LEFT JOIN profiles p ON p.id = w.user_id
  ORDER BY w.requested_at DESC
  LIMIT COALESCE(_limit, 100);
END; $function$;

REVOKE ALL ON FUNCTION public.admin_list_withdrawals(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_withdrawals(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_withdrawals(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_withdrawals(integer) TO service_role;