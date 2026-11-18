CREATE OR REPLACE FUNCTION public.admin_critical_alerts(_scope text DEFAULT 'OPERATION'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
declare
  _pot int; _payout int; _point int; _fail int; _stuck int; _rt int; _watch jsonb; _credit int;
  _alerts jsonb; _enabled boolean; _sc text := coalesce(_scope,'OPERATION');
  _op boolean := _sc in ('OPERATION','ALL'); _tt boolean := _sc in ('TEST','ALL');
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 조회할 수 있습니다.';
  end if;

  select count(*) into _pot from public.integrity_findings f
   where f.code='POT_MISMATCH' and f.status='OPEN' and (_sc='ALL' or f.scope=_sc);
  select count(*) into _payout from public.integrity_findings f
   where f.code='SETTLEMENT_PAYOUT_MISSING' and f.status='OPEN' and (_sc='ALL' or f.scope=_sc);

  select count(*) into _point from public.profiles pr
   where (pr.game_points < 0 or pr.locked_points < 0)
     and ((_op and coalesce(pr.is_test_user,false)=false) or (_tt and coalesce(pr.is_test_user,false)));

  select count(*) into _fail from public.game_rounds r
   left join public.game_rooms gr on gr.id=r.room_id
   where r.status='finished' and r.settlement_status not in ('SETTLED','REMATCH','CANCELLED','ABORTED')
     and r.finished_at > now() - interval '24 hours'
     and ((_op and coalesce(gr.is_test_room,false)=false) or (_tt and coalesce(gr.is_test_room,false)));

  select count(*) into _stuck from public.game_rounds r
   left join public.game_rooms gr on gr.id=r.room_id
   where r.status not in ('finished','cancelled')
     and coalesce(gr.status,'closed') not in ('closed','deleted')
     and r.last_activity_at < now() - interval '5 minutes'
     and ((_op and coalesce(gr.is_test_room,false)=false) or (_tt and coalesce(gr.is_test_room,false)));

  select count(*) into _rt from pg_publication_tables where pubname='supabase_realtime';
  select public.crypto_scheduler_status() into _watch;
  select (value)::text = 'true' into _enabled from public.app_settings where key='crypto_charge_enabled';
  select count(*) into _credit from public.crypto_charge_requests c
   where c.status in ('FAILED','ERROR') and c.updated_at > now() - interval '24 hours';

  _alerts := jsonb_build_array(
    jsonb_build_object('code','POT_MISMATCH','level', case when _pot>0 then 'CRITICAL' else 'OK' end,'count',_pot,'detail','미해결 POT 합계 불일치 (해결/테스트이력 제외)'),
    jsonb_build_object('code','SETTLEMENT_PAYOUT_MISSING','level', case when _payout>0 then 'CRITICAL' else 'OK' end,'count',_payout,'detail','정산됐지만 지급 흐름 불일치 (해결/테스트이력 제외)'),
    jsonb_build_object('code','POINT_MISMATCH','level', case when _point>0 then 'CRITICAL' else 'OK' end,'count',_point,'detail','마이너스 잔액/locked 이상 회원'),
    jsonb_build_object('code','SETTLEMENT_FAILED','level', case when _fail>0 then 'CRITICAL' else 'OK' end,'count',_fail,'detail','종료됐지만 정산되지 않은 라운드'),
    jsonb_build_object('code','ROUND_STUCK','level', case when _stuck>0 then 'CRITICAL' else 'OK' end,'count',_stuck,'detail','5분 이상 진행 정지된 라운드'),
    jsonb_build_object('code','REALTIME_DISCONNECTED','level', case when coalesce(_rt,0)=0 then 'CRITICAL' else 'OK' end,'count',coalesce(_rt,0),'detail','realtime publication 구독 테이블 수'),
    jsonb_build_object('code','USDT_WATCHER_OFFLINE','level',
      case when coalesce(_enabled,false) is false then 'OFF'
           when _watch is null or (_watch->>'active')::boolean is not true then 'CRITICAL'
           when (_watch->>'last_run_at') is null or (_watch->>'last_run_at')::timestamptz < now() - interval '10 minutes' then 'CRITICAL'
           when coalesce(_watch->>'last_status','') <> 'succeeded' then 'WARN'
           else 'OK' end, 'count',0,'detail', coalesce(_watch::text,'스케줄 없음')),
    jsonb_build_object('code','CRYPTO_CREDIT_ERROR','level', case when _credit>0 then 'CRITICAL' else 'OK' end,'count',_credit,'detail','최근 24시간 자동충전 지급 오류')
  );

  return jsonb_build_object('checkedAt', now(), 'scope', _sc, 'alerts', _alerts,
    'historical', jsonb_build_object(
      'resolved', (select count(*) from public.integrity_findings where status='RESOLVED'),
      'ignoredTest', (select count(*) from public.integrity_findings where status='IGNORED_TEST'),
      'openTest', (select count(*) from public.integrity_findings where status='OPEN' and scope='TEST')),
    'criticalCount', (select count(*) from jsonb_array_elements(_alerts) a where a->>'level'='CRITICAL'));
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_critical_alerts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_critical_alerts(text) TO authenticated, service_role;