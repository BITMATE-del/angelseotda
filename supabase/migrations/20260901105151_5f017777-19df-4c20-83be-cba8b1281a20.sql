UPDATE app_settings SET value = '1'::jsonb, updated_at = now() WHERE key = 'points_per_won';
INSERT INTO app_settings (key, value) SELECT 'points_per_won', '1'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key='points_per_won');

CREATE OR REPLACE FUNCTION public.request_charge_with_ticket(_amount numeric, _depositor_name text, _note text DEFAULT NULL::text, _use_ticket boolean DEFAULT false)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _rate numeric; _fee_rate numeric; _ticket uuid; _fee numeric;
  _base numeric; _points bigint; _req uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION '충전 금액이 올바르지 않습니다.'; END IF;
  IF COALESCE(trim(_depositor_name),'') = '' THEN RAISE EXCEPTION '입금자명을 입력해 주세요.'; END IF;

  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  SELECT (value#>>'{}')::numeric INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
  _rate := COALESCE(_rate, 1); _fee_rate := COALESCE(_fee_rate, 0.07);

  IF _use_ticket THEN
    UPDATE rake_free_tickets SET status = 'RESERVED', reserved_at = now()
     WHERE id = (SELECT id FROM rake_free_tickets
                  WHERE user_id = _uid AND status = 'ISSUED'
                  ORDER BY issued_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id INTO _ticket;
    IF _ticket IS NULL THEN RAISE EXCEPTION '사용 가능한 충전 레이크 면제권이 없습니다.'; END IF;
  END IF;

  _fee := CASE WHEN _ticket IS NULL THEN round(_amount * _fee_rate) ELSE 0 END;
  _base := _amount - _fee;
  _points := floor(_base * _rate)::bigint;

  INSERT INTO charge_requests (user_id, requested_amount, point_amount, conversion_rate,
    depositor_name, user_note, rake_free_ticket_used, rake_free_ticket_id)
  VALUES (_uid, _amount, _points, _rate, trim(_depositor_name), _note, _ticket IS NOT NULL, _ticket)
  RETURNING id INTO _req;

  IF _ticket IS NOT NULL THEN
    UPDATE rake_free_tickets SET charge_request_id = _req WHERE id = _ticket;
  END IF;
  RETURN _req;
END; $function$;

CREATE OR REPLACE FUNCTION public.request_withdrawal(_points bigint, _method text, _details jsonb, _note text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _rate numeric;
  _p profiles;
  _req uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _points <= 0 THEN RAISE EXCEPTION '출금 포인트가 올바르지 않습니다.'; END IF;
  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  _rate := COALESCE(_rate, 1);
  IF _rate <= 0 THEN _rate := 1; END IF;
  SELECT * INTO _p FROM profiles WHERE id = _uid FOR UPDATE;
  IF _p.game_points < _points THEN RAISE EXCEPTION '보유 포인트가 부족합니다.'; END IF;

  UPDATE profiles SET game_points = game_points - _points,
                      locked_points = locked_points + _points
  WHERE id = _uid;

  INSERT INTO withdrawal_requests (user_id, requested_points, payout_amount, conversion_rate, payout_method, payout_details, user_note)
  VALUES (_uid, _points, _points / _rate, _rate, _method, COALESCE(_details,'{}'::jsonb), _note)
  RETURNING id INTO _req;

  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id)
  VALUES (_uid, 'withdraw_requested', -_points, _p.game_points, _p.game_points - _points,
          _p.locked_points, _p.locked_points + _points, 'withdrawal_request', _req);
  RETURN _req;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_process_charge(_request_id uuid, _status text, _admin_note text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _r charge_requests; _p profiles;
  _rate numeric; _fee_rate numeric; _comm_rate numeric;
  _fee numeric := 0; _comm numeric := 0; _company numeric := 0; _base numeric; _points bigint;
  _aff affiliates; _ticket boolean := false;
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
    SELECT (value#>>'{}')::numeric INTO _comm_rate FROM app_settings WHERE key = 'affiliate_commission_rate';
    _rate := COALESCE(_rate, 1); _fee_rate := COALESCE(_fee_rate, 0.07); _comm_rate := COALESCE(_comm_rate, 0.02);

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
    _comm := CASE WHEN _aff.id IS NULL THEN 0 ELSE round(_r.requested_amount * _comm_rate) END;
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
      INSERT INTO affiliate_commissions (affiliate_id, member_user_id, charge_request_id, base_amount, commission_amount, commission_rate)
      SELECT _aff.id, _r.user_id, _r.id, _r.requested_amount, _comm, _comm_rate
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
                             'rake_free_ticket', _ticket));

  IF _status = 'APPROVED' THEN
    PERFORM evaluate_member_rank(_r.user_id);
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_pay_weekly_rewards(_season_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _s weekly_ranking_seasons; _rate numeric; _min int := 20;
  _row record; _base numeric; _points bigint; _paid jsonb := '[]'::jsonb; _i int; _inserted uuid;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _s FROM weekly_ranking_seasons WHERE id = _season_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION '시즌을 찾을 수 없습니다.'; END IF;
  IF _s.status NOT IN ('FINALIZED','REWARDED') THEN RAISE EXCEPTION '시즌 확정 후에만 상금을 지급할 수 있습니다.'; END IF;
  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  _rate := COALESCE(_rate, 1);

  IF _s.deposit_participants >= _min THEN
    SELECT * INTO _row FROM weekly_deposit_stats
     WHERE season_id = _season_id AND rank_position = 1 AND net_deposit > 0;
    IF _row.user_id IS NOT NULL THEN
      _base := round(_s.total_charge_amount * _s.reward_rate);
      _points := floor(_base * _rate)::bigint;
      INSERT INTO ranking_rewards (season_id, ranking_type, user_id, rank_position, reward_type, reward_amount, reward_meta)
      VALUES (_season_id, 'DEPOSIT', _row.user_id, 1, 'POINTS', _points,
              jsonb_build_object('weekly_total_charge', _s.total_charge_amount, 'reward_rate', _s.reward_rate,
                                 'reward_base_amount', _base, 'conversion_rate', _rate, 'reward_points', _points))
      ON CONFLICT (season_id, ranking_type, rank_position) DO NOTHING
      RETURNING id INTO _inserted;
      IF _inserted IS NOT NULL THEN
        PERFORM grant_points_internal(_row.user_id, _points, 'ranking_reward',
          format('입금랭커 1위 상금 (%s 주간 총 충전 %s원의 %s%%)', _s.week_key, _s.total_charge_amount, _s.reward_rate*100),
          'weekly_season', _season_id, _uid);
        _paid := _paid || jsonb_build_object('type','DEPOSIT','position',1,'points',_points);
      END IF;
    END IF;
  END IF;

  IF _s.gwang_participants >= _min THEN
    FOR _i IN 1..3 LOOP
      _inserted := NULL;
      SELECT * INTO _row FROM weekly_gwang_stats
       WHERE season_id = _season_id AND rank_position = _i AND total_gwang_wins > 0;
      IF _row.user_id IS NOT NULL THEN
        _points := (ARRAY[50000,30000,10000])[_i];
        INSERT INTO ranking_rewards (season_id, ranking_type, user_id, rank_position, reward_type, reward_amount, reward_meta)
        VALUES (_season_id, 'GWANG', _row.user_id, _i, 'POINTS', _points,
                jsonb_build_object('total_gwang_wins', _row.total_gwang_wins,
                  'gwang38', _row.gwang38_wins, 'gwang18', _row.gwang18_wins, 'gwang13', _row.gwang13_wins))
        ON CONFLICT (season_id, ranking_type, rank_position) DO NOTHING
        RETURNING id INTO _inserted;
        IF _inserted IS NOT NULL THEN
          PERFORM grant_points_internal(_row.user_id, _points, 'ranking_reward',
            format('광땡랭커 %s위 상금 (%s)', _i, _s.week_key), 'weekly_season', _season_id, _uid);
          _paid := _paid || jsonb_build_object('type','GWANG','position',_i,'points',_points);
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF _s.profit_participants >= _min THEN
    _inserted := NULL;
    SELECT * INTO _row FROM weekly_profit_stats
     WHERE season_id = _season_id AND rank_position = 1 AND win_points > 0;
    IF _row.user_id IS NOT NULL THEN
      INSERT INTO ranking_rewards (season_id, ranking_type, user_id, rank_position, reward_type, reward_amount, reward_meta)
      VALUES (_season_id, 'PROFIT', _row.user_id, 1, 'CHARGE_RAKE_FREE_TICKET', 2,
              jsonb_build_object('win_points', _row.win_points, 'win_count', _row.win_count))
      ON CONFLICT (season_id, ranking_type, rank_position) DO NOTHING
      RETURNING id INTO _inserted;
      IF _inserted IS NOT NULL THEN
        INSERT INTO rake_free_tickets (user_id, source_type, source_ref)
        SELECT _row.user_id, 'RANKING_REWARD', _season_id FROM generate_series(1,2);
        _paid := _paid || jsonb_build_object('type','PROFIT','position',1,'tickets',2);
      END IF;
    END IF;
  END IF;

  UPDATE weekly_ranking_seasons SET status = 'REWARDED', rewarded_at = now() WHERE id = _season_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'pay_weekly_rewards', 'weekly_season', _season_id, jsonb_build_object('paid', _paid));
  RETURN jsonb_build_object('paid', _paid, 'min_participants', _min);
END; $function$;