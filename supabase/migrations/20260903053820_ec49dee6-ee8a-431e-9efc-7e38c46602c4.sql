-- CRITICAL 집계: 미해결(OPEN) + 선택한 범위(기본 운영)만 계산
create or replace function public.admin_critical_alerts(_scope text default 'OPERATION')
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
declare
  _pot int; _point int; _fail int; _stuck int; _rt int; _watch jsonb; _credit int;
  _alerts jsonb; _enabled boolean; _sc text := coalesce(_scope,'OPERATION');
  _op boolean := _sc in ('OPERATION','ALL'); _tt boolean := _sc in ('TEST','ALL');
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 조회할 수 있습니다.';
  end if;

  -- POT: 이력 테이블의 OPEN 항목만, 범위 필터 적용
  select count(*) into _pot from public.integrity_findings f
   where f.code='POT_MISMATCH' and f.status='OPEN'
     and (_sc='ALL' or f.scope=_sc);

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
   where r.status <> 'finished' and r.last_activity_at < now() - interval '5 minutes'
     and ((_op and coalesce(gr.is_test_room,false)=false) or (_tt and coalesce(gr.is_test_room,false)));

  select count(*) into _rt from pg_publication_tables where pubname='supabase_realtime';

  select public.crypto_scheduler_status() into _watch;
  select (value)::text = 'true' into _enabled from public.app_settings where key='crypto_charge_enabled';

  select count(*) into _credit from public.crypto_charge_requests c
   where c.status in ('FAILED','ERROR') and c.updated_at > now() - interval '24 hours';

  _alerts := jsonb_build_array(
    jsonb_build_object('code','POT_MISMATCH','level', case when _pot>0 then 'CRITICAL' else 'OK' end,'count',_pot,'detail','미해결 POT 불일치 (해결/테스트이력 제외)'),
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

  return jsonb_build_object('checkedAt', now(), 'scope', _sc, 'alerts', _alerts,
    'historical', jsonb_build_object(
      'resolved', (select count(*) from public.integrity_findings where status='RESOLVED'),
      'ignoredTest', (select count(*) from public.integrity_findings where status='IGNORED_TEST'),
      'openTest', (select count(*) from public.integrity_findings where status='OPEN' and scope='TEST')),
    'criticalCount', (select count(*) from jsonb_array_elements(_alerts) a where a->>'level'='CRITICAL'));
end;
$function$;

-- 서비스 영역별 운영 준비 상태
create or replace function public.admin_service_readiness()
returns jsonb language plpgsql stable security definer set search_path to 'public','cron' as $$
declare
  _core text; _crit int; _watch jsonb; _enabled boolean; _real_credit int; _rt int;
  _admins int; _members int; _norls int; _pending_wd int; _test_driver boolean;
  _usdt text; _sec text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 조회할 수 있습니다.';
  end if;

  select (value #>> '{}') into _core from public.app_settings where key='game_core_version';
  select (admin_critical_alerts('OPERATION')->>'criticalCount')::int into _crit;
  select public.crypto_scheduler_status() into _watch;
  select (value)::text='true' into _enabled from public.app_settings where key='crypto_charge_enabled';
  select coalesce((value)::text='true',false) into _test_driver from public.app_settings where key='test_driver_enabled';
  select count(*) into _real_credit from public.crypto_charge_requests c
    join public.profiles p on p.id=c.user_id
   where c.status='CREDITED' and coalesce(p.is_test_user,false)=false;
  select count(*) into _rt from pg_publication_tables where pubname='supabase_realtime';
  select count(*) into _admins from public.user_roles where role in ('admin','super_admin');
  select count(*) into _members from public.profiles;
  select count(*) into _norls from pg_tables t
   where t.schemaname='public'
     and not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and c.relname=t.tablename and c.relrowsecurity);
  select count(*) into _pending_wd from public.withdrawal_requests where status='REQUESTED';

  _usdt := case
    when not coalesce(_enabled,false) then 'NOT_READY'
    when _watch is null or (_watch->>'active')::boolean is not true then 'NOT_READY'
    when _real_credit = 0 then 'NOT_READY'
    else 'READY' end;
  _sec := case when _norls > 0 then 'NOT_READY' else 'READY' end;

  return jsonb_build_object('checkedAt', now(), 'criticalCount', _crit,
    'areas', jsonb_build_array(
      jsonb_build_object('key','GAME_CORE','label','게임 코어','status', case when _core='STABLE_1' and _crit=0 then 'READY' else 'NOT_READY' end,'detail', concat('버전 ', coalesce(_core,'미기록'), ' / CRITICAL ', _crit)),
      jsonb_build_object('key','MEMBER_AUTH','label','회원/인증','status', case when _members>0 then 'READY' else 'NOT_READY' end,'detail', concat('회원 ', _members, '명')),
      jsonb_build_object('key','ADMIN','label','관리자','status', case when _admins>0 then 'READY' else 'NOT_READY' end,'detail', concat('관리자 권한 ', _admins, '건')),
      jsonb_build_object('key','USDT_CHARGE','label','USDT 자동충전','status', _usdt,'detail',
        concat('사용 ', case when coalesce(_enabled,false) then 'ON' else 'OFF' end,
               ' / 감시기 ', case when coalesce((_watch->>'active')::boolean,false) then 'ONLINE' else 'OFFLINE' end,
               ' / 실입금 지급 ', _real_credit, '건')),
      jsonb_build_object('key','WITHDRAWAL','label','수동 출금','status','READY','detail', concat('수수료 0% / 대기 ', _pending_wd, '건')),
      jsonb_build_object('key','REALTIME','label','실시간 서버','status', case when coalesce(_rt,0)>0 then 'READY' else 'NOT_READY' end,'detail', concat('구독 테이블 ', coalesce(_rt,0), '개')),
      jsonb_build_object('key','SECURITY','label','보안/RLS','status', _sec,'detail', concat('RLS 미적용 테이블 ', _norls, '개 / 테스트드라이버 ', case when _test_driver then 'ON' else 'OFF' end))
    ));
end;
$$;

revoke all on function public.admin_service_readiness() from public;
grant execute on function public.admin_service_readiness() to authenticated;