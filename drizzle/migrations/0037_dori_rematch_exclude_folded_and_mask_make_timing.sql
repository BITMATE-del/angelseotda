-- BUG A: 재경기 참가자는 직전 판의 재경기 후보(result_type='REMATCH')만 — 다이한 플레이어는 제외
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

  if _prev_round is not null then
    -- 재경기: 직전 판 재경기 후보만 참가 (다이/탈락 제외). 좌석은 그대로 유지된다.
    select coalesce(array_agg(p.seat order by p.seat),'{}') into _seats
      from public.dori_room_players p
      join public.dori_round_players rp
        on rp.round_id = _prev_round and rp.user_id = p.user_id and rp.result_type = 'REMATCH'
     where p.room_id = _room_id and p.leave_pending = false;
  else
    select coalesce(array_agg(p.seat order by p.seat),'{}') into _seats
      from public.dori_room_players p
      join public.profiles pr on pr.id = p.user_id
     where p.room_id = _room_id and p.leave_pending = false
       and pr.game_points >= _room.ante;
  end if;
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

-- BUG B: 짓기 단계 중에는 상대의 완료 여부(황 자동완료 포함)를 내려보내지 않는다.
CREATE OR REPLACE FUNCTION public.dori_room_state(_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid(); _room public.dori_rooms; _r public.dori_rounds;
  _seats jsonb; _mine jsonb; _actions jsonb; _vis int; _mode text; _mysubmit boolean;
  _making boolean;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _room from public.dori_rooms where id = _room_id;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;
  select * into _r from public.dori_rounds where room_id = _room_id order by round_number desc limit 1;
  _vis := case when _r.id is null then 0 else public.dori_visible_cards(_r.phase) end;
  _mode := case when _r.id is null then 'HIDDEN' else public.dori_reveal_mode(_r.id) end;
  -- 짓기 진행 중 여부: 진행 중에는 상대 완료 타이밍을 감춘다.
  _making := _r.id is not null and _r.status = 'PLAYING' and _r.phase = 'MAKE_SELECTION';

  select coalesce(jsonb_agg(x order by x->>'seat'),'[]'::jsonb) into _seats from (
    select jsonb_build_object(
      'seat', p.seat,
      'userId', p.user_id,
      'nickname', pr.nickname,
      'rank', pr.rank,
      'level', pr.level,
      'avatarUrl', pr.avatar_url,
      'characterUrl', public.equipped_item_asset(p.user_id, 'character'),
      'title', public.equipped_item_asset(p.user_id, 'title'),
      'points', pr.game_points,
      'isMe', p.user_id = _uid,
      'isReady', p.is_ready,
      'leavePending', p.leave_pending,
      'connection', p.connection_status,
      'absenceMisses', coalesce(p.absence_miss_count,0),
      'longAbsence', coalesce(p.long_absence,false),
      'inRound', rp.id is not null,
      'folded', coalesce(rp.folded,false),
      'isAllIn', coalesce(rp.is_all_in,false),
      'acted', coalesce(rp.acted,false),
      'roundBet', coalesce(rp.round_bet,0),
      'contribution', coalesce(rp.contribution,0),
      'makeStatus', case
          when p.user_id = _uid then rp.make_status
          when rp.id is null then null
          when public.dori_seat_revealed(_mode, rp.folded, rp.result_type) then rp.make_status
          when rp.make_status is null then null
          when _making then 'PENDING'
          when rp.make_status = 'PENDING' then 'PENDING'
          else 'SUBMITTED' end,
      'resultType', rp.result_type,
      'cardCount', (select count(*) from public.dori_cards c
                     where c.round_id = _r.id and c.user_id = p.user_id and c.deal_order <= _vis),
      'revealed', p.user_id <> _uid and public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type),
      'cards', case when p.user_id <> _uid
                     and public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then (select to_jsonb(array_agg(c.card_code order by c.deal_order))
                from public.dori_cards c where c.round_id = _r.id and c.user_id = p.user_id)
        else null end,
      'handLabel', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then rp.hand_label else null end,
      'handRank', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then rp.hand_rank else null end,
      'makeTotal', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then rp.make_total else null end,
      'selectedCards', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type) then
          (select to_jsonb(s.selected_card_ids) from public.dori_hand_submissions s
            where s.round_id = _r.id and s.user_id = p.user_id order by s.created_at desc limit 1)
        else null end,
      'remainingCards', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type) then
          (select to_jsonb(s.remaining_card_ids) from public.dori_hand_submissions s
            where s.round_id = _r.id and s.user_id = p.user_id order by s.created_at desc limit 1)
        else null end
    ) as x
    from public.dori_room_players p
    join public.profiles pr on pr.id = p.user_id
    left join public.dori_round_players rp on rp.round_id = _r.id and rp.user_id = p.user_id
    where p.room_id = _room_id
  ) t;

  _mine := case when _r.id is not null and _r.status = 'PLAYING'
    then public.dori_my_cards(_room_id) else jsonb_build_object('cards','[]'::jsonb,'options','[]'::jsonb) end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.action_id, 'userId', a.user_id, 'type', a.action_type,
      'amount', a.amount, 'bettingRound', a.betting_round, 'at', a.created_at)
      order by a.created_at), '[]'::jsonb) into _actions
    from (select a.id as action_id, a.user_id, a.action_type, a.amount, a.betting_round, a.created_at
            from public.dori_actions a where a.round_id = _r.id order by a.created_at desc limit 40) a;

  _mysubmit := exists (select 1 from public.dori_hand_submissions s where s.round_id = _r.id and s.user_id = _uid);

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', _room.id, 'roomNumber', _room.room_number, 'title', _room.title,
      'roomType', _room.room_type, 'ante', _room.ante, 'minPoints', _room.min_points,
      'status', _room.status, 'carryPot', _room.carry_pot, 'keepDealer', _room.keep_dealer,
      'isPrivate', _room.is_private, 'currentPlayers', (select count(*) from public.dori_room_players where room_id = _room_id)),
    'round', case when _r.id is null then null else jsonb_build_object(
      'roundId', _r.id, 'roundNumber', _r.round_number, 'status', _r.status, 'phase', _r.phase,
      'dealerSeat', _r.dealer_seat, 'pot', _r.pot, 'carryPot', _r.carry_pot,
      'currentBet', _r.current_bet, 'raiseCount', _r.raise_count,
      'currentTurnUserId', _r.current_turn_user_id, 'turnDeadlineAt', _r.turn_deadline_at,
      'settlementStatus', _r.settlement_status, 'rematchReason', _r.rematch_reason,
      'winnerId', _r.winner_id, 'revealMode', _mode) end,
    'seats', _seats,
    'mine', _mine,
    'actions', _actions,
    'mySubmitted', _mysubmit,
    'serverNow', now());
end $function$;