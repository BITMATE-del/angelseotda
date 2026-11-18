-- 1) FOLD WIN 패 공개 선택 상태
alter table public.dori_rounds
  add column if not exists reveal_choice text not null default 'PENDING';

-- 2) 공개 허용 판정 헬퍼 (라운드 단위)
--    'SHOWDOWN' = 생존자 2인 이상 정상 쇼다운 → 생존자 전원 공개
--    'REVEAL'   = 전원 다이 승리 + 승자가 공개 선택 → 승자만 공개
--    'HIDDEN'   = 공개하지 않음
create or replace function public.dori_reveal_mode(_round_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _r public.dori_rounds; _alive int;
begin
  select * into _r from public.dori_rounds where id = _round_id;
  if _r.id is null then return 'HIDDEN'; end if;
  if _r.status <> 'FINISHED' or _r.settlement_status = 'PENDING' then return 'HIDDEN'; end if;
  select count(*) into _alive from public.dori_round_players
    where round_id = _round_id and folded = false;
  if _alive >= 2 then return 'SHOWDOWN'; end if;
  if _r.reveal_choice = 'REVEAL' then return 'REVEAL'; end if;
  return 'HIDDEN';
end $$;

-- 3) 전원 다이 승리 시 승자의 패 공개 선택 (정산과 완전히 분리 · idempotent)
create or replace function public.dori_reveal_choice(_round_id uuid, _reveal boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _uid uuid := auth.uid(); _r public.dori_rounds; _alive int;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _r from public.dori_rounds where id = _round_id for update;
  if _r.id is null then raise exception 'DORI_ROUND_NOT_FOUND'; end if;
  if _r.status <> 'FINISHED' or _r.settlement_status = 'PENDING' then
    raise exception 'DORI_ROUND_NOT_SETTLED';
  end if;
  select count(*) into _alive from public.dori_round_players
    where round_id = _round_id and folded = false;
  if _alive >= 2 then raise exception 'DORI_REVEAL_NOT_APPLICABLE'; end if;
  if _r.winner_id is distinct from _uid then raise exception 'DORI_NOT_WINNER'; end if;
  if _r.reveal_choice <> 'PENDING' then
    return jsonb_build_object('ok', true, 'choice', _r.reveal_choice);
  end if;
  update public.dori_rounds
     set reveal_choice = case when _reveal then 'REVEAL' else 'HIDE' end
   where id = _round_id;
  return jsonb_build_object('ok', true, 'choice', case when _reveal then 'REVEAL' else 'HIDE' end);
end $$;

-- 4) 베팅: 기존 섯다와 동일한 액션/금액 체계 재사용 (bet_additional_amount 는 변경하지 않는다)
--    · BET / RAISE 제거, raise 횟수 제한 제거
--    · 금액은 100% 서버 계산 (클라이언트 _amount 무시)
create or replace function public.dori_place_bet(_room_id uuid, _action text, _amount bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid(); _r public.dori_rounds; _me public.dori_round_players;
  _call bigint; _add bigint := 0; _allin boolean := false; _pts bigint;
  _act text := lower(coalesce(_action,'')); _bround int; _new_stage bigint;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- 구 액션명 호환 매핑 (UI 는 섯다와 동일한 이름만 사용한다)
  _act := case _act
            when 'fold' then 'die'
            when 'bet' then 'ping'
            when 'raise' then 'ttadang'
            else _act end;

  select rd.* into _r from public.dori_rounds rd
    where rd.room_id = _room_id and rd.status = 'PLAYING' for update;
  if _r.id is null then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if _r.phase not in ('BETTING_1','BETTING_2','BETTING_FINAL') then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if _r.current_turn_user_id is distinct from _uid then raise exception 'NOT_YOUR_TURN'; end if;
  _bround := case _r.phase when 'BETTING_1' then 1 when 'BETTING_2' then 2 else 3 end;

  select * into _me from public.dori_round_players where round_id = _r.id and user_id = _uid;
  if _me.id is null or _me.folded then raise exception 'DORI_NOT_IN_ROUND'; end if;
  if _me.is_all_in then raise exception 'DORI_ALREADY_ALL_IN'; end if;
  select game_points into _pts from public.profiles where id = _uid;
  _call := greatest(0, _r.current_bet - _me.round_bet);

  if _act = 'die' then
    update public.dori_round_players set folded = true, acted = true, result_type = 'FOLD'
      where id = _me.id;
  elsif _act = 'check' then
    if _call > 0 or _r.current_bet > 0 then raise exception 'DORI_CHECK_NOT_ALLOWED'; end if;
    update public.dori_round_players set acted = true where id = _me.id;
  elsif _act in ('call','ping','ttadang','quarter','half','all_in') then
    if _act = 'call' and _call <= 0 then raise exception 'DORI_NOTHING_TO_CALL'; end if;
    -- 섯다와 동일한 서버 authoritative 금액 계산
    _add := public.bet_additional_amount(_act, _r.pot, _r.current_bet, _r.ante, _me.round_bet, _pts);
    if _add is null then raise exception 'DORI_UNKNOWN_ACTION'; end if;
    if _add <= 0 then raise exception 'DORI_INVALID_AMOUNT'; end if;
    if _add > _pts then raise exception 'DORI_INSUFFICIENT_BALANCE'; end if;
    _allin := (_add = _pts);
    _new_stage := _me.round_bet + _add;
    if _new_stage > _r.current_bet then
      update public.dori_rounds set current_bet = _new_stage where id = _r.id;
    end if;
  else
    raise exception 'DORI_UNKNOWN_ACTION';
  end if;

  if _add > 0 then
    update public.profiles set game_points = game_points - _add where id = _uid;
    insert into public.point_transactions(user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
    values (_uid, 'DORI_BET', -_add, _pts, _pts - _add, 'DORI_ROUND', _r.id, 'DORI_JITGO_DDAENG '||upper(_act));
    update public.dori_round_players
       set round_bet = round_bet + _add, contribution = contribution + _add,
           acted = true, is_all_in = (is_all_in or _allin),
           all_in_at = case when _allin then now() else all_in_at end
     where id = _me.id;
    update public.dori_rounds set pot = pot + _add where id = _r.id;
  end if;

  insert into public.dori_actions(round_id, user_id, action_type, amount, betting_round, turn_number)
  values (_r.id, _uid, upper(_act), coalesce(_add,0), _bround,
          coalesce((select max(turn_number)+1 from public.dori_actions where round_id = _r.id),1));

  perform public.dori_advance(_r.id);
  update public.dori_rooms set updated_at = now() where id = _room_id;
  return jsonb_build_object('ok', true, 'action', upper(_act), 'amount', coalesce(_add,0), 'all_in', _allin);
end $function$;

-- 5) 서버가 계산한 액션 버튼 목록 (금액 = 실제 차감액 = POT 증가량)
create or replace function public.dori_action_options(_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid(); _r public.dori_rounds; _me public.dori_round_players;
  _pts bigint; _call bigint; _out jsonb := '[]'::jsonb; _a text; _amt bigint; _ok boolean; _why text;
begin
  if _uid is null then return _out; end if;
  select rd.* into _r from public.dori_rounds rd
    where rd.room_id = _room_id and rd.status = 'PLAYING';
  if _r.id is null or _r.phase not in ('BETTING_1','BETTING_2','BETTING_FINAL') then return _out; end if;
  select * into _me from public.dori_round_players where round_id = _r.id and user_id = _uid;
  if _me.id is null or _me.folded or _me.is_all_in then return _out; end if;
  select game_points into _pts from public.profiles where id = _uid;
  _call := greatest(0, _r.current_bet - _me.round_bet);

  foreach _a in array array['die','check','call','ping','ttadang','quarter','half','all_in'] loop
    _amt := coalesce(public.bet_additional_amount(_a, _r.pot, _r.current_bet, _r.ante, _me.round_bet, _pts), 0);
    _ok := true; _why := null;
    if _a = 'check' then
      if _r.current_bet > 0 or _call > 0 then _ok := false; _why := '이미 베팅이 시작되었습니다.'; end if;
    elsif _a = 'call' then
      if _call <= 0 then _ok := false; _why := '받을 베팅이 없습니다.'; end if;
    elsif _a = 'all_in' then
      if _pts <= 0 then _ok := false; _why := '보유 포인트가 없습니다.'; end if;
    elsif _a <> 'die' then
      if _amt <= 0 then _ok := false; _why := '사용할 수 없습니다.';
      elsif _amt > _pts then _ok := false; _why := '보유 포인트가 부족합니다.'; end if;
    end if;
    _out := _out || jsonb_build_object(
      'action', _a,
      'amount', case when _a in ('die','check') then 0 else _amt end,
      'enabled', _ok and _r.current_turn_user_id = _uid,
      'reason', _why);
  end loop;
  return _out;
end $$;

-- 6) 방 상태: 쇼다운 공개 정책 반영 + 액션 옵션 + 공개 선택 상태
create or replace function public.dori_room_state(_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid(); _room public.dori_rooms; _r public.dori_rounds;
  _seats jsonb; _mine jsonb; _actions jsonb; _vis int; _mode text; _mysubmit boolean;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _room from public.dori_rooms where id = _room_id;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;
  select * into _r from public.dori_rounds where room_id = _room_id order by round_number desc limit 1;
  _vis := case when _r.id is null then 0 else public.dori_visible_cards(_r.phase) end;
  _mode := case when _r.id is null then 'HIDDEN' else public.dori_reveal_mode(_r.id) end;

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
      order by a.created_at),'[]'::jsonb) into _actions
    from public.dori_actions a where a.round_id = _r.id;

  _mysubmit := _r.id is not null and _r.status = 'FINISHED' and _r.settlement_status <> 'PENDING'
    and _r.reveal_choice = 'PENDING' and _r.winner_id = _uid
    and (select count(*) from public.dori_round_players where round_id = _r.id and folded = false) < 2;

  return jsonb_build_object(
    'room', jsonb_build_object('id',_room.id,'roomNumber',_room.room_number,'title',_room.title,
      'roomType',_room.room_type,
      'ante',_room.ante,'minPoints',_room.min_points,'status',_room.status,'maxPlayers',_room.max_players,
      'isPrivate',_room.is_private,'carryPot',_room.carry_pot,
      'readyRequired', _room.last_dealer_seat is null,
      'lastDealerSeat', _room.last_dealer_seat),
    'round', case when _r.id is null then null else jsonb_build_object(
      'roundId',_r.id,'roundNumber',_r.round_number,'status',_r.status,'phase',_r.phase,
      'dealerSeat',_r.dealer_seat,'pot',_r.pot,'currentBet',_r.current_bet,'raiseCount',0,
      'ante',_r.ante,'turnUserId',_r.current_turn_user_id,'turnDeadline',_r.turn_deadline_at,
      'winnerId',_r.winner_id,'settlementStatus',_r.settlement_status,
      'revealMode', _mode, 'revealChoice', _r.reveal_choice,
      'canChooseReveal', coalesce(_mysubmit,false)) end,
    'seats', _seats,
    'myCards', _mine->'cards',
    'makeOptions', _mine->'options',
    'actionOptions', public.dori_action_options(_room_id),
    'actions', _actions);
end $function$;

-- 7) 좌석 공개 판정 (folded 는 항상 비공개)
create or replace function public.dori_seat_revealed(_mode text, _folded boolean, _result_type text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select case
    when coalesce(_folded, true) then false
    when _mode = 'SHOWDOWN' then true
    when _mode = 'REVEAL' then coalesce(_result_type,'') = 'WIN'
    else false end
$$;

-- 8) 결과 조회: 공개 가능한 패/짓기/승부패/족보 포함 + 베팅 내역
create or replace function public.dori_round_result(_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid(); _r public.dori_rounds; _alive int; _mode text;
  _players jsonb; _payouts jsonb; _actions jsonb;
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

  select count(*) into _alive from public.dori_round_players
    where round_id = _round_id and folded = false;
  _mode := public.dori_reveal_mode(_round_id);

  select coalesce(jsonb_agg(x order by (x->>'seat')::int), '[]'::jsonb) into _players from (
    select jsonb_build_object(
      'userId', rp.user_id,
      'nickname', pr.nickname,
      'seat', rp.seat,
      'resultType', rp.result_type,
      'folded', rp.folded,
      'revealed', rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type),
      'handLabel', case when rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type)
        then rp.hand_label else null end,
      'makeTotal', case when rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type)
        then rp.make_total else null end,
      'isHwang', case when rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type)
        then (rp.make_status = 'HWANG') else null end,
      'cards', case when rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type)
        then (select to_jsonb(array_agg(c.card_code order by c.deal_order))
                from public.dori_cards c where c.round_id = _round_id and c.user_id = rp.user_id)
        else null end,
      'selectedCards', case when rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type)
        then (select to_jsonb(s.selected_card_ids) from public.dori_hand_submissions s
                where s.round_id = _round_id and s.user_id = rp.user_id order by s.created_at desc limit 1)
        else null end,
      'remainingCards', case when rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type)
        then (select to_jsonb(s.remaining_card_ids) from public.dori_hand_submissions s
                where s.round_id = _round_id and s.user_id = rp.user_id order by s.created_at desc limit 1)
        else null end,
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

  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', a.user_id, 'nickname', pr.nickname, 'type', a.action_type,
      'amount', a.amount, 'bettingRound', a.betting_round) order by a.created_at), '[]'::jsonb)
    into _actions
    from public.dori_actions a join public.profiles pr on pr.id = a.user_id
   where a.round_id = _round_id;

  return jsonb_build_object(
    'ready', true,
    'roundId', _r.id,
    'roundNumber', _r.round_number,
    'settlementStatus', _r.settlement_status,
    'pot', _r.pot,
    'winnerId', _r.winner_id,
    'showdown', _alive >= 2,
    'revealMode', _mode,
    'revealChoice', _r.reveal_choice,
    'canChooseReveal', (_alive < 2 and _r.reveal_choice = 'PENDING' and _r.winner_id = _uid),
    'players', _players,
    'payouts', _payouts,
    'actions', _actions);
end $function$;

-- 9) 판 기록 상세 (최근 판) — 공개 정책은 결과 조회와 동일
create or replace function public.dori_round_history(_room_id uuid, _limit int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _uid uuid := auth.uid(); _out jsonb := '[]'::jsonb; _row record;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not exists (select 1 from public.dori_room_players where room_id = _room_id and user_id = _uid) then
    return _out;
  end if;
  for _row in
    select r.id from public.dori_rounds r
     where r.room_id = _room_id and r.status = 'FINISHED' and r.settlement_status <> 'PENDING'
       and exists (select 1 from public.dori_round_players rp where rp.round_id = r.id and rp.user_id = _uid)
     order by r.round_number desc limit greatest(1, least(coalesce(_limit,10), 30))
  loop
    _out := _out || jsonb_build_array(public.dori_round_result(_row.id));
  end loop;
  return _out;
end $$;

-- 10) 베팅 횟수 제한 제거 (레이즈 카운터 사용 중단)
update public.dori_rounds set raise_count = 0 where raise_count <> 0 and status = 'PLAYING';

grant execute on function public.dori_reveal_choice(uuid, boolean) to authenticated;
grant execute on function public.dori_reveal_mode(uuid) to authenticated;
grant execute on function public.dori_seat_revealed(text, boolean, text) to authenticated;
grant execute on function public.dori_action_options(uuid) to authenticated;
grant execute on function public.dori_round_history(uuid, int) to authenticated;