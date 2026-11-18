-- 점검 항목 확장: 정산됐지만 지급 흐름이 맞지 않는 라운드도 이력으로 기록
create or replace function public.admin_scan_integrity_findings()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _tot int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 실행할 수 있습니다.';
  end if;

  with base as (
    select r.id, r.room_id, r.room_id as rid, r.round_number, r.pot, r.carry_in, r.finished_at, r.settlement_status,
           coalesce((select sum(p.total_bet - coalesce(p.carry_bet,0)) from public.game_round_players p where p.round_id=r.id),0) as bets,
           coalesce((select sum(coalesce(p.final_points,0) - p.initial_points) from public.game_round_players p where p.round_id=r.id),0) as delta,
           coalesce(gr.is_test_room,false) as test_room, gr.room_number,
           not exists (select 1 from public.game_round_players p join public.profiles pf on pf.id=p.user_id
                        where p.round_id=r.id and coalesce(pf.is_test_user,false) = false) as all_test_users
      from public.game_rounds r left join public.game_rooms gr on gr.id=r.room_id
     where r.settled
  ), flagged as (
    select b.*, case when b.pot <> b.bets + coalesce(b.carry_in,0) then 'POT_MISMATCH' else 'SETTLEMENT_PAYOUT_MISSING' end as code
      from base b
     where b.pot <> b.bets + coalesce(b.carry_in,0)
        or (b.settlement_status = 'SETTLED' and b.delta <> 0
            and not exists (select 1 from public.game_rounds n
                             where n.room_id = b.rid and n.round_number = b.round_number + 1
                               and n.carry_in = -b.delta))
  )
  insert into public.integrity_findings(code, scope, subject_type, subject_id, subject_label, status, detail, occurred_at)
  select f.code,
         case when f.test_room or f.all_test_users then 'TEST' else 'OPERATION' end,
         'game_round', f.id, concat('방 ', coalesce(f.room_number,0), ' / ', f.round_number, '라운드'),
         'OPEN',
         jsonb_build_object('pot', f.pot, 'bets', f.bets, 'carryIn', f.carry_in, 'pointDelta', f.delta,
                            'settlementStatus', f.settlement_status,
                            'roomId', f.room_id, 'roomNumber', f.room_number,
                            'isTestRoom', f.test_room, 'allTestUsers', f.all_test_users),
         f.finished_at
    from flagged f
  on conflict (code, subject_type, coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set detail = excluded.detail, scope = excluded.scope, updated_at = now();

  select count(*) into _tot from public.integrity_findings;
  return jsonb_build_object('scannedAt', now(), 'findings', _tot,
    'open', (select count(*) from public.integrity_findings where status='OPEN'),
    'openOperation', (select count(*) from public.integrity_findings where status='OPEN' and scope='OPERATION'));
end;
$$;

-- CRITICAL 집계에 지급 누락 항목 포함 (미해결 + 범위 필터)
create or replace function public.admin_critical_alerts(_scope text default 'OPERATION')
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'cron'
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
   where r.status <> 'finished' and r.last_activity_at < now() - interval '5 minutes'
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

revoke all on function public.admin_scan_integrity_findings() from public, anon;
revoke all on function public.admin_critical_alerts(text) from public, anon;
grant execute on function public.admin_scan_integrity_findings() to authenticated;
grant execute on function public.admin_critical_alerts(text) to authenticated;