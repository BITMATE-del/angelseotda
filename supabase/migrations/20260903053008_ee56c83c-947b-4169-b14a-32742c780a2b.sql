-- 관리자가 강제 종료(CANCELLED)한 방의 라운드는 정산 실패 경고로 보지 않는다. (경고 판정만 수정)
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
   where r.status='finished' and r.settlement_status not in ('SETTLED','REMATCH','CANCELLED','ABORTED')
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