-- ============ 1) 기간제 아이템 / 칭호 유효기간 ============
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 0;
ALTER TABLE public.user_items ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_user_items_expires_at ON public.user_items (expires_at) WHERE expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.expire_user_items(_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n int;
BEGIN
  UPDATE public.user_items
     SET equipped = false, equipped_at = NULL
   WHERE equipped
     AND expires_at IS NOT NULL AND expires_at <= now()
     AND (_user_id IS NULL OR user_id = _user_id);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.expire_user_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_user_items(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_my_items()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN 0; END IF;
  RETURN public.expire_user_items(_uid);
END $$;
REVOKE ALL ON FUNCTION public.expire_my_items() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_my_items() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.equip_item(_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _cat text; _exp timestamptz; _has boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT category INTO _cat FROM public.items WHERE id = _item_id;
  IF _cat IS NULL THEN RAISE EXCEPTION '아이템을 찾을 수 없습니다.'; END IF;
  SELECT true, ui.expires_at INTO _has, _exp
    FROM public.user_items ui WHERE ui.user_id = _uid AND ui.item_id = _item_id;
  IF _has IS NOT TRUE THEN RAISE EXCEPTION '보유하지 않은 아이템입니다.'; END IF;
  IF _exp IS NOT NULL AND _exp <= now() THEN RAISE EXCEPTION '유효기간이 만료된 아이템입니다.'; END IF;
  UPDATE public.user_items ui SET equipped = false, equipped_at = NULL
    FROM public.items it
   WHERE ui.item_id = it.id AND ui.user_id = _uid AND it.category = _cat AND ui.equipped;
  UPDATE public.user_items SET equipped = true, equipped_at = now()
   WHERE user_id = _uid AND item_id = _item_id;
END $$;

CREATE OR REPLACE FUNCTION public.purchase_item(_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _price bigint; _balance bigint; _for_sale boolean; _rarity text; _days int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT price, for_sale, rarity, COALESCE(duration_days,0)
    INTO _price, _for_sale, _rarity, _days
    FROM items WHERE id = _item_id AND enabled = true FOR UPDATE;
  IF _price IS NULL THEN RAISE EXCEPTION '판매 중인 아이템이 아닙니다.'; END IF;
  IF NOT _for_sale THEN RAISE EXCEPTION '계급 전용 아이템은 구매할 수 없습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM user_items WHERE user_id = _uid AND item_id = _item_id
               AND (expires_at IS NULL OR expires_at > now())) THEN
    RAISE EXCEPTION '이미 보유한 아이템입니다.'; END IF;
  IF _rarity = 'RARE' AND EXISTS (SELECT 1 FROM user_items WHERE item_id = _item_id) THEN
    RAISE EXCEPTION 'RARE 아이템은 전 서버 1명만 소유할 수 있습니다. 이미 주인이 있습니다.'; END IF;
  UPDATE profiles SET game_points = game_points - _price
   WHERE id = _uid AND game_points - locked_points >= _price RETURNING game_points INTO _balance;
  IF _balance IS NULL THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;
  INSERT INTO user_items (user_id, item_id, source_type, expires_at)
  VALUES (_uid, _item_id, 'SHOP', CASE WHEN _days > 0 THEN now() + (_days || ' days')::interval ELSE NULL END)
  ON CONFLICT (user_id, item_id) DO UPDATE
    SET expires_at = CASE WHEN _days > 0
                          THEN GREATEST(COALESCE(user_items.expires_at, now()), now()) + (_days || ' days')::interval
                          ELSE NULL END,
        acquired_at = now(), source_type = 'SHOP';
  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, memo)
  SELECT _uid, 'item_purchase', -_price, _balance + _price, _balance, p.locked_points, p.locked_points, 'item', _item_id, '상점 아이템 구매'
    FROM profiles p WHERE p.id = _uid;
END $$;

-- ============ 2) 주간 랭킹 칭호: 참여자 수 무관 지급 + 7일 유효 ============
CREATE OR REPLACE FUNCTION public.grant_ranking_title_internal(_user_id uuid, _effect_key text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _item_id uuid;
BEGIN
  SELECT id INTO _item_id FROM items
   WHERE category = 'title' AND effect_key = _effect_key AND enabled = true LIMIT 1;
  IF _item_id IS NULL THEN RETURN false; END IF;
  INSERT INTO user_items (user_id, item_id, source_type, expires_at)
  VALUES (_user_id, _item_id, 'RANKING_REWARD', now() + interval '7 days')
  ON CONFLICT (user_id, item_id) DO UPDATE
    SET expires_at = GREATEST(COALESCE(user_items.expires_at, now()), now()) + interval '7 days',
        source_type = 'RANKING_REWARD';
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.admin_pay_weekly_rewards(_season_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _s weekly_ranking_seasons; _rate numeric; _min int := 20;
  _row record; _base numeric; _points bigint; _paid jsonb := '[]'::jsonb; _i int; _inserted uuid;
  _titles jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _s FROM weekly_ranking_seasons WHERE id = _season_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION '시즌을 찾을 수 없습니다.'; END IF;
  IF _s.status NOT IN ('FINALIZED','REWARDED') THEN RAISE EXCEPTION '시즌 확정 후에만 상금을 지급할 수 있습니다.'; END IF;
  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  _rate := COALESCE(_rate, 1);

  SELECT * INTO _row FROM weekly_deposit_stats
   WHERE season_id = _season_id AND rank_position = 1 AND net_deposit > 0;
  IF _row.user_id IS NOT NULL THEN
    IF grant_ranking_title_internal(_row.user_id, 'title_weekly_deposit') THEN
      _titles := _titles || jsonb_build_object('type','DEPOSIT','user_id',_row.user_id,'title','주간 입금랭커','expires_days',7);
    END IF;
    IF _s.deposit_participants >= _min THEN
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

  SELECT * INTO _row FROM weekly_gwang_stats
   WHERE season_id = _season_id AND rank_position = 1 AND total_gwang_wins > 0;
  IF _row.user_id IS NOT NULL AND grant_ranking_title_internal(_row.user_id, 'title_weekly_gwang') THEN
    _titles := _titles || jsonb_build_object('type','GWANG','user_id',_row.user_id,'title','주간 광땡랭커','expires_days',7);
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

  SELECT * INTO _row FROM weekly_profit_stats
   WHERE season_id = _season_id AND rank_position = 1 AND win_points > 0;
  IF _row.user_id IS NOT NULL THEN
    IF grant_ranking_title_internal(_row.user_id, 'title_weekly_profit') THEN
      _titles := _titles || jsonb_build_object('type','PROFIT','user_id',_row.user_id,'title','주간 수익왕','expires_days',7);
    END IF;
    IF _s.profit_participants >= _min THEN
      _inserted := NULL;
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
  VALUES (_uid, 'pay_weekly_rewards', 'weekly_season', _season_id,
          jsonb_build_object('paid', _paid, 'titles', _titles));
  RETURN jsonb_build_object('paid', _paid, 'titles', _titles, 'min_participants', _min);
END $$;

-- ============ 3) 관리자 대시보드 요약 ============
CREATE OR REPLACE FUNCTION public.admin_recent_activity(_limit integer DEFAULT 40)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _r jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  WITH signup AS (
    SELECT p.created_at AS at, 'SIGNUP' AS kind, p.nickname AS who, '회원가입' AS detail, 'OK' AS result
      FROM profiles p ORDER BY p.created_at DESC LIMIT 15
  ), usdt AS (
    SELECT c.credited_at AS at, 'USDT_CHARGE' AS kind, pr.nickname AS who,
           format('%s원 / %s USDT', c.requested_krw, c.expected_usdt) AS detail, c.status AS result
      FROM crypto_charge_requests c LEFT JOIN profiles pr ON pr.id = c.user_id
     WHERE c.credited_at IS NOT NULL ORDER BY c.credited_at DESC LIMIT 15
  ), wd AS (
    SELECT COALESCE(w.processed_at, w.requested_at) AS at, 'WITHDRAW' AS kind, pr.nickname AS who,
           format('%s P / %s원', w.requested_points, w.payout_amount) AS detail, w.status AS result
      FROM withdrawal_requests w LEFT JOIN profiles pr ON pr.id = w.user_id
     ORDER BY COALESCE(w.processed_at, w.requested_at) DESC LIMIT 15
  ), alog AS (
    SELECT l.created_at AS at, upper(l.action) AS kind,
           COALESCE(tp.nickname, ap.nickname) AS who,
           COALESCE(NULLIF(l.reason,''), l.target_type, '') AS detail,
           COALESCE(ap.nickname, '관리자') AS result
      FROM admin_logs l
      LEFT JOIN profiles ap ON ap.id = l.admin_id
      LEFT JOIN profiles tp ON tp.id = l.target_id
     WHERE l.action <> 'ADMIN_LOGIN' ORDER BY l.created_at DESC LIMIT 25
  ), revents AS (
    SELECT e.occurred_at AS at, e.event_type AS kind, e.nickname AS who,
           format('%s번방', e.room_number) AS detail, COALESCE(e.server_result,'-') AS result
      FROM room_event_logs e
     WHERE e.event_type IN ('AUTO_ROOM_KICK','BALANCE_INSUFFICIENT','FORCE_DELETE','SAFE_CLOSE')
     ORDER BY e.occurred_at DESC LIMIT 15
  ), findings AS (
    SELECT f.first_seen_at AS at, 'ALERT_'||f.code AS kind, f.subject_label AS who,
           COALESCE(f.reason, f.subject_type) AS detail, f.status AS result
      FROM integrity_findings f WHERE f.scope = 'OPERATION'
     ORDER BY f.first_seen_at DESC LIMIT 10
  ), merged AS (
    SELECT * FROM signup
    UNION ALL SELECT * FROM usdt
    UNION ALL SELECT * FROM wd
    UNION ALL SELECT * FROM alog
    UNION ALL SELECT * FROM revents
    UNION ALL SELECT * FROM findings
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', at, 'kind', kind, 'who', who,
                                               'detail', detail, 'result', result)
                            ORDER BY at DESC), '[]'::jsonb)
    INTO _r
    FROM (SELECT * FROM merged WHERE at IS NOT NULL ORDER BY at DESC LIMIT GREATEST(_limit, 10)) m;
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION public.admin_recent_activity(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_recent_activity(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_dashboard_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _today date; _r jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  _today := (now() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT jsonb_build_object(
    'checkedAt', now(),
    'members', (SELECT count(*) FROM profiles),
    'onlineNow', (SELECT count(*) FROM profiles WHERE last_seen_at > now() - interval '5 minutes'),
    'inGameNow', (SELECT count(DISTINCT grp.user_id) FROM game_round_players grp
                    JOIN game_rounds r ON r.id = grp.round_id
                   WHERE r.status NOT IN ('finished','cancelled')),
    'activeRooms', (SELECT count(*) FROM game_rooms
                     WHERE deleted_at IS NULL AND status NOT IN ('closed','deleted')),
    'playingRooms', (SELECT count(*) FROM game_rooms WHERE deleted_at IS NULL AND status = 'playing'),
    'newSignupsToday', (SELECT count(*) FROM profiles
                         WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = _today),
    'usdtChargeToday', (SELECT COALESCE(sum(requested_krw),0) FROM crypto_charge_requests
                         WHERE status = 'CREDITED' AND credited_at IS NOT NULL
                           AND (credited_at AT TIME ZONE 'Asia/Seoul')::date = _today),
    'usdtChargeTodayCount', (SELECT count(*) FROM crypto_charge_requests
                              WHERE status = 'CREDITED' AND credited_at IS NOT NULL
                                AND (credited_at AT TIME ZONE 'Asia/Seoul')::date = _today),
    'withdrawRequestedToday', (SELECT COALESCE(sum(payout_amount),0) FROM withdrawal_requests
                                WHERE (requested_at AT TIME ZONE 'Asia/Seoul')::date = _today),
    'withdrawPaidToday', (SELECT COALESCE(sum(payout_amount),0) FROM withdrawal_requests
                           WHERE status = 'PAID' AND processed_at IS NOT NULL
                             AND (processed_at AT TIME ZONE 'Asia/Seoul')::date = _today),
    'pendingWithdrawCount', (SELECT count(*) FROM withdrawal_requests
                              WHERE status IN ('REQUESTED','REVIEWING','APPROVED')),
    'pendingChargeCount', (SELECT count(*) FROM charge_requests
                            WHERE status IN ('REQUESTED','REVIEWING')),
    'circulatingPoints', (SELECT COALESCE(sum(game_points),0) FROM profiles),
    'lockedPoints', (SELECT COALESCE(sum(locked_points),0) FROM profiles),
    'affiliateUnsettled', (SELECT COALESCE(sum(commission_amount),0) FROM affiliate_commissions
                            WHERE status IN ('PENDING','UNSETTLED')),
    'affiliateUnsettledCount', (SELECT count(*) FROM affiliate_commissions
                                 WHERE status IN ('PENDING','UNSETTLED')),
    'roundsToday', (SELECT count(*) FROM game_rounds
                     WHERE (started_at AT TIME ZONE 'Asia/Seoul')::date = _today),
    'ops', jsonb_build_object(
      'gameCoreVersion', (SELECT value#>>'{}' FROM app_settings WHERE key = 'game_core_version'),
      'gameSecurityVersion', (SELECT value#>>'{}' FROM app_settings WHERE key = 'game_security_version'),
      'appMode', (SELECT value#>>'{}' FROM app_settings WHERE key = 'app_mode'),
      'maintenance', COALESCE((SELECT (value#>>'{}')::boolean FROM app_settings WHERE key = 'maintenance_enabled'), false),
      'gameLock', COALESCE((SELECT (value#>>'{}')::boolean FROM app_settings WHERE key = 'game_lock'), false),
      'testDriverEnabled', COALESCE((SELECT (value#>>'{}')::boolean FROM app_settings WHERE key = 'test_driver_enabled'), false),
      'cryptoEnabled', COALESCE((SELECT (value#>>'{}')::boolean FROM app_settings WHERE key = 'crypto_charge_enabled'), false),
      'watcherLastSuccessAt', (SELECT value#>>'{}' FROM app_settings WHERE key = 'crypto_watcher_last_success_at'),
      'watcherLockStatus', (SELECT value#>>'{}' FROM app_settings WHERE key = 'crypto_watcher_lock_status'),
      'watcherFailStreak', COALESCE((SELECT (value#>>'{}')::int FROM app_settings WHERE key = 'crypto_watcher_fail_streak'), 0),
      'recentGameErrors', (SELECT count(*) FROM game_error_logs WHERE occurred_at > now() - interval '15 minutes'),
      'openFindings', (SELECT count(*) FROM integrity_findings WHERE status = 'OPEN' AND scope = 'OPERATION'),
      'stuckRounds', (SELECT count(*) FROM game_rounds
                       WHERE status NOT IN ('finished','cancelled') AND last_activity_at < now() - interval '5 minutes')
    )
  ) INTO _r;
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION public.admin_dashboard_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_overview() TO authenticated, service_role;

-- ============ 4) 관리자 통합 검색 ============
CREATE OR REPLACE FUNCTION public.admin_global_search(_q text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _n text; _num int;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  _n := btrim(COALESCE(_q,''));
  IF length(_n) < 2 THEN
    RETURN jsonb_build_object('members','[]'::jsonb,'rooms','[]'::jsonb,'affiliates','[]'::jsonb,
                              'transactions','[]'::jsonb,'withdrawals','[]'::jsonb);
  END IF;
  _num := CASE WHEN _n ~ '^[0-9]+$' THEN _n::int ELSE NULL END;

  RETURN jsonb_build_object(
    'members', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT p.id, p.username, p.nickname, p.rank, p.game_points, p.status
          FROM profiles p
         WHERE p.nickname ILIKE '%'||_n||'%' OR COALESCE(p.username,'') ILIKE '%'||_n||'%'
            OR p.id::text = _n
         ORDER BY p.nickname LIMIT 10) x), '[]'::jsonb),
    'rooms', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT r.id, r.room_number, r.title, r.status, r.game_mode, r.current_players
          FROM game_rooms r
         WHERE (_num IS NOT NULL AND r.room_number = _num) OR r.title ILIKE '%'||_n||'%' OR r.id::text = _n
         ORDER BY r.created_at DESC LIMIT 10) x), '[]'::jsonb),
    'affiliates', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT a.id, a.affiliate_code, a.status, p.nickname
          FROM affiliates a LEFT JOIN profiles p ON p.id = a.user_id
         WHERE a.affiliate_code ILIKE '%'||_n||'%' OR COALESCE(p.nickname,'') ILIKE '%'||_n||'%'
         LIMIT 10) x), '[]'::jsonb),
    'transactions', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT c.id, c.txid, c.status, c.requested_krw, c.expected_usdt, c.created_at, p.nickname
          FROM crypto_charge_requests c LEFT JOIN profiles p ON p.id = c.user_id
         WHERE COALESCE(c.txid,'') ILIKE '%'||_n||'%' OR c.id::text = _n
         ORDER BY c.created_at DESC LIMIT 10) x), '[]'::jsonb),
    'withdrawals', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT w.id, w.status, w.requested_points, w.payout_amount, w.requested_at, p.nickname
          FROM withdrawal_requests w LEFT JOIN profiles p ON p.id = w.user_id
         WHERE w.id::text = _n OR COALESCE(p.nickname,'') ILIKE '%'||_n||'%'
         ORDER BY w.requested_at DESC LIMIT 10) x), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_global_search(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_global_search(text) TO authenticated, service_role;