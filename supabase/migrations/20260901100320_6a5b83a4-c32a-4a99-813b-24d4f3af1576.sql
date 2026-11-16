-- =========================================================
-- 주간 시즌 / 랭킹 계산 함수 (Asia/Seoul 월 00:00 ~ 일 23:59:59)
-- =========================================================
CREATE OR REPLACE FUNCTION public.seoul_week_start(_ts timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT (date_trunc('week', (_ts AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul');
$$;

CREATE OR REPLACE FUNCTION public.seoul_week_key(_ts timestamptz DEFAULT now())
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT to_char(date_trunc('week', (_ts AT TIME ZONE 'Asia/Seoul')), 'IYYY-"W"IW');
$$;

CREATE OR REPLACE FUNCTION public.ensure_weekly_season()
RETURNS public.weekly_ranking_seasons LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _start timestamptz := seoul_week_start(); _key text := seoul_week_key(); _row weekly_ranking_seasons;
BEGIN
  UPDATE weekly_ranking_seasons SET status = 'CALCULATING'
   WHERE status = 'ACTIVE' AND ends_at < now();
  SELECT * INTO _row FROM weekly_ranking_seasons WHERE week_key = _key;
  IF _row.id IS NULL THEN
    INSERT INTO weekly_ranking_seasons (week_key, starts_at, ends_at)
    VALUES (_key, _start, _start + interval '7 days' - interval '1 second')
    ON CONFLICT (week_key) DO NOTHING;
    SELECT * INTO _row FROM weekly_ranking_seasons WHERE week_key = _key;
  END IF;
  RETURN _row;
END; $$;
REVOKE ALL ON FUNCTION public.ensure_weekly_season() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_weekly_season() TO authenticated;

CREATE OR REPLACE FUNCTION public.weekly_deposit_ranking(_season_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE (user_id uuid, nickname text, rank public.app_rank, charge_amount numeric,
               withdraw_amount numeric, net_deposit numeric, charge_count integer,
               rank_position bigint, last_event_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH s AS (SELECT starts_at, ends_at FROM weekly_ranking_seasons WHERE id = _season_id),
  ch AS (
    SELECT c.user_id, SUM(c.requested_amount) AS amt, COUNT(*)::int AS cnt, MAX(c.processed_at) AS last_at
      FROM charge_requests c, s
     WHERE c.status = 'APPROVED' AND c.processed_at BETWEEN s.starts_at AND s.ends_at
     GROUP BY c.user_id),
  wd AS (
    SELECT w.user_id, SUM(w.payout_amount) AS amt, MAX(w.processed_at) AS last_at
      FROM withdrawal_requests w, s
     WHERE w.status = 'PAID' AND w.processed_at BETWEEN s.starts_at AND s.ends_at
     GROUP BY w.user_id)
  SELECT p.id, p.nickname, p.rank,
         COALESCE(ch.amt,0), COALESCE(wd.amt,0),
         COALESCE(ch.amt,0) - COALESCE(wd.amt,0), COALESCE(ch.cnt,0),
         ROW_NUMBER() OVER (ORDER BY COALESCE(ch.amt,0) - COALESCE(wd.amt,0) DESC,
                            COALESCE(ch.last_at, now()) ASC),
         GREATEST(COALESCE(ch.last_at, '-infinity'::timestamptz), COALESCE(wd.last_at,'-infinity'::timestamptz))
    FROM ch
    JOIN profiles p ON p.id = ch.user_id
    LEFT JOIN wd ON wd.user_id = ch.user_id
   ORDER BY 6 DESC
   LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.weekly_gwang_ranking(_season_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE (user_id uuid, nickname text, rank public.app_rank, gwang38_wins integer,
               gwang18_wins integer, gwang13_wins integer, total_gwang_wins integer,
               games_played integer, rank_position bigint, last_gwang_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH s AS (SELECT starts_at, ends_at FROM weekly_ranking_seasons WHERE id = _season_id),
  rp AS (
    SELECT grp.user_id, grp.result_type, grp.hand_rank, r.finished_at
      FROM game_round_players grp
      JOIN game_rounds r ON r.id = grp.round_id
      JOIN s ON true
     WHERE r.settlement_status = 'SETTLED'
       AND COALESCE(r.finished_at, r.started_at) BETWEEN s.starts_at AND s.ends_at),
  agg AS (
    SELECT user_id,
      COUNT(*)::int AS games,
      COUNT(*) FILTER (WHERE result_type = 'WIN' AND hand_rank IN ('38광땡','kwang38'))::int AS g38,
      COUNT(*) FILTER (WHERE result_type = 'WIN' AND hand_rank IN ('18광땡','kwang18'))::int AS g18,
      COUNT(*) FILTER (WHERE result_type = 'WIN' AND hand_rank IN ('13광땡','kwang13'))::int AS g13,
      MAX(finished_at) FILTER (WHERE result_type = 'WIN'
        AND hand_rank IN ('38광땡','18광땡','13광땡','kwang38','kwang18','kwang13')) AS last_at
      FROM rp GROUP BY user_id)
  SELECT p.id, p.nickname, p.rank, a.g38, a.g18, a.g13, (a.g38+a.g18+a.g13), a.games,
         ROW_NUMBER() OVER (ORDER BY (a.g38+a.g18+a.g13) DESC, a.g38 DESC, a.g18 DESC, a.g13 DESC,
                            COALESCE(a.last_at, now()) ASC),
         a.last_at
    FROM agg a JOIN profiles p ON p.id = a.user_id
   ORDER BY 9
   LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.weekly_profit_ranking(_season_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE (user_id uuid, nickname text, rank public.app_rank, win_points bigint,
               win_count integer, games_played integer, rank_position bigint, last_win_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH s AS (SELECT starts_at, ends_at FROM weekly_ranking_seasons WHERE id = _season_id),
  games AS (
    SELECT grp.user_id, COUNT(*)::int AS games
      FROM game_round_players grp JOIN game_rounds r ON r.id = grp.round_id JOIN s ON true
     WHERE r.settlement_status = 'SETTLED'
       AND COALESCE(r.finished_at, r.started_at) BETWEEN s.starts_at AND s.ends_at
     GROUP BY grp.user_id),
  win AS (
    SELECT t.user_id, SUM(t.amount)::bigint AS pts, COUNT(*)::int AS cnt, MAX(t.created_at) AS last_at
      FROM point_transactions t
      JOIN game_rounds r ON r.id = t.reference_id AND r.settlement_status = 'SETTLED'
      JOIN s ON true
     WHERE t.type = 'game_win' AND t.reference_type = 'game_round'
       AND t.created_at BETWEEN s.starts_at AND s.ends_at
     GROUP BY t.user_id)
  SELECT p.id, p.nickname, p.rank, COALESCE(w.pts,0), COALESCE(w.cnt,0), g.games,
         ROW_NUMBER() OVER (ORDER BY COALESCE(w.pts,0) DESC, COALESCE(w.cnt,0) DESC,
                            COALESCE(w.last_at, now()) ASC),
         w.last_at
    FROM games g JOIN profiles p ON p.id = g.user_id
    LEFT JOIN win w ON w.user_id = g.user_id
   ORDER BY 7
   LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.admin_recalc_weekly_season(_season_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _s weekly_ranking_seasons; _total numeric;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _s FROM weekly_ranking_seasons WHERE id = _season_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION '시즌을 찾을 수 없습니다.'; END IF;
  IF _s.status IN ('FINALIZED','REWARDED') AND NOT has_role(_uid,'super_admin') THEN
    RAISE EXCEPTION '확정된 시즌은 최고관리자만 정정할 수 있습니다.';
  END IF;
  IF _s.status IN ('FINALIZED','REWARDED') AND COALESCE(trim(_reason),'') = '' THEN
    RAISE EXCEPTION '확정 시즌 정정에는 사유가 필요합니다.';
  END IF;

  DELETE FROM weekly_deposit_stats WHERE season_id = _season_id;
  INSERT INTO weekly_deposit_stats (season_id, user_id, charge_amount, withdraw_amount, net_deposit, charge_count, rank_position, last_event_at)
  SELECT _season_id, d.user_id, d.charge_amount, d.withdraw_amount, d.net_deposit, d.charge_count, d.rank_position, d.last_event_at
    FROM weekly_deposit_ranking(_season_id, 100000) d;

  DELETE FROM weekly_gwang_stats WHERE season_id = _season_id;
  INSERT INTO weekly_gwang_stats (season_id, user_id, gwang38_wins, gwang18_wins, gwang13_wins, total_gwang_wins, games_played, rank_position, last_gwang_at)
  SELECT _season_id, g.user_id, g.gwang38_wins, g.gwang18_wins, g.gwang13_wins, g.total_gwang_wins, g.games_played, g.rank_position, g.last_gwang_at
    FROM weekly_gwang_ranking(_season_id, 100000) g;

  DELETE FROM weekly_profit_stats WHERE season_id = _season_id;
  INSERT INTO weekly_profit_stats (season_id, user_id, win_points, win_count, games_played, rank_position, last_win_at)
  SELECT _season_id, w.user_id, w.win_points, w.win_count, w.games_played, w.rank_position, w.last_win_at
    FROM weekly_profit_ranking(_season_id, 100000) w;

  SELECT COALESCE(SUM(c.requested_amount),0) INTO _total FROM charge_requests c
   WHERE c.status = 'APPROVED' AND c.processed_at BETWEEN _s.starts_at AND _s.ends_at;

  UPDATE weekly_ranking_seasons SET
    total_charge_amount = _total,
    deposit_participants = (SELECT count(*) FROM weekly_deposit_stats WHERE season_id = _season_id),
    gwang_participants = (SELECT count(*) FROM weekly_gwang_stats WHERE season_id = _season_id),
    profit_participants = (SELECT count(*) FROM weekly_profit_stats WHERE season_id = _season_id)
  WHERE id = _season_id;

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (_uid, 'recalc_weekly_season', 'weekly_season', _season_id, _reason,
          jsonb_build_object('total_charge', _total));

  RETURN (SELECT to_jsonb(x) FROM weekly_ranking_seasons x WHERE id = _season_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_recalc_weekly_season(uuid, text) FROM anon;

CREATE OR REPLACE FUNCTION public.admin_finalize_weekly_season(_season_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _s weekly_ranking_seasons;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _s FROM weekly_ranking_seasons WHERE id = _season_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION '시즌을 찾을 수 없습니다.'; END IF;
  IF _s.status IN ('FINALIZED','REWARDED') THEN RETURN; END IF;
  PERFORM admin_recalc_weekly_season(_season_id, NULL);
  UPDATE weekly_ranking_seasons SET status = 'FINALIZED', finalized_at = now() WHERE id = _season_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id)
  VALUES (_uid, 'finalize_weekly_season', 'weekly_season', _season_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_finalize_weekly_season(uuid) FROM anon;

-- =========================================================
-- 랭킹 상금 지급 (중복 지급 불가 / 최소 참여 20명)
-- =========================================================
CREATE OR REPLACE FUNCTION public.grant_points_internal(
  _user_id uuid, _amount bigint, _type text, _memo text,
  _ref_type text DEFAULT NULL, _ref_id uuid DEFAULT NULL, _admin uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p profiles;
BEGIN
  IF _amount = 0 THEN RETURN; END IF;
  SELECT * INTO _p FROM profiles WHERE id = _user_id FOR UPDATE;
  IF _p.id IS NULL THEN RETURN; END IF;
  UPDATE profiles SET game_points = game_points + _amount WHERE id = _user_id;
  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after,
    locked_before, locked_after, reference_type, reference_id, admin_id, memo)
  VALUES (_user_id, _type, _amount, _p.game_points, _p.game_points + _amount,
    _p.locked_points, _p.locked_points, _ref_type, _ref_id, _admin, _memo);
END; $$;
REVOKE ALL ON FUNCTION public.grant_points_internal(uuid,bigint,text,text,text,uuid,uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_pay_weekly_rewards(_season_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _s weekly_ranking_seasons; _rate numeric; _min int := 20;
  _row record; _base numeric; _points bigint; _paid jsonb := '[]'::jsonb; _i int; _inserted uuid;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _s FROM weekly_ranking_seasons WHERE id = _season_id FOR UPDATE;
  IF _s.id IS NULL THEN RAISE EXCEPTION '시즌을 찾을 수 없습니다.'; END IF;
  IF _s.status NOT IN ('FINALIZED','REWARDED') THEN RAISE EXCEPTION '시즌 확정 후에만 상금을 지급할 수 있습니다.'; END IF;
  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  _rate := COALESCE(_rate, 10);

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
END; $$;
REVOKE ALL ON FUNCTION public.admin_pay_weekly_rewards(uuid) FROM anon;

-- =========================================================
-- 계급 시스템
-- =========================================================
CREATE TABLE public.rank_requirements (
  rank public.app_rank PRIMARY KEY,
  sort_order integer NOT NULL,
  label text NOT NULL,
  min_charge_amount numeric NOT NULL DEFAULT 0,
  min_charge_count integer NOT NULL DEFAULT 0,
  min_attendance integer NOT NULL DEFAULT 0,
  points_reward bigint NOT NULL DEFAULT 0
);
GRANT SELECT ON public.rank_requirements TO authenticated, anon;
GRANT ALL ON public.rank_requirements TO service_role;
ALTER TABLE public.rank_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "계급 조건 조회" ON public.rank_requirements FOR SELECT USING (true);

INSERT INTO public.rank_requirements (rank, sort_order, label, min_charge_amount, min_charge_count, min_attendance, points_reward) VALUES
  ('UNRANKED',0,'언랭크',0,0,0,10000),
  ('BRONZE',1,'브론즈',1000000,0,3,10000),
  ('SILVER',2,'실버',5000000,0,15,30000),
  ('GOLD',3,'골드',10000000,0,30,100000),
  ('DIAMOND',4,'다이아몬드',20000000,30,0,300000),
  ('CHALLENGER',5,'챌린저',50000000,0,0,500000);

CREATE OR REPLACE FUNCTION public.evaluate_member_rank(_user_id uuid)
RETURNS public.app_rank LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _p profiles; _amt numeric; _cnt integer; _att integer; _cur int; _req rank_requirements; _items jsonb;
BEGIN
  SELECT * INTO _p FROM profiles WHERE id = _user_id FOR UPDATE;
  IF _p.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(requested_amount),0), COUNT(*)::int INTO _amt, _cnt
    FROM charge_requests WHERE user_id = _user_id AND status = 'APPROVED';
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
END; $$;
REVOKE ALL ON FUNCTION public.evaluate_member_rank(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.sync_my_rank()
RETURNS public.app_rank LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _items jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rank_reward_claims WHERE user_id = _uid AND rank = 'UNRANKED') THEN
    INSERT INTO user_items (user_id, item_id, source_type, source_rank)
    SELECT _uid, i.id, 'RANK_REWARD', 'UNRANKED' FROM items i
     WHERE i.rank_required = 'UNRANKED' AND i.enabled = true
    ON CONFLICT DO NOTHING;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category)),'[]'::jsonb)
      INTO _items FROM items i WHERE i.rank_required = 'UNRANKED' AND i.enabled = true;
    INSERT INTO rank_reward_claims (user_id, rank, points_reward, items_reward)
    VALUES (_uid, 'UNRANKED', 10000, _items) ON CONFLICT (user_id, rank) DO NOTHING;
    IF FOUND THEN
      PERFORM grant_points_internal(_uid, 10000, 'rank_reward', '언랭크 가입 보상', 'rank', NULL, NULL);
    END IF;
  END IF;
  RETURN evaluate_member_rank(_uid);
END; $$;
REVOKE ALL ON FUNCTION public.sync_my_rank() FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_my_rank() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_daily_attendance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _today date := (now() AT TIME ZONE 'Asia/Seoul')::date; _new boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  INSERT INTO user_attendance (user_id, attend_date) VALUES (_uid, _today)
  ON CONFLICT (user_id, attend_date) DO NOTHING;
  _new := FOUND;
  PERFORM evaluate_member_rank(_uid);
  RETURN jsonb_build_object('checked_in', _new, 'date', _today,
    'attendance_count', (SELECT attendance_count FROM profiles WHERE id = _uid),
    'rank', (SELECT rank FROM profiles WHERE id = _uid));
END; $$;
REVOKE ALL ON FUNCTION public.claim_daily_attendance() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_attendance() TO authenticated;

-- =========================================================
-- 충전 레이크 면제권 + 충전 신청/승인 (충전 7% / 출금 0% 정책 유지)
-- =========================================================
CREATE OR REPLACE FUNCTION public.request_charge_with_ticket(
  _amount numeric, _depositor_name text, _note text DEFAULT NULL, _use_ticket boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid(); _rate numeric; _fee_rate numeric; _ticket uuid; _fee numeric;
  _base numeric; _points bigint; _req uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION '충전 금액이 올바르지 않습니다.'; END IF;
  IF COALESCE(trim(_depositor_name),'') = '' THEN RAISE EXCEPTION '입금자명을 입력해 주세요.'; END IF;

  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  SELECT (value#>>'{}')::numeric INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
  _rate := COALESCE(_rate, 10); _fee_rate := COALESCE(_fee_rate, 0.07);

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
END; $$;
REVOKE ALL ON FUNCTION public.request_charge_with_ticket(numeric, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_charge_with_ticket(numeric, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_charge_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _r charge_requests;
BEGIN
  SELECT * INTO _r FROM charge_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL OR _r.user_id <> _uid THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
  IF _r.status NOT IN ('REQUESTED','REVIEWING') THEN RAISE EXCEPTION '이미 처리된 신청입니다.'; END IF;
  UPDATE charge_requests SET status = 'CANCELLED' WHERE id = _request_id;
  UPDATE rake_free_tickets SET status = 'ISSUED', reserved_at = NULL, charge_request_id = NULL
   WHERE id = _r.rake_free_ticket_id AND status = 'RESERVED';
END; $$;
REVOKE ALL ON FUNCTION public.cancel_my_charge_request(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_charge_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_process_charge(_request_id uuid, _status text, _admin_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    _rate := COALESCE(_rate, 10); _fee_rate := COALESCE(_fee_rate, 0.07); _comm_rate := COALESCE(_comm_rate, 0.02);

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
END; $$;
REVOKE ALL ON FUNCTION public.admin_process_charge(uuid, text, text) FROM anon;

-- =========================================================
-- 계급 전용 아이템 (판매 금지 / RANK_REWARD 만 획득)
-- =========================================================
INSERT INTO public.items (category, name, description, price, enabled, for_sale, source_type, rank_required, effect_key) VALUES
  ('profile_frame','ANGEL ROOKIE 프레임','언랭크 전용 프로필 프레임',0,true,false,'RANK_REWARD','UNRANKED','frame_unranked'),
  ('card_back','Rookie 카드 뒷면','언랭크 기본 카드 뒷면',0,true,false,'RANK_REWARD','UNRANKED','back_unranked'),
  ('emote','웰컴 이모티콘 3종','가입 축하 이모티콘 세트',0,true,false,'RANK_REWARD','UNRANKED','emote_welcome'),
  ('profile_frame','브론즈 천사 프레임','브론즈 계급 프로필 프레임',0,true,false,'RANK_REWARD','BRONZE','frame_bronze'),
  ('card_back','브론즈 카드 뒷면','브론즈 계급 카드 뒷면',0,true,false,'RANK_REWARD','BRONZE','back_bronze'),
  ('title','BRONZE 계급 배지','브론즈 계급 배지',0,true,false,'RANK_REWARD','BRONZE','badge_bronze'),
  ('emote','브론즈 전용 이모티콘','브론즈 채팅 이모티콘',0,true,false,'RANK_REWARD','BRONZE','emote_bronze'),
  ('card_skin','실버 카드 스킨','실버 계급 카드 프레임 스킨',0,true,false,'RANK_REWARD','SILVER','skin_silver'),
  ('profile_frame','실버 천사 프레임','실버 계급 프로필 프레임',0,true,false,'RANK_REWARD','SILVER','frame_silver'),
  ('name_effect','실버 닉네임 글로우','은빛 미세 글로우',0,true,false,'RANK_REWARD','SILVER','name_silver'),
  ('win_effect','실버 승리 스파클','승리 시 은빛 스파클',0,true,false,'RANK_REWARD','SILVER','win_silver'),
  ('card_skin','골드 카드 풀 스킨','골드 계급 카드 풀 스킨',0,true,false,'RANK_REWARD','GOLD','skin_gold'),
  ('table_skin','골드 테이블 스킨','다크 월넛 + 골드 라인',0,true,false,'RANK_REWARD','GOLD','table_gold'),
  ('profile_frame','골드 왕관 프레임','골드 왕관 프로필 프레임',0,true,false,'RANK_REWARD','GOLD','frame_gold'),
  ('name_effect','닉네임 골드 글로우','황금 글로우',0,true,false,'RANK_REWARD','GOLD','name_gold'),
  ('pot_effect','골드 POT 획득 효과','황금 코인 궤적',0,true,false,'RANK_REWARD','GOLD','pot_gold'),
  ('entry_effect','GOLD 입장 효과','1초 황금빛 등장',0,true,false,'RANK_REWARD','GOLD','entry_gold'),
  ('card_skin','다이아몬드 카드 풀 스킨','다이아 계급 카드 풀 스킨',0,true,false,'RANK_REWARD','DIAMOND','skin_diamond'),
  ('table_skin','다이아몬드 테이블 스킨','블랙 메탈 + 다이아 결정 라인',0,true,false,'RANK_REWARD','DIAMOND','table_diamond'),
  ('profile_frame','다이아 천사날개 프레임','다이아 날개 프로필 프레임',0,true,false,'RANK_REWARD','DIAMOND','frame_diamond'),
  ('name_effect','다이아 닉네임 효과','백금/블루 다이아 쉬머',0,true,false,'RANK_REWARD','DIAMOND','name_diamond'),
  ('entry_effect','다이아 입장 효과','다이아 결정 파티클',0,true,false,'RANK_REWARD','DIAMOND','entry_diamond'),
  ('win_effect','다이아 승리 효과','다이아 파티클 승리 연출',0,true,false,'RANK_REWARD','DIAMOND','win_diamond'),
  ('showdown_effect','다이아 SHOWDOWN 효과','카드 공개 순간 다이아 라인',0,true,false,'RANK_REWARD','DIAMOND','showdown_diamond'),
  ('pot_effect','다이아 POT 효과','다이아 파티클 POT 획득',0,true,false,'RANK_REWARD','DIAMOND','pot_diamond'),
  ('emote','다이아 전용 이모티콘','다이아 이모티콘 세트',0,true,false,'RANK_REWARD','DIAMOND','emote_diamond'),
  ('card_skin','CHALLENGER 한정 카드 풀 세트','챌린저 한정 카드 세트',0,true,false,'RANK_REWARD','CHALLENGER','skin_challenger'),
  ('table_skin','CHALLENGER 테이블 스킨','블랙/골드 천사 문양 + 황금 날개 워터마크',0,true,false,'RANK_REWARD','CHALLENGER','table_challenger'),
  ('profile_frame','거대한 황금 천사날개 왕관 프레임','챌린저 왕관 프레임',0,true,false,'RANK_REWARD','CHALLENGER','frame_challenger'),
  ('name_effect','황금 닉네임 애니메이션','황금빛이 흐르는 닉네임',0,true,false,'RANK_REWARD','CHALLENGER','name_challenger'),
  ('entry_effect','CHALLENGER 입장 연출','천사날개 전개 + 왕관 심볼',0,true,false,'RANK_REWARD','CHALLENGER','entry_challenger'),
  ('win_effect','CHALLENGER 승리 연출','황금 천사 승리 연출',0,true,false,'RANK_REWARD','CHALLENGER','win_challenger'),
  ('pot_effect','CHALLENGER POT 연출','황금 날개 궤적 + 왕관 플래시',0,true,false,'RANK_REWARD','CHALLENGER','pot_challenger'),
  ('showdown_effect','CHALLENGER SHOWDOWN 연출','대형 ANGEL 문양 + 황금 후광',0,true,false,'RANK_REWARD','CHALLENGER','showdown_challenger'),
  ('emote','CHALLENGER 이모티콘 세트','챌린저 이모티콘',0,true,false,'RANK_REWARD','CHALLENGER','emote_challenger'),
  ('title','영구 CHALLENGER 훈장','최상위 플레이어 훈장',0,true,false,'RANK_REWARD','CHALLENGER','title_challenger');