-- 지급 검사 기준 교정: 라운드 순 잔액 변화 = 이월 유입 - 다음 판 이월 유출
create or replace function public.admin_scan_integrity_findings()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _tot int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 실행할 수 있습니다.';
  end if;

  with base as (
    select r.id, r.room_id, r.round_number, r.pot, coalesce(r.carry_in,0) as carry_in, r.finished_at, r.settlement_status,
           coalesce((select sum(p.total_bet - coalesce(p.carry_bet,0)) from public.game_round_players p where p.round_id=r.id),0) as bets,
           coalesce((select sum(coalesce(p.final_points,0) - p.initial_points) from public.game_round_players p where p.round_id=r.id),0) as delta,
           coalesce((select coalesce(n.carry_in,0) from public.game_rounds n
                      where n.room_id = r.room_id and n.round_number > r.round_number
                      order by n.round_number limit 1),0) as carry_out,
           coalesce(gr.is_test_room,false) as test_room, gr.room_number,
           not exists (select 1 from public.game_round_players p join public.profiles pf on pf.id=p.user_id
                        where p.round_id=r.id and coalesce(pf.is_test_user,false) = false) as all_test_users
      from public.game_rounds r left join public.game_rooms gr on gr.id=r.room_id
     where r.settled
  ), flagged as (
    select b.*, case when b.pot <> b.bets + b.carry_in then 'POT_MISMATCH' else 'SETTLEMENT_PAYOUT_MISSING' end as code
      from base b
     where b.pot <> b.bets + b.carry_in
        or (b.settlement_status = 'SETTLED' and b.delta <> b.carry_in - b.carry_out)
  )
  insert into public.integrity_findings(code, scope, subject_type, subject_id, subject_label, status, detail, occurred_at)
  select f.code,
         case when f.test_room or f.all_test_users then 'TEST' else 'OPERATION' end,
         'game_round', f.id, concat('방 ', coalesce(f.room_number,0), ' / ', f.round_number, '라운드'),
         'OPEN',
         jsonb_build_object('pot', f.pot, 'bets', f.bets, 'carryIn', f.carry_in, 'carryOut', f.carry_out,
                            'pointDelta', f.delta, 'settlementStatus', f.settlement_status,
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
revoke all on function public.admin_scan_integrity_findings() from public, anon;
grant execute on function public.admin_scan_integrity_findings() to authenticated;