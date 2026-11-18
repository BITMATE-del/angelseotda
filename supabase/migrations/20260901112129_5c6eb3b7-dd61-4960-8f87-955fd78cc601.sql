-- 1) 랭킹/통계에서 테스트 계정 제외
CREATE OR REPLACE FUNCTION public.weekly_deposit_ranking(_season_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE(user_id uuid, nickname text, rank app_rank, charge_amount numeric, withdraw_amount numeric, net_deposit numeric, charge_count integer, rank_position bigint, last_event_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    JOIN profiles p ON p.id = ch.user_id AND p.is_test_user = false
    LEFT JOIN wd ON wd.user_id = ch.user_id
   ORDER BY 6 DESC
   LIMIT _limit;
$function$;

CREATE OR REPLACE FUNCTION public.weekly_gwang_ranking(_season_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE(user_id uuid, nickname text, rank app_rank, gwang38_wins integer, gwang18_wins integer, gwang13_wins integer, total_gwang_wins integer, games_played integer, rank_position bigint, last_gwang_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH s AS (SELECT starts_at, ends_at FROM weekly_ranking_seasons WHERE id = _season_id),
  rp AS (
    SELECT grp.user_id, grp.result_type, grp.hand_rank, r.finished_at
      FROM game_round_players grp
      JOIN game_rounds r ON r.id = grp.round_id
      JOIN game_rooms rm ON rm.id = r.room_id
      JOIN s ON true
     WHERE r.settlement_status = 'SETTLED' AND rm.is_test_room = false
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
    FROM agg a JOIN profiles p ON p.id = a.user_id AND p.is_test_user = false
   ORDER BY 9
   LIMIT _limit;
$function$;

CREATE OR REPLACE FUNCTION public.weekly_profit_ranking(_season_id uuid, _limit integer DEFAULT 100)
RETURNS TABLE(user_id uuid, nickname text, rank app_rank, win_points bigint, win_count integer, games_played integer, rank_position bigint, last_win_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH s AS (SELECT starts_at, ends_at FROM weekly_ranking_seasons WHERE id = _season_id),
  games AS (
    SELECT grp.user_id, COUNT(*)::int AS games
      FROM game_round_players grp
      JOIN game_rounds r ON r.id = grp.round_id
      JOIN game_rooms rm ON rm.id = r.room_id
      JOIN s ON true
     WHERE r.settlement_status = 'SETTLED' AND rm.is_test_room = false
       AND COALESCE(r.finished_at, r.started_at) BETWEEN s.starts_at AND s.ends_at
     GROUP BY grp.user_id),
  win AS (
    SELECT t.user_id, SUM(t.amount)::bigint AS pts, COUNT(*)::int AS cnt, MAX(t.created_at) AS last_at
      FROM point_transactions t
      JOIN game_rounds r ON r.id = t.reference_id AND r.settlement_status = 'SETTLED'
      JOIN game_rooms rm ON rm.id = r.room_id AND rm.is_test_room = false
      JOIN s ON true
     WHERE t.type = 'game_win' AND t.reference_type = 'game_round'
       AND t.created_at BETWEEN s.starts_at AND s.ends_at
     GROUP BY t.user_id)
  SELECT p.id, p.nickname, p.rank, COALESCE(w.pts,0), COALESCE(w.cnt,0), g.games,
         ROW_NUMBER() OVER (ORDER BY COALESCE(w.pts,0) DESC, COALESCE(w.cnt,0) DESC,
                            COALESCE(w.last_at, now()) ASC),
         w.last_at
    FROM games g JOIN profiles p ON p.id = g.user_id AND p.is_test_user = false
    LEFT JOIN win w ON w.user_id = g.user_id
   ORDER BY 7
   LIMIT _limit;
$function$;

-- 주간 총 충전액도 테스트 계정 제외
CREATE OR REPLACE FUNCTION public.admin_recalc_weekly_season(_season_id uuid, _reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    JOIN profiles p ON p.id = c.user_id AND p.is_test_user = false
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
END; $function$;

-- 2) 인덱스 점검
CREATE INDEX IF NOT EXISTS game_rooms_status_idx ON public.game_rooms (status);
CREATE INDEX IF NOT EXISTS game_rounds_room_status_idx ON public.game_rounds (room_id, status);
CREATE INDEX IF NOT EXISTS game_rounds_settlement_idx ON public.game_rounds (settlement_status);
CREATE INDEX IF NOT EXISTS game_round_players_round_idx ON public.game_round_players (round_id, user_id);
CREATE INDEX IF NOT EXISTS game_actions_round_idx ON public.game_actions (round_id);
CREATE INDEX IF NOT EXISTS game_cards_round_user_idx ON public.game_cards (round_id, user_id);
CREATE INDEX IF NOT EXISTS point_transactions_user_created_idx ON public.point_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS point_transactions_ref_idx ON public.point_transactions (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS charge_requests_status_idx ON public.charge_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx ON public.withdrawal_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_members_member_idx ON public.affiliate_members (member_user_id);
CREATE INDEX IF NOT EXISTS weekly_deposit_stats_season_idx ON public.weekly_deposit_stats (season_id, user_id);
CREATE INDEX IF NOT EXISTS weekly_gwang_stats_season_idx ON public.weekly_gwang_stats (season_id, user_id);
CREATE INDEX IF NOT EXISTS weekly_profit_stats_season_idx ON public.weekly_profit_stats (season_id, user_id);
CREATE INDEX IF NOT EXISTS chat_messages_room_created_idx ON public.chat_messages (room_id, created_at DESC);