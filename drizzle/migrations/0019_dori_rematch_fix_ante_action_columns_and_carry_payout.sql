-- 0018 후속: ANTE 액션 컬럼 순서 수정 + carry_pot 분리 지급 / 재경기 시 0P 좌석 유지
CREATE OR REPLACE FUNCTION public.dori_start_round(_room_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _room public.dori_rooms; _seats int[]; _n int; _dealer int; _deck text[];
  _round_id uuid; _idx int := 0; _p record; _card text; _ready_required boolean;
  _prev_round uuid; _pay bigint; _ante_total bigint := 0;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _room from public.dori_rooms where id = _room_id and closed_at is null for update;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;
  if exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING') then
    return _room.current_round_id;
  end if;
  if not exists (select 1 from public.dori_room_players where room_id = _room_id and user_id = auth.uid()) then
    raise exception 'DORI_NOT_SEATED';
  end if;

  select id into _prev_round from public.dori_rounds
   where room_id = _room_id and settlement_status = 'REMATCH'
   order by round_number desc limit 1;
  if coalesce(_room.carry_pot,0) <= 0 then _prev_round := null; end if;

  select coalesce(array_agg(p.seat order by p.seat),'{}') into _seats
    from public.dori_room_players p
    join public.profiles pr on pr.id = p.user_id
   where p.room_id = _room_id and p.leave_pending = false
     and (pr.game_points >= _room.ante
          or (_prev_round is not null and exists (
                select 1 from public.dori_round_players rp
                 where rp.round_id = _prev_round and rp.user_id = p.user_id
                   and rp.result_type = 'REMATCH')));
  _n := coalesce(array_length(_seats,1),0);
  if _n < 2 then raise exception 'DORI_NOT_ENOUGH_PLAYERS'; end if;

  _ready_required := _room.last_dealer_seat is null;
  if _ready_required and exists (
      select 1 from public.dori_room_players p where p.room_id = _room_id and p.seat = any(_seats) and p.is_ready = false)
  then raise exception 'DORI_NOT_ALL_READY'; end if;

  if _room.last_dealer_seat is null then
    _dealer := _seats[1];
  elsif _room.keep_dealer then
    _dealer := _room.last_dealer_seat;
    if not (_dealer = any(_seats)) then _dealer := _seats[1]; end if;
  else
    _dealer := null;
    for _idx in 1..4 loop
      if ((_room.last_dealer_seat - 1 + _idx) % 4) + 1 = any(_seats) then
        _dealer := ((_room.last_dealer_seat - 1 + _idx) % 4) + 1; exit;
      end if;
    end loop;
    if _dealer is null then _dealer := _seats[1]; end if;
  end if;

  select array_agg(c order by random()) into _deck
    from (select unnest(array['01-gwang','01-normal','02-a','02-b','03-gwang','03-normal','04-a','04-b','05-a','05-b','06-a','06-b','07-a','07-b','08-gwang','08-normal','09-a','09-b','10-a','10-b']) as c) d;

  insert into public.dori_rounds(room_id, round_number, status, phase, dealer_seat, ante, pot, carry_pot, deck, deck_pos)
  values (_room_id,
          coalesce((select max(round_number) from public.dori_rounds where room_id = _room_id),0) + 1,
          'PLAYING','DEALING', _dealer, _room.ante, 0, coalesce(_room.carry_pot,0), _deck, 0)
  returning id into _round_id;

  for _p in select p.user_id, p.seat, pr.game_points from public.dori_room_players p
              join public.profiles pr on pr.id = p.user_id
             where p.room_id = _room_id and p.seat = any(_seats) order by p.seat loop
    _pay := greatest(least(_room.ante, coalesce(_p.game_points,0)), 0);
    if _pay > 0 then
      update public.profiles set game_points = game_points - _pay where id = _p.user_id;
      insert into public.point_transactions(user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
      values (_p.user_id, 'DORI_ANTE', -_pay, _p.game_points, _p.game_points - _pay, 'DORI_ROUND', _round_id, 'DORI_JITGO_DDAENG ante');
    end if;
    _ante_total := _ante_total + _pay;
    insert into public.dori_round_players(round_id, user_id, seat, initial_points, contribution, round_bet, is_all_in, all_in_at)
    values (_round_id, _p.user_id, _p.seat, _p.game_points, _pay, 0,
            (coalesce(_p.game_points,0) - _pay) <= 0,
            case when (coalesce(_p.game_points,0) - _pay) <= 0 then now() else null end);
    insert into public.dori_actions(round_id, user_id, action_type, amount, betting_round, turn_number)
    values (_round_id, _p.user_id, 'ANTE', _pay, 0, 0);
  end loop;

  _idx := 0;
  for _card in select unnest(_deck) loop
    exit when _idx >= _n * 5;
    insert into public.dori_cards(round_id, user_id, card_code, month_value, deal_order)
    select _round_id, p.user_id, _card, public.dori_month(_card), (_idx / _n) + 1
      from public.dori_round_players p where p.round_id = _round_id and p.seat = _seats[(_idx % _n) + 1];
    _idx := _idx + 1;
  end loop;

  update public.dori_rounds
     set pot = coalesce(_room.carry_pot,0) + _ante_total,
         phase = 'BETTING_1',
         current_turn_user_id = (select user_id from public.dori_round_players where round_id = _round_id and seat = _dealer),
         turn_deadline_at = now() + interval '30 seconds',
         last_activity_at = now()
   where id = _round_id;

  update public.dori_rooms
     set current_round_id = _round_id, status = 'PLAYING', carry_pot = 0,
         last_dealer_seat = _dealer, keep_dealer = false, updated_at = now()
   where id = _room_id;

  perform public.dori_advance(_round_id);
  return _round_id;
end $function$;

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
    -- 이월 캐리팟은 이전 판 기여로 형성된 몫이므로, 새 기여도 레이어와 분리해
    -- 승부패 최고 1인에게 지급한다(총 지급액 동일 · 중복/소실 없음).
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

    -- SIDE POT 레이어별 지급 (이번 판 기여도 기준)
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
          -- 해당 레이어 기여자가 전원 다이한 경우: 남은 최고패에게 지급 (POT 소실 방지)
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

  -- 나가기 예약은 항상 정리한다.
  delete from public.dori_room_players where room_id = _r.room_id and leave_pending = true;

  -- 잔액 0P 퇴장은 "재경기가 아닌" 판 종료에만 적용한다.
  -- 재경기(carry POT 이월) 참가자는 잔액 0P 여도 좌석/멤버십을 유지한다.
  if not _rematch then
    delete from public.dori_room_players p using public.profiles pr
      where p.room_id = _r.room_id and pr.id = p.user_id and pr.game_points <= 0;
  end if;

  perform public.dori_cleanup_room(_r.room_id);
end $function$;
