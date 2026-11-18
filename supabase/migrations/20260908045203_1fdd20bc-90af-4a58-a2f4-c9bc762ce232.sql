create or replace function public.dori_cleanup_room(_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _cnt int;
  _carry bigint;
  _base bigint;
  _r record;
  _share bigint;
  _paid bigint := 0;
  _last_round uuid;
begin
  select count(*) into _cnt from public.dori_room_players where room_id = _room_id;

  if _cnt = 0 then
    -- 방을 닫기 전에 미지급 캐리팟(무승부 이월금)이 남아 있으면 마지막 판 기여도대로 환급한다.
    select carry_pot into _carry from public.dori_rooms where id = _room_id and closed_at is null;
    if coalesce(_carry, 0) > 0
       and not exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING') then
      select id into _last_round from public.dori_rounds
        where room_id = _room_id and settlement_status = 'REMATCH'
        order by round_number desc limit 1;
      if _last_round is not null then
        select coalesce(sum(contribution), 0) into _base
          from public.dori_round_players where round_id = _last_round;
        if _base > 0 then
          for _r in
            select user_id, contribution from public.dori_round_players
            where round_id = _last_round and contribution > 0
            order by seat
          loop
            _share := floor(_carry::numeric * _r.contribution / _base)::bigint;
            if _share > 0 then
              update public.profiles set game_points = game_points + _share where id = _r.user_id;
              insert into public.point_transactions
                (user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
              select _r.user_id, 'DORI_REFUND', _share, p.game_points - _share, p.game_points,
                     'dori_round', _last_round, 'DORI_JITGO_DDAENG carry refund'
              from public.profiles p where p.id = _r.user_id;
              _paid := _paid + _share;
            end if;
          end loop;
        end if;
      end if;
      update public.dori_rooms set carry_pot = 0 where id = _room_id;
    end if;

    update public.dori_rooms set closed_at = now(), close_reason = 'EMPTY', status = 'CLOSED', current_round_id = null
      where id = _room_id and closed_at is null
        and not exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING');
  elsif _cnt < 2 then
    update public.dori_rooms set status = 'WAITING', updated_at = now() where id = _room_id
      and not exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING');
  end if;
end
$$;

revoke all on function public.dori_cleanup_room(uuid) from public, anon, authenticated;