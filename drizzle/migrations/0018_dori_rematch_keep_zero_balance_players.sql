-- DORI_REMATCH_ZERO_BALANCE_1
-- 1) 재경기(REMATCH) 로 판이 이월될 때 잔액 0P 참가자를 좌석에서 삭제하지 않는다.
-- 2) 재경기 라운드는 지불 가능한 만큼만 ante 를 받고(0P 는 0), 추가 베팅 불가 상태는 기존 all-in 규칙으로 처리한다.
-- 3) carry_pot 은 새 기여도 레이어와 분리해 승부패 최고 1인에게 지급한다(총 지급액 동일, 소실/중복 없음).

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

  -- 재경기 이월 판: 직전 판이 REMATCH 로 종료되고 carry_pot 이 남아 있는 경우
  select id into _prev_round from public.dori_rounds
   where room_id = _room_id and settlement_status = 'REMATCH'
   order by round_number desc limit 1;
  if coalesce(_room.carry_pot,0) <= 0 then _prev_round := null; end if;

  -- 참가 좌석: 나가기 예약 제외 + (ante 지불 가능 OR 직전 판 재경기 대상자)
  -- 재경기 대상자는 잔액 0P 라는 이유만으로 제외하지 않는다(추가 입장금 없음).
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

  -- 선(先) 계산: 첫 판은 최소 좌석, 재경기 직후는 선 유지, 그 외 1→2→3→4→1 순환
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
    -- 지불 가능한 만큼만 ante (0P 는 0). 음수 잔액/가상 포인트 지급은 발생하지 않는다.
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
    values (_p.user_id, _round_id, 'ANTE', _pay, 0, 0);
  end loop;

  -- 카드 5장씩 (라운드 로빈)
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
