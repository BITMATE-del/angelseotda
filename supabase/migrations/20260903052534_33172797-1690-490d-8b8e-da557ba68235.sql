-- 운영 모니터링 쿼리 오탐 교정 (게임 엔진/정산 로직은 변경하지 않음)
-- 1) 재경기 라운드는 total_bet 안에 carry_bet(이월 투자액)이 이미 포함되므로 carry_in 이중계산을 제거
-- 2) 광 카드 검사 코드가 실제 카드 ID(m01/m03/m08-gwang)와 달라 발생한 오탐 교정
CREATE OR REPLACE FUNCTION public.admin_critical_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
declare
  _pot int; _point int; _fail int; _stuck int; _rt int; _watch jsonb; _credit int;
  _alerts jsonb := '[]'::jsonb;
  _enabled boolean;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 조회할 수 있습니다.';
  end if;

  select count(*) into _pot from public.game_rounds r
   where r.settled and r.finished_at > now() - interval '24 hours'
     and r.pot <> coalesce((select sum(p.total_bet - coalesce(p.carry_bet,0))
                              from public.game_round_players p where p.round_id=r.id),0)
                  + coalesce(r.carry_in,0);

  select count(*) into _point from public.profiles pr
   where pr.game_points < 0 or pr.locked_points < 0;

  select count(*) into _fail from public.game_rounds r
   where r.status='finished' and r.settlement_status not in ('SETTLED','REMATCH')
     and r.finished_at > now() - interval '24 hours';

  select count(*) into _stuck from public.game_rounds r
   where r.status <> 'finished' and r.last_activity_at < now() - interval '5 minutes';

  select count(*) into _rt from pg_publication_tables where pubname='supabase_realtime';

  select public.crypto_scheduler_status() into _watch;
  select (value)::text = 'true' into _enabled from public.app_settings where key='crypto_charge_enabled';

  select count(*) into _credit from public.crypto_charge_requests c
   where c.status in ('FAILED','ERROR') and c.updated_at > now() - interval '24 hours';

  _alerts := jsonb_build_array(
    jsonb_build_object('code','POT_MISMATCH','level', case when _pot>0 then 'CRITICAL' else 'OK' end,'count',_pot,'detail','최근 24시간 정산 라운드 POT 합계 불일치'),
    jsonb_build_object('code','POINT_MISMATCH','level', case when _point>0 then 'CRITICAL' else 'OK' end,'count',_point,'detail','마이너스 잔액/locked 이상 회원'),
    jsonb_build_object('code','SETTLEMENT_FAILED','level', case when _fail>0 then 'CRITICAL' else 'OK' end,'count',_fail,'detail','종료됐지만 정산되지 않은 라운드'),
    jsonb_build_object('code','ROUND_STUCK','level', case when _stuck>0 then 'CRITICAL' else 'OK' end,'count',_stuck,'detail','5분 이상 진행 정지된 라운드'),
    jsonb_build_object('code','REALTIME_DISCONNECTED','level', case when coalesce(_rt,0)=0 then 'CRITICAL' else 'OK' end,'count',coalesce(_rt,0),'detail','realtime publication 구독 테이블 수'),
    jsonb_build_object('code','USDT_WATCHER_OFFLINE','level',
      case when coalesce(_enabled,false) is false then 'OFF'
           when _watch is null or (_watch->>'active')::boolean is not true then 'CRITICAL'
           when (_watch->>'last_run_at') is null or (_watch->>'last_run_at')::timestamptz < now() - interval '10 minutes' then 'CRITICAL'
           when coalesce(_watch->>'last_status','') <> 'succeeded' then 'WARN'
           else 'OK' end,
      'count',0,'detail', coalesce(_watch::text,'스케줄 없음')),
    jsonb_build_object('code','CRYPTO_CREDIT_ERROR','level', case when _credit>0 then 'CRITICAL' else 'OK' end,'count',_credit,'detail','최근 24시간 자동충전 지급 오류')
  );

  return jsonb_build_object('checkedAt', now(), 'alerts', _alerts,
    'criticalCount', (select count(*) from jsonb_array_elements(_alerts) a where a->>'level'='CRITICAL'));
end;
$function$;

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

  -- POT 무결성: (이번 판 신규 베팅합 + 이월 POT) = pot, 지급합은 이월 없이 끝난 판만 비교
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
            OR (COALESCE(r.carry_pot,0) = 0 AND r.pot <> COALESCE(w.total_payout,0)))
     ORDER BY r.settled_at DESC LIMIT 50) x;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO _dup FROM (
    SELECT reference_id AS round_id, user_id, count(*) AS payout_count, sum(amount) AS total
      FROM point_transactions
     WHERE type = 'game_win' AND reference_type = 'game_round'
     GROUP BY reference_id, user_id HAVING count(*) > 1 LIMIT 50) x;

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

  -- 광 카드 설정 검사 (실제 카드 ID 기준: m01/m03/m08-gwang, 전체 20장)
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