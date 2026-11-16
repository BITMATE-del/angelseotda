-- ============ 0. 스키마 보강 (도리 전용) ============
alter table public.dori_rooms
  add column if not exists is_private boolean not null default false,
  add column if not exists last_dealer_seat integer,
  add column if not exists keep_dealer boolean not null default false;

create table if not exists public.dori_room_secrets (
  room_id uuid primary key references public.dori_rooms(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);
grant all on public.dori_room_secrets to service_role;
alter table public.dori_room_secrets enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='dori_room_secrets' and policyname='dori_room_secrets_no_direct_access') then
    create policy "dori_room_secrets_no_direct_access" on public.dori_room_secrets for select to authenticated using (false);
  end if;
end $$;

do $$ declare r record; begin
  for r in select conname from pg_constraint where conrelid='public.dori_rounds'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%phase%' loop
    execute format('alter table public.dori_rounds drop constraint %I', r.conname);
  end loop;
  for r in select conname from pg_constraint where conrelid='public.dori_round_players'::regclass and contype='c' and (pg_get_constraintdef(oid) ilike '%make_status%' or pg_get_constraintdef(oid) ilike '%result_type%') loop
    execute format('alter table public.dori_round_players drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.dori_rounds
  add constraint dori_rounds_phase_chk check (phase in ('DEALING','BETTING_1','MAKE_SELECTION','BETTING_FINAL','SHOWDOWN','FINISHED'));
alter table public.dori_round_players
  add constraint dori_round_players_make_status_chk check (make_status in ('PENDING','MADE','HWANG'));
alter table public.dori_round_players
  add constraint dori_round_players_result_chk check (result_type is null or result_type in ('WIN','LOSE','FOLD','REMATCH'));

-- ============ 1. 순수 규칙 헬퍼 ============
create or replace function public.dori_month(_card text)
returns integer language sql immutable set search_path = public as $$
  select case when _card ~ '^[0-9]{2}-' then substring(_card,1,2)::int else 0 end
$$;

create or replace function public.dori_eval_pair(_a integer, _b integer)
returns jsonb language sql immutable set search_path = public as $$
  select case
    when _a = _b then jsonb_build_object(
      'type','DDAENG','value',_a,'rank',10+_a,
      'label', case when _a = 10 then '장땡' else _a::text||'땡' end,
      'code','DDAENG_'||_a::text)
    else jsonb_build_object(
      'type','GGUT','value',(_a+_b)%10,'rank',((_a+_b)%10)+1,
      'label', case when (_a+_b)%10 = 0 then '망통' when (_a+_b)%10 = 9 then '갑오' else ((_a+_b)%10)::text||'끗' end,
      'code','GGUT_'||((_a+_b)%10)::text)
  end
$$;

create or replace function public.dori_hwang()
returns jsonb language sql immutable as $$
  select jsonb_build_object('type','HWANG','value',0,'rank',0,'label','황','code','HWANG')
$$;

-- 5장 → 가능한 짓기 조합 전체 (강한 순)
create or replace function public.dori_make_options(_cards text[])
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  n int := coalesce(array_length(_cards,1),0);
  i int; j int; k int; tot int;
  rem text[]; out jsonb := '[]'::jsonb; sorted jsonb;
begin
  if n < 3 then return out; end if;
  for i in 1..n-2 loop
    for j in i+1..n-1 loop
      for k in j+1..n loop
        tot := public.dori_month(_cards[i]) + public.dori_month(_cards[j]) + public.dori_month(_cards[k]);
        if tot in (10,20,30) then
          select array_agg(c order by ord) into rem
            from unnest(_cards) with ordinality as t(c,ord) where ord not in (i,j,k);
          out := out || jsonb_build_object(
            'selected', to_jsonb(array[_cards[i],_cards[j],_cards[k]]),
            'remaining', to_jsonb(rem),
            'make_total', tot,
            'hand', public.dori_eval_pair(public.dori_month(rem[1]), public.dori_month(rem[2])));
        end if;
      end loop;
    end loop;
  end loop;
  select coalesce(jsonb_agg(e order by (e->'hand'->>'rank')::int desc), '[]'::jsonb) into sorted
    from jsonb_array_elements(out) e;
  return sorted;
end $$;

-- ============ 2. 방 ============
create or replace function public.dori_create_room(
  _title text, _room_type text default 'normal', _ante bigint default 1000,
  _min_points bigint default 0, _is_private boolean default false, _password text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _room_id uuid; _clean text;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if _ante is null or _ante <= 0 then raise exception 'DORI_INVALID_ANTE'; end if;
  _clean := nullif(btrim(coalesce(_title,'')),'');
  if _clean is null then raise exception 'DORI_INVALID_TITLE'; end if;
  if length(_clean) > 24 then _clean := substring(_clean,1,24); end if;
  if _is_private and coalesce(btrim(_password),'') = '' then raise exception 'DORI_PASSWORD_REQUIRED'; end if;

  insert into public.dori_rooms(game_type, room_type, title, max_players, min_points, ante, status, owner_id, is_private)
  values ('DORI_JITGO_DDAENG', coalesce(_room_type,'normal'), _clean, 4, greatest(0, coalesce(_min_points,0)), _ante, 'WAITING', _uid, coalesce(_is_private,false))
  returning id into _room_id;

  if coalesce(_is_private,false) then
    insert into public.dori_room_secrets(room_id, password_hash) values (_room_id, md5(btrim(_password)));
  end if;
  return _room_id;
end $$;

create or replace function public.dori_list_rooms()
returns table(
  id uuid, room_number integer, title text, room_type text, ante bigint, min_points bigint,
  status text, is_private boolean, seated integer, max_players integer, phase text)
language sql security definer set search_path = public as $$
  select r.id, r.room_number, r.title, r.room_type, r.ante, r.min_points, r.status, r.is_private,
         (select count(*)::int from public.dori_room_players p where p.room_id = r.id),
         r.max_players,
         (select rd.phase from public.dori_rounds rd where rd.id = r.current_round_id)
  from public.dori_rooms r
  where r.closed_at is null and r.game_type = 'DORI_JITGO_DDAENG'
  order by r.room_number desc
$$;

-- ============ 3. 좌석 ============
create or replace function public.dori_join_seat(_room_id uuid, _seat integer, _password text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _room public.dori_rooms; _pts bigint; _hash text;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if _seat is null or _seat < 1 or _seat > 4 then raise exception 'DORI_SEAT_OUT_OF_RANGE'; end if;

  select * into _room from public.dori_rooms where id = _room_id and closed_at is null for update;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;

  if _room.is_private then
    select password_hash into _hash from public.dori_room_secrets where room_id = _room_id;
    if _hash is distinct from md5(coalesce(btrim(_password),'')) then raise exception 'DORI_WRONG_PASSWORD'; end if;
  end if;

  select game_points into _pts from public.profiles where id = _uid;
  if coalesce(_pts,0) < greatest(_room.min_points, _room.ante) then raise exception 'DORI_INSUFFICIENT_POINTS'; end if;

  if exists (select 1 from public.dori_room_players where room_id = _room_id and user_id = _uid) then
    update public.dori_room_players set leave_pending = false, leave_requested_at = null,
      connection_status = 'CONNECTED', last_seen_at = now()
      where room_id = _room_id and user_id = _uid;
    return (select seat from public.dori_room_players where room_id = _room_id and user_id = _uid);
  end if;
  if exists (select 1 from public.dori_room_players where user_id = _uid) then
    raise exception 'DORI_ALREADY_IN_ANOTHER_ROOM';
  end if;
  if exists (select 1 from public.dori_room_players where room_id = _room_id and seat = _seat) then
    raise exception 'DORI_SEAT_TAKEN';
  end if;

  begin
    insert into public.dori_room_players(room_id, user_id, seat, entry_balance_snapshot)
    values (_room_id, _uid, _seat, coalesce(_pts,0));
  exception when unique_violation then
    raise exception 'DORI_SEAT_TAKEN';
  end;
  update public.dori_rooms set updated_at = now() where id = _room_id;
  return _seat;
end $$;

create or replace function public.dori_set_ready(_room_id uuid, _ready boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.dori_room_players
     set is_ready = coalesce(_ready,false), ready_at = case when _ready then now() else null end
   where room_id = _room_id and user_id = _uid;
  if not found then raise exception 'DORI_NOT_SEATED'; end if;
  update public.dori_rooms set updated_at = now() where id = _room_id;
  return coalesce(_ready,false);
end $$;

create or replace function public.dori_leave_room(_room_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _round_id uuid; _active boolean := false;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select current_round_id into _round_id from public.dori_rooms where id = _room_id;
  if _round_id is not null then
    select exists(
      select 1 from public.dori_rounds r
        join public.dori_round_players rp on rp.round_id = r.id and rp.user_id = _uid
       where r.id = _round_id and r.status = 'PLAYING' and rp.folded = false)
      into _active;
  end if;

  if _active then
    update public.dori_room_players set leave_pending = true, leave_requested_at = now(), is_ready = false
      where room_id = _room_id and user_id = _uid;
    update public.dori_rooms set updated_at = now() where id = _room_id;
    return 'LEAVE_PENDING';
  end if;

  delete from public.dori_room_players where room_id = _room_id and user_id = _uid;
  update public.dori_rooms set updated_at = now() where id = _room_id;
  perform public.dori_cleanup_room(_room_id);
  return 'LEFT';
end $$;

create or replace function public.dori_cleanup_room(_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _cnt int;
begin
  select count(*) into _cnt from public.dori_room_players where room_id = _room_id;
  if _cnt = 0 then
    update public.dori_rooms set closed_at = now(), close_reason = 'EMPTY', status = 'CLOSED', current_round_id = null
      where id = _room_id and closed_at is null
        and not exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING');
  elsif _cnt < 2 then
    update public.dori_rooms set status = 'WAITING', updated_at = now() where id = _room_id
      and not exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING');
  end if;
end $$;

create or replace function public.dori_heartbeat(_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.dori_room_players set last_seen_at = now(), connection_status = 'CONNECTED'
    where room_id = _room_id and user_id = auth.uid();
end $$;

-- ============ 4. 라운드 시작 ============
create or replace function public.dori_start_round(_room_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _room public.dori_rooms; _seats int[]; _n int; _dealer int; _deck text[];
  _round_id uuid; _idx int := 0; _p record; _card text; _ready_required boolean;
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

  -- Ante 지불 가능 + 나가기 예약이 아닌 좌석만 참가
  select coalesce(array_agg(p.seat order by p.seat),'{}') into _seats
    from public.dori_room_players p
    join public.profiles pr on pr.id = p.user_id
   where p.room_id = _room_id and p.leave_pending = false and pr.game_points >= _room.ante;
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
    update public.profiles set game_points = game_points - _room.ante where id = _p.user_id;
    insert into public.point_transactions(user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
    values (_p.user_id, 'DORI_ANTE', -_room.ante, _p.game_points, _p.game_points - _room.ante, 'DORI_ROUND', _round_id, 'DORI_JITGO_DDAENG ante');
    insert into public.dori_round_players(round_id, user_id, seat, initial_points, contribution, round_bet)
    values (_round_id, _p.user_id, _p.seat, _p.game_points, _room.ante, 0);
    insert into public.dori_actions(round_id, user_id, action_type, amount, betting_round, turn_number)
    values (_round_id, _p.user_id, 'ANTE', _room.ante, 0, 0);
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
     set pot = coalesce(_room.carry_pot,0) + (_room.ante * _n),
         phase = 'BETTING_1',
         current_turn_user_id = (select user_id from public.dori_round_players where round_id = _round_id and seat = _dealer),
         turn_deadline_at = now() + interval '30 seconds',
         last_activity_at = now()
   where id = _round_id;

  update public.dori_rooms
     set current_round_id = _round_id, status = 'PLAYING', carry_pot = 0,
         last_dealer_seat = _dealer, keep_dealer = false, updated_at = now()
   where id = _room_id;
  return _round_id;
end $$;

-- ============ 5. 진행/턴 ============
create or replace function public.dori_advance(_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _r public.dori_rounds; _seats int[]; _dealer int; _alive int; _next uuid;
  _order int[]; _s int; _cur_seat int; _i int; _start int;
begin
  select * into _r from public.dori_rounds where id = _round_id;
  if _r.id is null or _r.status <> 'PLAYING' then return; end if;

  select count(*) into _alive from public.dori_round_players where round_id = _round_id and folded = false;
  if _alive <= 1 then
    update public.dori_rounds set phase = 'SHOWDOWN', current_turn_user_id = null where id = _round_id;
    perform public.dori_settle_round(_round_id);
    return;
  end if;

  if _r.phase = 'MAKE_SELECTION' then
    if not exists (select 1 from public.dori_round_players
                    where round_id = _round_id and folded = false and make_status = 'PENDING') then
      update public.dori_rounds set phase = 'BETTING_FINAL', current_bet = 0, raise_count = 0,
             turn_deadline_at = now() + interval '30 seconds' where id = _round_id;
      update public.dori_round_players set acted = false, round_bet = 0 where round_id = _round_id;
      select * into _r from public.dori_rounds where id = _round_id;
    else
      update public.dori_rounds set current_turn_user_id = null where id = _round_id;
      return;
    end if;
  end if;

  if _r.phase in ('BETTING_1','BETTING_FINAL') then
    if not exists (
      select 1 from public.dori_round_players
       where round_id = _round_id and folded = false and is_all_in = false
         and (acted = false or round_bet < _r.current_bet))
    then
      if _r.phase = 'BETTING_1' then
        update public.dori_rounds set phase = 'MAKE_SELECTION', current_turn_user_id = null,
               current_bet = 0, raise_count = 0, turn_deadline_at = now() + interval '60 seconds'
          where id = _round_id;
        update public.dori_round_players set acted = false, round_bet = 0 where round_id = _round_id;
        update public.dori_round_players rp set make_status = 'HWANG'
          where rp.round_id = _round_id and rp.folded = false
            and jsonb_array_length(public.dori_make_options(
                 (select array_agg(c.card_code order by c.deal_order) from public.dori_cards c
                   where c.round_id = _round_id and c.user_id = rp.user_id))) = 0;
        perform public.dori_advance(_round_id);
        return;
      else
        update public.dori_rounds set phase = 'SHOWDOWN', current_turn_user_id = null where id = _round_id;
        perform public.dori_settle_round(_round_id);
        return;
      end if;
    end if;

    -- 다음 행동자: 선 기준 좌석 순환
    select coalesce(array_agg(seat order by seat),'{}') into _seats
      from public.dori_round_players where round_id = _round_id;
    select seat into _cur_seat from public.dori_round_players
      where round_id = _round_id and user_id = _r.current_turn_user_id;
    if _cur_seat is null then _cur_seat := _r.dealer_seat - 1; end if;

    _next := null;
    for _i in 0..3 loop
      _s := ((_cur_seat - 1 + _i + 1) % 4) + 1;
      select user_id into _next from public.dori_round_players
        where round_id = _round_id and seat = _s and folded = false and is_all_in = false
          and (acted = false or round_bet < _r.current_bet);
      if _next is not null then exit; end if;
    end loop;
    if _next is null then
      select user_id into _next from public.dori_round_players
        where round_id = _round_id and folded = false and is_all_in = false
          and (acted = false or round_bet < _r.current_bet) order by seat limit 1;
    end if;
    update public.dori_rounds set current_turn_user_id = _next,
           turn_deadline_at = now() + interval '30 seconds', last_activity_at = now()
      where id = _round_id;
  end if;
end $$;

-- ============ 6. 베팅 ============
create or replace function public.dori_place_bet(_room_id uuid, _action text, _amount bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid(); _r public.dori_rounds; _me public.dori_round_players;
  _call bigint; _add bigint := 0; _allin boolean := false; _pts bigint; _act text := upper(coalesce(_action,''));
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select rd.* into _r from public.dori_rounds rd
    where rd.room_id = _room_id and rd.status = 'PLAYING' for update;
  if _r.id is null then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if _r.phase not in ('BETTING_1','BETTING_FINAL') then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if _r.current_turn_user_id is distinct from _uid then raise exception 'NOT_YOUR_TURN'; end if;

  select * into _me from public.dori_round_players where round_id = _r.id and user_id = _uid;
  if _me.id is null or _me.folded then raise exception 'DORI_NOT_IN_ROUND'; end if;
  select game_points into _pts from public.profiles where id = _uid;
  _call := greatest(0, _r.current_bet - _me.round_bet);

  if _act = 'FOLD' then
    update public.dori_round_players set folded = true, acted = true, result_type = 'FOLD'
      where id = _me.id;
  elsif _act = 'CHECK' then
    if _call > 0 or _r.current_bet > 0 then raise exception 'DORI_CHECK_NOT_ALLOWED'; end if;
    update public.dori_round_players set acted = true where id = _me.id;
  elsif _act = 'BET' then
    if _r.current_bet > 0 then raise exception 'DORI_BET_ALREADY_OPENED'; end if;
    if coalesce(_amount,0) <= 0 then raise exception 'DORI_INVALID_AMOUNT'; end if;
    if _amount > _pts then raise exception 'DORI_INSUFFICIENT_BALANCE'; end if;
    _add := _amount;
    update public.dori_rounds set current_bet = _me.round_bet + _add where id = _r.id;
  elsif _act = 'CALL' then
    if _call <= 0 then raise exception 'DORI_NOTHING_TO_CALL'; end if;
    if _pts < _call then _add := _pts; _allin := true; else _add := _call; end if;
  elsif _act = 'ALL_IN' then
    if _call <= 0 then raise exception 'DORI_NOTHING_TO_CALL'; end if;
    if _pts >= _call then raise exception 'DORI_ALL_IN_NOT_ALLOWED'; end if;
    _add := _pts; _allin := true;
  elsif _act = 'RAISE' then
    if _r.raise_count >= 3 then raise exception 'RAISE_LIMIT_REACHED'; end if;
    if coalesce(_amount,0) <= _r.current_bet then raise exception 'DORI_INVALID_AMOUNT'; end if;
    _add := _amount - _me.round_bet;
    if _add > _pts then raise exception 'DORI_INSUFFICIENT_BALANCE'; end if;
    update public.dori_rounds set current_bet = _amount, raise_count = raise_count + 1 where id = _r.id;
  else
    raise exception 'DORI_UNKNOWN_ACTION';
  end if;

  if _add > 0 then
    update public.profiles set game_points = game_points - _add where id = _uid;
    insert into public.point_transactions(user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
    values (_uid, 'DORI_BET', -_add, _pts, _pts - _add, 'DORI_ROUND', _r.id, 'DORI_JITGO_DDAENG '||_act);
    update public.dori_round_players
       set round_bet = round_bet + _add, contribution = contribution + _add,
           acted = true, is_all_in = (is_all_in or _allin),
           all_in_at = case when _allin then now() else all_in_at end
     where id = _me.id;
    update public.dori_rounds set pot = pot + _add where id = _r.id;
  end if;

  insert into public.dori_actions(round_id, user_id, action_type, amount, betting_round, turn_number)
  values (_r.id, _uid, case when _allin and _act = 'CALL' then 'ALL_IN' else _act end, coalesce(_add,0),
          case when _r.phase = 'BETTING_1' then 1 else 2 end,
          coalesce((select max(turn_number)+1 from public.dori_actions where round_id = _r.id),1));

  perform public.dori_advance(_r.id);
  update public.dori_rooms set updated_at = now() where id = _room_id;
  return jsonb_build_object('ok', true, 'action', _act, 'amount', coalesce(_add,0), 'all_in', _allin);
end $$;

-- ============ 7. 짓기 ============
create or replace function public.dori_my_cards(_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _round_id uuid; _cards text[];
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select rd.id into _round_id from public.dori_rounds rd
    where rd.room_id = _room_id and rd.status = 'PLAYING' limit 1;
  if _round_id is null then return jsonb_build_object('cards','[]'::jsonb,'options','[]'::jsonb); end if;
  select array_agg(card_code order by deal_order) into _cards
    from public.dori_cards where round_id = _round_id and user_id = _uid;
  if _cards is null then return jsonb_build_object('cards','[]'::jsonb,'options','[]'::jsonb); end if;
  return jsonb_build_object('cards', to_jsonb(_cards), 'options', public.dori_make_options(_cards));
end $$;

create or replace function public.dori_submit_make(_room_id uuid, _selected text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid(); _r public.dori_rounds; _cards text[]; _rem text[];
  _tot int; _hand jsonb; _c text;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select rd.* into _r from public.dori_rounds rd where rd.room_id = _room_id and rd.status = 'PLAYING' for update;
  if _r.id is null or _r.phase <> 'MAKE_SELECTION' then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.dori_round_players where round_id = _r.id and user_id = _uid and folded = false and make_status = 'PENDING')
    then raise exception 'INVALID_MAKE_SELECTION'; end if;
  if coalesce(array_length(_selected,1),0) <> 3 then raise exception 'DORI_MAKE_NOT_THREE_CARDS'; end if;
  if (select count(distinct s) from unnest(_selected) s) <> 3 then raise exception 'DORI_MAKE_DUPLICATE_CARD'; end if;

  select array_agg(card_code order by deal_order) into _cards
    from public.dori_cards where round_id = _r.id and user_id = _uid;
  foreach _c in array _selected loop
    if not (_c = any(_cards)) then raise exception 'DORI_MAKE_CARD_NOT_OWNED'; end if;
  end loop;

  select sum(public.dori_month(s)) into _tot from unnest(_selected) s;
  if _tot not in (10,20,30) then raise exception 'DORI_MAKE_INVALID_TOTAL'; end if;
  select array_agg(c order by ord) into _rem
    from unnest(_cards) with ordinality as t(c,ord) where not (c = any(_selected));
  if coalesce(array_length(_rem,1),0) <> 2 then raise exception 'INVALID_MAKE_SELECTION'; end if;
  _hand := public.dori_eval_pair(public.dori_month(_rem[1]), public.dori_month(_rem[2]));

  insert into public.dori_hand_submissions(round_id, user_id, selected_card_ids, remaining_card_ids, make_total, hand_type, hand_rank, hand_label)
  values (_r.id, _uid, _selected, _rem, _tot, _hand->>'type', (_hand->>'rank')::int, _hand->>'label');
  update public.dori_round_players set make_status = 'MADE' where round_id = _r.id and user_id = _uid;

  perform public.dori_advance(_r.id);
  update public.dori_rooms set updated_at = now() where id = _room_id;
  return jsonb_build_object('ok', true, 'make_total', _tot, 'hand', _hand);
end $$;

-- ============ 8. 정산 ============
create or replace function public.dori_settle_round(_round_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  _r public.dori_rounds; _room public.dori_rooms; _p record; _sub record;
  _levels bigint[]; _lvl bigint; _prev bigint := 0; _amount bigint; _win record;
  _top int; _tie int; _rematch boolean := false; _pts bigint; _remain int;
begin
  select * into _r from public.dori_rounds where id = _round_id for update;
  if _r.id is null or _r.status <> 'PLAYING' then return; end if;
  select * into _room from public.dori_rooms where id = _r.room_id for update;

  -- 족보 확정 (제출한 짓기 결과 / 황)
  for _p in select * from public.dori_round_players where round_id = _round_id and folded = false loop
    select * into _sub from public.dori_hand_submissions where round_id = _round_id and user_id = _p.user_id
      order by created_at desc limit 1;
    if _sub.id is not null then
      update public.dori_round_players set make_status = 'MADE', make_total = _sub.make_total,
        hand_type = _sub.hand_type, hand_rank = _sub.hand_rank, hand_label = _sub.hand_label
        where id = _p.id;
    else
      update public.dori_round_players set make_status = 'HWANG', hand_type = 'HWANG',
        hand_rank = 0, hand_label = '황' where id = _p.id;
    end if;
  end loop;

  select max(hand_rank) into _top from public.dori_round_players where round_id = _round_id and folded = false;
  select count(*) into _tie from public.dori_round_players
    where round_id = _round_id and folded = false and hand_rank = _top;
  select count(*) into _remain from public.dori_round_players where round_id = _round_id and folded = false;
  _rematch := (_remain > 1 and _tie > 1);

  if _rematch then
    update public.dori_round_players set result_type = 'REMATCH'
      where round_id = _round_id and folded = false;
    update public.dori_rounds set status = 'FINISHED', phase = 'FINISHED', settlement_status = 'REMATCH',
      settled_at = now(), finished_at = now(), winner_id = null where id = _round_id;
    update public.dori_rooms set carry_pot = _r.pot, keep_dealer = true, current_round_id = null,
      status = 'WAITING', updated_at = now() where id = _r.room_id;
  else
    -- SIDE POT 레이어별 지급
    select coalesce(array_agg(distinct contribution order by contribution),'{}') into _levels
      from public.dori_round_players where round_id = _round_id and contribution > 0;
    foreach _lvl in array _levels loop
      select coalesce(sum(least(contribution,_lvl) - _prev),0) into _amount
        from public.dori_round_players where round_id = _round_id and contribution > _prev;
      if _prev = 0 then _amount := _amount + coalesce(_r.carry_pot,0); end if;
      if _amount > 0 then
        select rp.* into _win from public.dori_round_players rp
          where rp.round_id = _round_id and rp.folded = false and rp.contribution >= _lvl
          order by rp.hand_rank desc, rp.seat asc limit 1;
        if _win.id is not null then
          select game_points into _pts from public.profiles where id = _win.user_id;
          update public.profiles set game_points = game_points + _amount where id = _win.user_id;
          insert into public.point_transactions(user_id, type, amount, balance_before, balance_after, reference_type, reference_id, memo)
          values (_win.user_id, 'DORI_WIN', _amount, _pts, _pts + _amount, 'DORI_ROUND', _round_id, 'DORI_JITGO_DDAENG payout');
        end if;
      end if;
      _prev := _lvl;
    end loop;

    update public.dori_round_players set result_type = case when hand_rank = _top then 'WIN' else 'LOSE' end
      where round_id = _round_id and folded = false;
    update public.dori_rounds set status = 'FINISHED', phase = 'FINISHED', settlement_status = 'DONE',
      settled_at = now(), finished_at = now(),
      winner_id = (select user_id from public.dori_round_players
                    where round_id = _round_id and folded = false order by hand_rank desc, seat asc limit 1)
      where id = _round_id;
    update public.dori_rooms set carry_pot = 0, keep_dealer = false, current_round_id = null,
      status = 'WAITING', updated_at = now() where id = _r.room_id;
  end if;

  update public.dori_round_players rp set final_points = pr.game_points
    from public.profiles pr where pr.id = rp.user_id and rp.round_id = _round_id;

  -- 나가기 예약 / 잔액 0 퇴장
  delete from public.dori_room_players where room_id = _r.room_id and leave_pending = true;
  delete from public.dori_room_players p using public.profiles pr
    where p.room_id = _r.room_id and pr.id = p.user_id and pr.game_points <= 0;

  perform public.dori_cleanup_room(_r.room_id);
end $$;

-- ============ 9. 상태 조회 (hidden card 마스킹) ============
create or replace function public.dori_room_state(_room_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid(); _room public.dori_rooms; _r public.dori_rounds;
  _seats jsonb; _mine jsonb; _actions jsonb; _showdown boolean;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _room from public.dori_rooms where id = _room_id;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;
  select * into _r from public.dori_rounds where room_id = _room_id order by round_number desc limit 1;
  _showdown := _r.id is not null and _r.phase in ('SHOWDOWN','FINISHED');

  select coalesce(jsonb_agg(x order by x->>'seat'),'[]'::jsonb) into _seats from (
    select jsonb_build_object(
      'seat', p.seat,
      'userId', p.user_id,
      'nickname', pr.nickname,
      'rank', pr.rank,
      'level', pr.level,
      'avatarUrl', pr.avatar_url,
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
      'makeStatus', rp.make_status,
      'resultType', rp.result_type,
      'cardCount', (select count(*) from public.dori_cards c where c.round_id = _r.id and c.user_id = p.user_id),
      'handLabel', case when _showdown then rp.hand_label else null end,
      'handRank', case when _showdown then rp.hand_rank else null end,
      'makeTotal', case when _showdown then rp.make_total else null end,
      'selectedCards', case when _showdown or p.user_id = _uid then
          (select to_jsonb(s.selected_card_ids) from public.dori_hand_submissions s
            where s.round_id = _r.id and s.user_id = p.user_id order by s.created_at desc limit 1)
        else null end,
      'remainingCards', case when _showdown or p.user_id = _uid then
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

  return jsonb_build_object(
    'room', jsonb_build_object('id',_room.id,'roomNumber',_room.room_number,'title',_room.title,
      'ante',_room.ante,'minPoints',_room.min_points,'status',_room.status,'maxPlayers',_room.max_players,
      'isPrivate',_room.is_private,'carryPot',_room.carry_pot,
      'readyRequired', _room.last_dealer_seat is null,
      'lastDealerSeat', _room.last_dealer_seat),
    'round', case when _r.id is null then null else jsonb_build_object(
      'roundId',_r.id,'roundNumber',_r.round_number,'status',_r.status,'phase',_r.phase,
      'dealerSeat',_r.dealer_seat,'pot',_r.pot,'currentBet',_r.current_bet,'raiseCount',_r.raise_count,
      'ante',_r.ante,'turnUserId',_r.current_turn_user_id,'turnDeadline',_r.turn_deadline_at,
      'winnerId',_r.winner_id,'settlementStatus',_r.settlement_status) end,
    'seats', _seats,
    'myCards', _mine->'cards',
    'makeOptions', _mine->'options',
    'actions', _actions);
end $$;

-- ============ 10. 권한 ============
revoke all on function public.dori_advance(uuid) from public, anon, authenticated;
revoke all on function public.dori_settle_round(uuid) from public, anon, authenticated;
revoke all on function public.dori_cleanup_room(uuid) from public, anon, authenticated;
grant execute on function public.dori_month(text), public.dori_eval_pair(integer,integer), public.dori_hwang(),
  public.dori_make_options(text[]) to authenticated;
grant execute on function public.dori_create_room(text,text,bigint,bigint,boolean,text) to authenticated;
grant execute on function public.dori_list_rooms() to authenticated;
grant execute on function public.dori_join_seat(uuid,integer,text) to authenticated;
grant execute on function public.dori_set_ready(uuid,boolean) to authenticated;
grant execute on function public.dori_leave_room(uuid) to authenticated;
grant execute on function public.dori_heartbeat(uuid) to authenticated;
grant execute on function public.dori_start_round(uuid) to authenticated;
grant execute on function public.dori_place_bet(uuid,text,bigint) to authenticated;
grant execute on function public.dori_my_cards(uuid) to authenticated;
grant execute on function public.dori_submit_make(uuid,text[]) to authenticated;
grant execute on function public.dori_room_state(uuid) to authenticated;