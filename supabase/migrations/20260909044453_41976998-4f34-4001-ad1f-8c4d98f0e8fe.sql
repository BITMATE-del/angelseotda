create or replace function public.dori_round_result(_round_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  _uid uuid := auth.uid();
  _r public.dori_rounds;
  _showdown_count int;
  _players jsonb;
  _payouts jsonb;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _r from public.dori_rounds where id = _round_id;
  if _r.id is null then raise exception 'DORI_ROUND_NOT_FOUND'; end if;
  if _r.status <> 'FINISHED' or _r.settlement_status = 'PENDING' then
    return jsonb_build_object('ready', false);
  end if;
  if not exists (
    select 1 from public.dori_round_players where round_id = _round_id and user_id = _uid
  ) then raise exception 'DORI_NOT_IN_ROUND'; end if;

  select count(*) into _showdown_count
    from public.dori_round_players where round_id = _round_id and folded = false;

  select coalesce(jsonb_agg(x order by (x->>'seat')::int), '[]'::jsonb) into _players from (
    select jsonb_build_object(
      'userId', rp.user_id,
      'nickname', pr.nickname,
      'seat', rp.seat,
      'resultType', rp.result_type,
      'folded', rp.folded,
      'handLabel', case when rp.folded or _showdown_count < 2 then null else rp.hand_label end,
      'contribution', rp.contribution,
      'payout', coalesce((
        select sum(t.amount) from public.point_transactions t
        where t.reference_type = 'DORI_ROUND' and t.reference_id = _round_id
          and t.type = 'DORI_WIN' and t.user_id = rp.user_id), 0),
      'net', coalesce((
        select sum(t.amount) from public.point_transactions t
        where t.reference_type = 'DORI_ROUND' and t.reference_id = _round_id
          and t.type = 'DORI_WIN' and t.user_id = rp.user_id), 0) - rp.contribution,
      'finalPoints', rp.final_points,
      'stillSeated', exists (
        select 1 from public.dori_room_players p
        where p.room_id = _r.room_id and p.user_id = rp.user_id)
    ) as x
    from public.dori_round_players rp
    join public.profiles pr on pr.id = rp.user_id
    where rp.round_id = _round_id
  ) t;

  select coalesce(jsonb_agg(y order by (y->>'ordinal')::int), '[]'::jsonb) into _payouts from (
    select jsonb_build_object(
      'ordinal', row_number() over (order by t.created_at, t.id),
      'userId', t.user_id,
      'nickname', pr.nickname,
      'amount', t.amount
    ) as y
    from public.point_transactions t
    join public.profiles pr on pr.id = t.user_id
    where t.reference_type = 'DORI_ROUND' and t.reference_id = _round_id and t.type = 'DORI_WIN'
  ) u;

  return jsonb_build_object(
    'ready', true,
    'roundId', _r.id,
    'roundNumber', _r.round_number,
    'settlementStatus', _r.settlement_status,
    'pot', _r.pot,
    'winnerId', _r.winner_id,
    'showdown', _showdown_count >= 2,
    'players', _players,
    'payouts', _payouts);
end $$;

revoke all on function public.dori_round_result(uuid) from public, anon;
grant execute on function public.dori_round_result(uuid) to authenticated;