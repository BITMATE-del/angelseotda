-- 도리 전용 관리자 감사 로그 기록 (기존 admin_log_event 화이트리스트를 건드리지 않는다)
create or replace function public.dori_admin_log(_action text, _target_id uuid, _metadata jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin(auth.uid()) then raise exception '권한이 없습니다.'; end if;
  insert into public.admin_logs(admin_id, action, target_type, target_id, metadata)
  values (auth.uid(), _action, 'dori_room', _target_id, coalesce(_metadata, '{}'::jsonb));
end
$$;

revoke all on function public.dori_admin_log(text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.dori_admin_abort_round(_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _r public.dori_rounds; _p record; _pts bigint; _refunded bigint := 0; _n int := 0;
begin
  if not is_admin(auth.uid()) then raise exception '권한이 없습니다.'; end if;

  select rd.* into _r from public.dori_rounds rd
    where rd.room_id = _room_id and (rd.status = 'PLAYING' or rd.settlement_status = 'PENDING')
    order by rd.round_number desc limit 1
    for update;
  if _r.id is null then
    return jsonb_build_object('ok', true, 'result', 'NO_OPEN_ROUND');
  end if;

  if coalesce(_r.last_activity_at, _r.created_at) > now() - interval '2 minutes' then
    return jsonb_build_object('ok', false, 'result', 'ROUND_ACTIVE',
      'idleSeconds', floor(extract(epoch from (now() - coalesce(_r.last_activity_at, _r.created_at))))::int);
  end if;

  for _p in select user_id, contribution from public.dori_round_players
             where round_id = _r.id and coalesce(contribution,0) > 0
  loop
    select game_points into _pts from public.profiles where id = _p.user_id for update;
    update public.profiles set game_points = game_points + _p.contribution where id = _p.user_id;
    insert into public.point_transactions(user_id, type, amount, balance_before, balance_after,
           reference_type, reference_id, memo)
    values (_p.user_id, 'DORI_REFUND', _p.contribution, _pts, _pts + _p.contribution,
            'DORI_ROUND', _r.id, 'DORI_JITGO_DDAENG aborted round refund');
    _refunded := _refunded + _p.contribution;
    _n := _n + 1;
  end loop;

  update public.dori_rounds set status = 'CANCELLED', phase = 'FINISHED',
         settlement_status = 'FAILED', settled_at = now(), finished_at = now(),
         winner_id = null where id = _r.id;
  update public.dori_rooms set carry_pot = 0, keep_dealer = false, current_round_id = null,
         status = 'WAITING', updated_at = now() where id = _room_id;

  perform public.dori_admin_log('DORI_ROUND_ABORT', _room_id,
          jsonb_build_object('round_id', _r.id, 'refunded', _refunded, 'players', _n));

  return jsonb_build_object('ok', true, 'result', 'ABORTED', 'refunded', _refunded, 'players', _n);
end
$$;

revoke all on function public.dori_admin_abort_round(uuid) from public, anon;
grant execute on function public.dori_admin_abort_round(uuid) to authenticated;

-- 안전 종료: 존재하지 않는 admin_log_event(4 args) 호출로 실패하던 문제 수정
create or replace function public.dori_admin_safe_close(_room_id uuid, _force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _active int; _open int; _status text;
begin
  if not is_admin(auth.uid()) then raise exception '권한이 없습니다.'; end if;
  select status into _status from dori_rooms where id = _room_id;
  if _status is null then raise exception '방을 찾을 수 없습니다.'; end if;
  if _status = 'CLOSED' then
    return jsonb_build_object('ok', true, 'result', 'ALREADY_CLOSED');
  end if;

  select count(*) into _active from dori_room_players where room_id = _room_id;
  select count(*) into _open from dori_rounds
    where room_id = _room_id and (status = 'PLAYING' or settlement_status = 'PENDING');

  if _open > 0 then
    return jsonb_build_object('ok', false, 'result', 'ROUND_IN_PROGRESS', 'openRounds', _open);
  end if;
  if _active > 0 and not _force then
    return jsonb_build_object('ok', false, 'result', 'PLAYERS_SEATED', 'seated', _active);
  end if;

  delete from public.dori_room_players where room_id = _room_id;
  perform public.dori_cleanup_room(_room_id);
  update dori_rooms set status = 'CLOSED', closed_at = coalesce(closed_at, now()),
         close_reason = coalesce(close_reason, 'ADMIN_CLOSE'), current_round_id = null
    where id = _room_id;
  perform public.dori_admin_log('DORI_ROOM_CLOSE', _room_id,
          jsonb_build_object('seated', _active, 'force', _force));
  return jsonb_build_object('ok', true, 'result', 'CLOSED', 'seated', _active);
end
$$;

revoke all on function public.dori_admin_safe_close(uuid, boolean) from public, anon;
grant execute on function public.dori_admin_safe_close(uuid, boolean) to authenticated;