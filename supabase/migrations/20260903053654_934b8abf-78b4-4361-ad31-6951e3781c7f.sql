-- 1) 무결성 점검 스캔 + 이력 등록 (삭제 없음, 상태 보존)
create or replace function public.admin_scan_integrity_findings()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _new int := 0;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 실행할 수 있습니다.';
  end if;

  with pot as (
    select r.id, r.room_id, r.pot, r.carry_in, r.finished_at,
           coalesce((select sum(p.total_bet - coalesce(p.carry_bet,0)) from public.game_round_players p where p.round_id=r.id),0) as bets,
           coalesce((select sum(coalesce(p.final_points,0) - p.initial_points) from public.game_round_players p where p.round_id=r.id),0) as delta,
           coalesce(gr.is_test_room,false) as test_room, gr.room_number,
           not exists (select 1 from public.game_round_players p join public.profiles pf on pf.id=p.user_id
                        where p.round_id=r.id and coalesce(pf.is_test_user,false) = false) as all_test_users
      from public.game_rounds r left join public.game_rooms gr on gr.id=r.room_id
     where r.settled
  ), bad as (
    select * from pot where pot <> bets + coalesce(carry_in,0) or delta <> 0
  )
  insert into public.integrity_findings(code, scope, subject_type, subject_id, subject_label, status, detail, occurred_at)
  select 'POT_MISMATCH',
         case when b.test_room or b.all_test_users then 'TEST' else 'OPERATION' end,
         'game_round', b.id, concat('방 ', coalesce(b.room_number,0), ' / 라운드'),
         'OPEN',
         jsonb_build_object('pot', b.pot, 'bets', b.bets, 'carryIn', b.carry_in, 'pointDelta', b.delta,
                            'roomId', b.room_id, 'roomNumber', b.room_number,
                            'isTestRoom', b.test_room, 'allTestUsers', b.all_test_users),
         b.finished_at
    from bad b
  on conflict (code, subject_type, coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid))
  do update set detail = excluded.detail, scope = excluded.scope, updated_at = now();

  select count(*) into _new from public.integrity_findings where code='POT_MISMATCH';

  return jsonb_build_object('scannedAt', now(), 'potFindings', _new,
    'open', (select count(*) from public.integrity_findings where status='OPEN'),
    'openOperation', (select count(*) from public.integrity_findings where status='OPEN' and scope='OPERATION'));
end;
$$;

-- 2) 이력 조회 (범위 필터: ALL / OPERATION / TEST)
create or replace function public.admin_list_integrity_findings(_scope text default 'OPERATION', _status text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'FORBIDDEN: 관리자만 조회할 수 있습니다.';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(f) order by f.status, f.occurred_at desc nulls last)
      from public.integrity_findings f
     where (coalesce(_scope,'ALL') = 'ALL' or f.scope = _scope)
       and (_status is null or f.status = _status)
  ), '[]'::jsonb);
end;
$$;

-- 3) 상태 변경 (삭제 금지, 사유 필수)
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
  perform public.admin_log_event('SET_FINDING_STATUS','integrity_finding', _finding_id,
    jsonb_build_object('status',_status,'code',_row.code,'scope',_row.scope), _reason);
  return to_jsonb(_row);
end;
$$;

revoke all on function public.admin_scan_integrity_findings() from anon;
revoke all on function public.admin_list_integrity_findings(text,text) from anon;
revoke all on function public.admin_set_finding_status(uuid,text,text) from anon;