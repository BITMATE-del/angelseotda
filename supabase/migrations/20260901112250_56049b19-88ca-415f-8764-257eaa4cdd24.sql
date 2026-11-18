-- 무결성 진단 (관리자)
CREATE OR REPLACE FUNCTION public.admin_integrity_report()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid();
  _point jsonb; _pot jsonb; _dup jsonb; _card jsonb; _gwang jsonb; _failed jsonb; _neg jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;

  -- 포인트 무결성: 최신 거래의 balance_after 와 현재 보유 포인트 비교
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _point FROM (
    SELECT p.id AS user_id, p.nickname, p.game_points, t.balance_after AS expected_points,
           p.locked_points, t.locked_after AS expected_locked, t.created_at AS last_tx_at
      FROM profiles p
      JOIN LATERAL (SELECT balance_after, locked_after, created_at FROM point_transactions
                     WHERE user_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1) t ON true
     WHERE p.game_points <> t.balance_after OR p.locked_points <> t.locked_after
     LIMIT 50) x;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _neg FROM (
    SELECT id AS user_id, nickname, game_points, locked_points FROM profiles
     WHERE game_points < 0 OR locked_points < 0 LIMIT 50) x;

  -- POT 무결성: 총 베팅합 = pot = 총 지급합
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _pot FROM (
    SELECT r.id AS round_id, r.room_id, r.pot,
           COALESCE(b.total_bets, 0) AS total_bets, COALESCE(w.total_payout, 0) AS total_payout
      FROM game_rounds r
      LEFT JOIN (SELECT round_id, sum(amount) AS total_bets FROM game_actions GROUP BY round_id) b ON b.round_id = r.id
      LEFT JOIN (SELECT reference_id, sum(amount) AS total_payout FROM point_transactions
                  WHERE type = 'game_win' AND reference_type = 'game_round' GROUP BY reference_id) w ON w.reference_id = r.id
     WHERE r.settlement_status = 'SETTLED'
       AND (r.pot <> COALESCE(b.total_bets,0) OR r.pot <> COALESCE(w.total_payout,0))
     ORDER BY r.settled_at DESC LIMIT 50) x;

  -- 중복 정산: 라운드+회원 기준 game_win 거래 2건 이상
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _dup FROM (
    SELECT reference_id AS round_id, user_id, count(*) AS payout_count, sum(amount) AS total
      FROM point_transactions
     WHERE type = 'game_win' AND reference_type = 'game_round'
     GROUP BY reference_id, user_id HAVING count(*) > 1 LIMIT 50) x;

  -- 카드 무결성: 중복 배분 / 인원수 대비 장수 / 20장 초과
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _card FROM (
    SELECT r.id AS round_id, r.game_mode, c.total_cards, c.unique_cards, pc.player_count,
           (CASE WHEN r.game_mode = 'sutda3' THEN 3 ELSE 2 END) * pc.player_count AS expected_cards
      FROM game_rounds r
      JOIN (SELECT round_id, count(*) AS total_cards, count(DISTINCT card_code) AS unique_cards
              FROM game_cards GROUP BY round_id) c ON c.round_id = r.id
      JOIN (SELECT round_id, count(*) AS player_count FROM game_round_players GROUP BY round_id) pc ON pc.round_id = r.id
     WHERE c.total_cards <> c.unique_cards OR c.total_cards > 20
        OR c.total_cards <> (CASE WHEN r.game_mode = 'sutda3' THEN 3 ELSE 2 END) * pc.player_count
     ORDER BY r.started_at DESC LIMIT 50) x;

  -- 광 카드 설정 검사
  SELECT jsonb_build_object(
    'gwang_codes', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM card_assets WHERE is_gwang), '[]'::jsonb),
    'total_assets', (SELECT count(*) FROM card_assets),
    'valid', (SELECT count(*) = 3 AND bool_and(id IN ('01-gwang','03-gwang','08-gwang')) FROM card_assets WHERE is_gwang)
  ) INTO _gwang;

  -- 정산 실패 라운드
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _failed FROM (
    SELECT id AS round_id, room_id, game_mode, phase, pot, started_at
      FROM game_rounds WHERE settlement_status = 'FAILED' ORDER BY started_at DESC LIMIT 50) x;

  RETURN jsonb_build_object(
    'checkedAt', now(),
    'pointMismatch', _point, 'pointMismatchCount', jsonb_array_length(_point),
    'negativeBalances', _neg, 'negativeBalanceCount', jsonb_array_length(_neg),
    'potMismatch', _pot, 'potMismatchCount', jsonb_array_length(_pot),
    'duplicateSettlement', _dup, 'duplicateSettlementCount', jsonb_array_length(_dup),
    'cardMismatch', _card, 'cardMismatchCount', jsonb_array_length(_card),
    'cardConfig', _gwang,
    'failedSettlements', _failed, 'failedSettlementCount', jsonb_array_length(_failed)
  );
END; $$;

-- 서버 상태 (실제 응답 기준)
CREATE OR REPLACE FUNCTION public.admin_server_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _t0 timestamptz; _db_ms numeric; _auth_ms numeric;
  _rt int; _errs record; _users int;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  _t0 := clock_timestamp();
  PERFORM count(*) FROM profiles;
  _db_ms := extract(milliseconds FROM clock_timestamp() - _t0);

  _t0 := clock_timestamp();
  SELECT count(*) INTO _users FROM auth.users;
  _auth_ms := extract(milliseconds FROM clock_timestamp() - _t0);

  SELECT count(*) INTO _rt FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public';

  SELECT
    count(*) FILTER (WHERE fn LIKE '%game%' OR fn IN ('start_game_round','place_bet_action','select_final_hand','enforce_turn_timeout','settle_round')) AS game_errs,
    count(*) FILTER (WHERE fn LIKE '%point%' OR fn LIKE '%adjust%') AS point_errs,
    count(*) FILTER (WHERE fn LIKE '%charge%') AS charge_errs,
    count(*) FILTER (WHERE fn LIKE '%withdraw%') AS withdraw_errs,
    count(*) AS total_errs
    INTO _errs FROM game_error_logs WHERE occurred_at > now() - interval '15 minutes';

  RETURN jsonb_build_object(
    'checkedAt', now(),
    'database', jsonb_build_object('status', CASE WHEN _db_ms < 500 THEN 'ONLINE' ELSE 'DEGRADED' END, 'latencyMs', round(_db_ms,1)),
    'auth', jsonb_build_object('status', CASE WHEN _auth_ms < 500 THEN 'ONLINE' ELSE 'DEGRADED' END, 'latencyMs', round(_auth_ms,1), 'users', _users),
    'realtime', jsonb_build_object('status', CASE WHEN _rt > 0 THEN 'ONLINE' ELSE 'OFFLINE' END, 'tables', _rt),
    'gameRpc', jsonb_build_object('status', CASE WHEN _errs.game_errs = 0 THEN 'ONLINE' WHEN _errs.game_errs < 5 THEN 'DEGRADED' ELSE 'OFFLINE' END, 'recentErrors', _errs.game_errs),
    'pointRpc', jsonb_build_object('status', CASE WHEN _errs.point_errs = 0 THEN 'ONLINE' WHEN _errs.point_errs < 5 THEN 'DEGRADED' ELSE 'OFFLINE' END, 'recentErrors', _errs.point_errs),
    'chargeRpc', jsonb_build_object('status', CASE WHEN _errs.charge_errs = 0 THEN 'ONLINE' WHEN _errs.charge_errs < 5 THEN 'DEGRADED' ELSE 'OFFLINE' END, 'recentErrors', _errs.charge_errs),
    'withdrawalRpc', jsonb_build_object('status', CASE WHEN _errs.withdraw_errs = 0 THEN 'ONLINE' WHEN _errs.withdraw_errs < 5 THEN 'DEGRADED' ELSE 'OFFLINE' END, 'recentErrors', _errs.withdraw_errs),
    'recentErrorTotal', _errs.total_errs,
    'appMode', COALESCE((SELECT value#>>'{}' FROM app_settings WHERE key='app_mode'), 'PRODUCTION'),
    'maintenance', public.ops_flag('maintenance_enabled'),
    'gameLock', public.ops_flag('game_lock'),
    'activeRounds', (SELECT count(*) FROM game_rounds WHERE status <> 'finished')
  );
END; $$;

-- 테스트 계정/테스트방 지정
CREATE OR REPLACE FUNCTION public.admin_set_test_user(_user_id uuid, _is_test boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before boolean;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT is_test_user INTO _before FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  UPDATE profiles SET is_test_user = _is_test WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (_uid, 'set_test_user', 'profile', _user_id, _reason,
          jsonb_build_object('before', _before, 'after', _is_test));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_test_room(_room_id uuid, _is_test boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before boolean;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT is_test_room INTO _before FROM game_rooms WHERE id = _room_id;
  IF _before IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  UPDATE game_rooms SET is_test_room = _is_test WHERE id = _room_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (_uid, 'set_test_room', 'game_room', _room_id, _reason,
          jsonb_build_object('before', _before, 'after', _is_test));
END; $$;

-- 테스트 데이터 정리 (테스트 계정/테스트방 데이터만)
CREATE OR REPLACE FUNCTION public.admin_cleanup_test_data(_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _users uuid[]; _rounds uuid[]; _rooms uuid[]; _res jsonb := '{}'::jsonb; _c bigint;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO _users FROM profiles WHERE is_test_user = true;
  IF array_length(_users,1) IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', '테스트 계정이 없습니다.');
  END IF;

  SELECT COALESCE(array_agg(id), '{}') INTO _rooms FROM game_rooms
   WHERE is_test_room = true OR host_id = ANY(_users);
  SELECT COALESCE(array_agg(r.id), '{}') INTO _rounds FROM game_rounds r
   WHERE r.room_id = ANY(_rooms)
      OR NOT EXISTS (SELECT 1 FROM game_round_players p
                      WHERE p.round_id = r.id AND NOT (p.user_id = ANY(_users)));

  DELETE FROM game_cards WHERE round_id = ANY(_rounds);
  DELETE FROM game_actions WHERE round_id = ANY(_rounds);
  DELETE FROM game_round_players WHERE round_id = ANY(_rounds);
  DELETE FROM game_rounds WHERE id = ANY(_rounds);
  GET DIAGNOSTICS _c = ROW_COUNT; _res := _res || jsonb_build_object('rounds', _c);
  DELETE FROM chat_messages WHERE room_id = ANY(_rooms) OR user_id = ANY(_users);
  DELETE FROM game_room_players WHERE room_id = ANY(_rooms) OR user_id = ANY(_users);
  DELETE FROM game_rooms WHERE id = ANY(_rooms);
  GET DIAGNOSTICS _c = ROW_COUNT; _res := _res || jsonb_build_object('rooms', _c);

  DELETE FROM affiliate_commission_logs WHERE commission_id IN
    (SELECT id FROM affiliate_commissions WHERE member_user_id = ANY(_users));
  DELETE FROM affiliate_commissions WHERE member_user_id = ANY(_users);
  DELETE FROM charge_request_logs WHERE charge_request_id IN
    (SELECT id FROM charge_requests WHERE user_id = ANY(_users));
  DELETE FROM rake_free_tickets WHERE user_id = ANY(_users);
  DELETE FROM charge_requests WHERE user_id = ANY(_users);
  GET DIAGNOSTICS _c = ROW_COUNT; _res := _res || jsonb_build_object('chargeRequests', _c);
  DELETE FROM withdrawal_request_logs WHERE withdrawal_request_id IN
    (SELECT id FROM withdrawal_requests WHERE user_id = ANY(_users));
  DELETE FROM withdrawal_requests WHERE user_id = ANY(_users);
  GET DIAGNOSTICS _c = ROW_COUNT; _res := _res || jsonb_build_object('withdrawalRequests', _c);

  DELETE FROM weekly_deposit_stats WHERE user_id = ANY(_users);
  DELETE FROM weekly_gwang_stats WHERE user_id = ANY(_users);
  DELETE FROM weekly_profit_stats WHERE user_id = ANY(_users);
  DELETE FROM ranking_rewards WHERE user_id = ANY(_users);
  DELETE FROM season_rankings WHERE user_id = ANY(_users);
  DELETE FROM rank_reward_claims WHERE user_id = ANY(_users);
  DELETE FROM rank_promotions WHERE user_id = ANY(_users);
  DELETE FROM user_attendance WHERE user_id = ANY(_users);
  DELETE FROM user_achievements WHERE user_id = ANY(_users);
  DELETE FROM notifications WHERE user_id = ANY(_users);
  DELETE FROM point_transactions WHERE user_id = ANY(_users);
  GET DIAGNOSTICS _c = ROW_COUNT; _res := _res || jsonb_build_object('pointTransactions', _c);

  UPDATE profiles SET game_points = 0, locked_points = 0, rank_points = 0, wins = 0, losses = 0,
    gwangttaeng_count = 0, current_streak = 0, max_streak = 0, total_charge_amount = 0,
    total_charge_count = 0, attendance_count = 0, rank = 'UNRANKED'
   WHERE id = ANY(_users);

  INSERT INTO admin_logs (admin_id, action, target_type, reason, metadata)
  VALUES (_uid, 'cleanup_test_data', 'system', _reason, _res || jsonb_build_object('testUsers', array_length(_users,1)));

  RETURN _res || jsonb_build_object('testUsers', array_length(_users,1));
END; $$;