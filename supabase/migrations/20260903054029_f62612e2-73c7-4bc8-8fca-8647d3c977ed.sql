-- 스캔 기준 교정: POT 합계 불일치만 기록 (재경기 이월로 인한 정상 잔액 이동은 제외)
create or replace function public.admin_scan_integrity_findings()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _tot int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 실행할 수 있습니다.';
  end if;

  with pot as (
    select r.id, r.room_id, r.pot, r.carry_in, r.finished_at,
           coalesce((select sum(p.total_bet - coalesce(p.carry_bet,0)) from public.game_round_players p where p.round_id=r.id),0) as bets,
           coalesce(gr.is_test_room,false) as test_room, gr.room_number,
           not exists (select 1 from public.game_round_players p join public.profiles pf on pf.id=p.user_id
                        where p.round_id=r.id and coalesce(pf.is_test_user,false) = false) as all_test_users
      from public.game_rounds r left join public.game_rooms gr on gr.id=r.room_id
     where r.settled
  ), bad as (
    select * from pot where pot <> bets + coalesce(carry_in,0)
  )
  insert into public.integrity_findings(code, scope, subject_type, subject_id, subject_label, status, detail, occurred_at)
  select 'POT_MISMATCH',
         case when b.test_room or b.all_test_users then 'TEST' else 'OPERATION' end,
         'game_round', b.id, concat('방 ', coalesce(b.room_number,0), ' / 라운드'),
         'OPEN',
         jsonb_build_object('pot', b.pot, 'bets', b.bets, 'carryIn', b.carry_in,
                            'roomId', b.room_id, 'roomNumber', b.room_number,
                            'isTestRoom', b.test_room, 'allTestUsers', b.all_test_users),
         b.finished_at
    from bad b
  on conflict (code, subject_type, coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set detail = excluded.detail, scope = excluded.scope, updated_at = now();

  select count(*) into _tot from public.integrity_findings where code='POT_MISMATCH';
  return jsonb_build_object('scannedAt', now(), 'potFindings', _tot,
    'open', (select count(*) from public.integrity_findings where status='OPEN'),
    'openOperation', (select count(*) from public.integrity_findings where status='OPEN' and scope='OPERATION'));
end;
$$;

create or replace function public.admin_set_finding_status(_finding_id uuid, _status text, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _row public.integrity_findings;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 변경할 수 있습니다.';
  end if;
  if _status not in ('OPEN','RESOLVED','IGNORED_TEST') then
    raise exception 'INVALID_STATUS';
  end if;
  if coalesce(btrim(_reason),'') = '' then
    raise exception 'REASON_REQUIRED: 사유를 입력해야 합니다.';
  end if;
  update public.integrity_findings
     set status=_status, reason=_reason, updated_at=now(), updated_by=auth.uid()
   where id=_finding_id
   returning * into _row;
  if _row.id is null then
    raise exception 'NOT_FOUND';
  end if;
  insert into public.admin_logs(admin_id, action, target_type, target_id, metadata, reason)
  values (auth.uid(), 'SET_FINDING_STATUS', 'integrity_finding', _finding_id,
          jsonb_build_object('status',_status,'code',_row.code,'scope',_row.scope), _reason);
  return to_jsonb(_row);
end;
$$;

revoke all on function public.admin_scan_integrity_findings() from public, anon;
revoke all on function public.admin_set_finding_status(uuid,text,text) from public, anon;
grant execute on function public.admin_scan_integrity_findings() to authenticated;
grant execute on function public.admin_set_finding_status(uuid,text,text) to authenticated;