-- 재경기 시에도 "해당 재경기 참가자가 아닌" 잔액 0P 좌석은 기존 규칙대로 퇴장시킨다.
CREATE OR REPLACE FUNCTION public.dori_settle_round(_round_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _r public.dori_rounds; _room public.dori_rooms; _p record; _sub record;
  _levels bigint[]; _lvl bigint; _prev bigint := 0; _amount bigint; _win record;
  _top int; _tie int; _rematch boolean := false; _pts bigint; _remain int;
  _eff int; _other_best int; _reason text := null;
begin
  select * into _r from public.dori_rounds where id = _round_id for update;
  if _r.id is null or _r.status <> 'PLAYING' then return; end if;
  select * into _room from public.dori_rooms where id = _r.room_id for update;

  for _p in select * from public.dori_round_players where round_id = _round_id and folded = false loop
    select * into _sub from public.dori_hand_submissions where round_id = _round_id and user_id = _p.user_id
      order by created_at desc limit 1;
    if _sub.id is not null then
      update public.dori_round_players set make_status = 'MADE', make_total = _sub.make_total,
        hand_type = _sub.hand_type, hand_rank = _sub.hand_rank, hand_label = _sub.hand_label,
        hand_code = _sub.hand_code
        where id = _p.id;
    else
      update public.dori_round_players set make_status = 'HWANG', hand_type = 'HWANG',
        hand_rank = 0, hand_label = '황', hand_code = 'HWANG' where id = _p.id;
    end if;
  end loop;

  for _p in select * from public.dori_round_players where round_id = _round_id and folded = false loop
    _eff := coalesce(_p.hand_rank,0) * 10;
    if _p.hand_code = 'AMHAENG' then
      if exists (select 1 from public.dori_round_players o
                  where o.round_id = _round_id and o.folded = false and o.id <> _p.id
                    and o.hand_code in ('GWANG_18','GWANG_13'))
      then _eff := 9955;
      else _eff := 1010;
      end if;
    elsif _p.hand_code = 'TTAENGJABI' then
      if exists (select 1 from public.dori_round_players o
                  where o.round_id = _round_id and o.folded = false and o.id <> _p.id
                    and o.hand_code ~ '^DDAENG_[1-9]$')
      then _eff := 9095;
      else _eff := 1000;
      end if;
    elsif _p.hand_code in ('GUSA','MUNG_GUSA') then
      select coalesce(max(coalesce(o.hand_rank,0)),0) into _other_best
        from public.dori_round_players o
       where o.round_id = _round_id and o.folded = false and o.id <> _p.id
         and coalesce(o.hand_code,'') not in ('GUSA','MUNG_GUSA');
      if (_p.hand_code = 'GUSA' and _other_best <= 806)
         or (_p.hand_code = 'MUNG_GUSA' and _other_best <= 909)
      then
        _rematch := true;
        _reason := case when _p.hand_code = 'MUNG_GUSA' then '멍텅구리구사 성립 · 재경기'
                        else '구사 성립 · 재경기' end;
      else
        _eff := 1030;
      end if;
    end if;
    _eff := _eff + (coalesce(_p.make_total,0) / 10);
    update public.dori_round_players set effective_rank = _eff where id = _p.id;
  end loop;

  select max(effective_rank) into _top from public.dori_round_players where round_id = _round_id and folded = false;
  select count(*) into _tie from public.dori_round_players
    where round_id = _round_id and folded = false and effective_rank = _top;
  select count(*) into _remain from public.dori_round_players where round_id = _round_id and folded = false;
  if _remain > 1 and _tie > 1 then
    _rematch := true;
    if _reason is null then _reason := '동점 · 재경기'; end if;
  end if;
  if _remain <= 1 then _rematch := false; _reason := null; end if;

  if _rematch then
    update public.dori_round_players set result_type = 'REMATCH'
      where round_id = _round_id and folded = false;
    update public.dori_rounds set status = 'FINISHED', phase = 'FINISHED', settlement_status = 'REMATCH',
      settled_at = now(), finished_at = now(), winner_id = null, rematch_reason = _reason where id = _round_id;
    update public.dori_rooms set carry_pot = _r.pot, keep_dealer = true, current_round_id = null,
      status = 'WAITING', updated_at = now() where id = _r.room_id;
  else
    if coalesce(_r.carry_pot,0) > 0 then
      select rp.* into _win from public.dori_round_players rp
        where rp.round_id = _round_id and rp.folded = false
        order by rp.effective_rank desc, rp.seat asc limit 1;
      if _win.id is not null then
        select game_points into _pts from public.profiles where id = _win.user_id;
        update public.profiles set game_points = game_points + _r.carry_pot where id = _win.user_id;
        insert into public.point_transactions(user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
        values (_win.user_id, 'DORI_WIN', _r.carry_pot, _pts, _pts + _r.carry_pot, 'DORI_ROUND', _round_id, 'DORI_JITGO_DDAENG carry payout');
      end if;
    end if;

    select coalesce(array_agg(distinct contribution order by contribution),'{}') into _levels
      from public.dori_round_players where round_id = _round_id and contribution > 0;
    foreach _lvl in array _levels loop
      select coalesce(sum(least(contribution,_lvl) - _prev),0) into _amount
        from public.dori_round_players where round_id = _round_id and contribution > _prev;
      if _amount > 0 then
        select rp.* into _win from public.dori_round_players rp
          where rp.round_id = _round_id and rp.folded = false and rp.contribution >= _lvl
          order by rp.effective_rank desc, rp.seat asc limit 1;
        if _win.id is null then
          select rp.* into _win from public.dori_round_players rp
            where rp.round_id = _round_id and rp.folded = false
            order by rp.effective_rank desc, rp.seat asc limit 1;
        end if;
        if _win.id is not null then
          select game_points into _pts from public.profiles where id = _win.user_id;
          update public.profiles set game_points = game_points + _amount where id = _win.user_id;
          insert into public.point_transactions(user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
          values (_win.user_id, 'DORI_WIN', _amount, _pts, _pts + _amount, 'DORI_ROUND', _round_id, 'DORI_JITGO_DDAENG payout');
        end if;
      end if;
      _prev := _lvl;
    end loop;

    update public.dori_round_players set result_type = case when effective_rank = _top then 'WIN' else 'LOSE' end
      where round_id = _round_id and folded = false;
    update public.dori_rounds set status = 'FINISHED', phase = 'FINISHED', settlement_status = 'DONE',
      settled_at = now(), finished_at = now(), rematch_reason = null,
      winner_id = (select user_id from public.dori_round_players
                    where round_id = _round_id and folded = false order by effective_rank desc, seat asc limit 1)
      where id = _round_id;
    update public.dori_rooms set carry_pot = 0, keep_dealer = false, current_round_id = null,
      status = 'WAITING', updated_at = now() where id = _r.room_id;
  end if;

  update public.dori_round_players rp set final_points = pr.game_points
    from public.profiles pr where pr.id = rp.user_id and rp.round_id = _round_id;

  delete from public.dori_room_players where room_id = _r.room_id and leave_pending = true;

  -- 잔액 0P 퇴장: 이번 판 재경기 참가자(result_type='REMATCH')는 예외로 좌석을 유지한다.
  delete from public.dori_room_players p using public.profiles pr
    where p.room_id = _r.room_id and pr.id = p.user_id and pr.game_points <= 0
      and not exists (
        select 1 from public.dori_round_players rp
         where rp.round_id = _round_id and rp.user_id = p.user_id and rp.result_type = 'REMATCH');

  perform public.dori_cleanup_room(_r.room_id);
end $function$;
