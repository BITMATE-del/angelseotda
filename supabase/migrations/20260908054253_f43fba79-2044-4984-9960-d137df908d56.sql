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

  perform public.admin_log_event('DORI_ROUND_ABORT',
          jsonb_build_object('room_id', _room_id, 'round_id', _r.id,
                             'refunded', _refunded, 'players', _n));

  return jsonb_build_object('ok', true, 'result', 'ABORTED', 'refunded', _refunded, 'players', _n);
end
$$;

revoke all on function public.dori_admin_abort_round(uuid) from public, anon;
grant execute on function public.dori_admin_abort_round(uuid) to authenticated;