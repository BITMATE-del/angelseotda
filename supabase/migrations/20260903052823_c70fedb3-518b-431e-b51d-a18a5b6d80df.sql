-- 카드 무결성 검사 오탐 교정: FOLD 이후 남은 카드가 배분되지 않는 정상 진행을 오류로 보지 않는다.
-- (게임 배분/정산 로직은 변경하지 않고, 관리자 점검 쿼리만 수정)
CREATE OR REPLACE FUNCTION public.admin_integrity_card_check()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT r.id AS round_id, r.game_mode, c.total_cards, c.unique_cards, pc.player_count,
           (CASE WHEN r.game_mode = 'sutda3' THEN 3 ELSE 2 END) * pc.player_count AS expected_cards,
           c.max_per_player
      FROM game_rounds r
      JOIN (SELECT round_id, count(*) AS total_cards, count(DISTINCT card_code) AS unique_cards,
                   max(cnt) AS max_per_player
              FROM (SELECT round_id, user_id, card_code, count(*) OVER (PARTITION BY round_id, user_id) AS cnt
                      FROM game_cards) q
             GROUP BY round_id) c ON c.round_id = r.id
      JOIN (SELECT round_id, count(*) AS player_count FROM game_round_players GROUP BY round_id) pc ON pc.round_id = r.id
     WHERE c.total_cards <> c.unique_cards
        OR c.total_cards > 20
        OR c.total_cards > (CASE WHEN r.game_mode = 'sutda3' THEN 3 ELSE 2 END) * pc.player_count
        OR c.max_per_player > (CASE WHEN r.game_mode = 'sutda3' THEN 3 ELSE 2 END)
     ORDER BY r.started_at DESC LIMIT 50) x;
$function$;

REVOKE ALL ON FUNCTION public.admin_integrity_card_check() FROM anon;

CREATE OR REPLACE FUNCTION public.admin_integrity_report()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _point jsonb; _pot jsonb; _dup jsonb; _card jsonb; _gwang jsonb; _failed jsonb; _neg jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;

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

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _pot FROM (
    SELECT r.id AS round_id, r.room_id, r.pot, COALESCE(r.carry_in,0) AS carry_in,
           COALESCE(b.new_bets, 0) AS total_bets, COALESCE(w.total_payout, 0) AS total_payout
      FROM game_rounds r
      LEFT JOIN (SELECT round_id, sum(total_bet - COALESCE(carry_bet,0)) AS new_bets
                   FROM game_round_players GROUP BY round_id) b ON b.round_id = r.id
      LEFT JOIN (SELECT reference_id, sum(amount) AS total_payout FROM point_transactions
                  WHERE type = 'game_win' AND reference_type = 'game_round' GROUP BY reference_id) w ON w.reference_id = r.id
     WHERE r.settlement_status = 'SETTLED'
       AND (r.pot <> COALESCE(b.new_bets,0) + COALESCE(r.carry_in,0)
            OR r.pot <> COALESCE(w.total_payout,0))
     ORDER BY r.settled_at DESC LIMIT 50) x;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _dup FROM (
    SELECT reference_id AS round_id, user_id, count(*) AS payout_count, sum(amount) AS total
      FROM point_transactions
     WHERE type = 'game_win' AND reference_type = 'game_round'
     GROUP BY reference_id, user_id HAVING count(*) > 1 LIMIT 50) x;

  SELECT public.admin_integrity_card_check() INTO _card;

  SELECT jsonb_build_object(
    'gwang_codes', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM card_assets WHERE is_gwang), '[]'::jsonb),
    'total_assets', (SELECT count(*) FROM card_assets),
    'valid', (SELECT count(*) = 3 AND bool_and(id IN ('m01-gwang','m03-gwang','m08-gwang')) FROM card_assets WHERE is_gwang)
             AND (SELECT count(*) = 20 FROM card_assets)
  ) INTO _gwang;

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
END; $function$;