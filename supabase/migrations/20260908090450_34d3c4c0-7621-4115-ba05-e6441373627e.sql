-- DORI: staged dealing (3 -> 4 -> 5), make-state masking, grade-enforced rooms.
-- 기존 섯다 관련 테이블/함수는 변경하지 않는다.

ALTER TABLE public.dori_rounds DROP CONSTRAINT IF EXISTS dori_rounds_phase_chk;
ALTER TABLE public.dori_rounds ADD CONSTRAINT dori_rounds_phase_chk
  CHECK (phase = ANY (ARRAY['DEALING','BETTING_1','BETTING_2','MAKE_SELECTION','BETTING_FINAL','SHOWDOWN','FINISHED']));

CREATE OR REPLACE FUNCTION public.dori_visible_cards(_phase text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT case _phase
    when 'DEALING' then 0
    when 'BETTING_1' then 3
    when 'BETTING_2' then 4
    else 5 end
$$;

-- 등급 프리셋 (서버 강제)
CREATE OR REPLACE FUNCTION public.dori_grade_preset(_grade text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT case lower(coalesce(_grade,''))
    when 'beginner' then jsonb_build_object('id','beginner','name','초보방','min_points',100000,'ante',1000)
    when 'normal'   then jsonb_build_object('id','normal','name','일반방','min_points',300000,'ante',2000)
    when 'expert'   then jsonb_build_object('id','expert','name','고수방','min_points',800000,'ante',3500)
    else null end
$$;

CREATE OR REPLACE FUNCTION public.dori_create_room(_title text, _room_type text DEFAULT 'normal'::text, _ante bigint DEFAULT 1000, _min_points bigint DEFAULT 0, _is_private boolean DEFAULT false, _password text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _uid uuid := auth.uid(); _room_id uuid; _clean text; _preset jsonb; _grade text;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  _grade := lower(coalesce(_room_type,'normal'));
  _preset := public.dori_grade_preset(_grade);
  if _preset is null then raise exception 'DORI_INVALID_ROOM_TYPE'; end if;

  _clean := nullif(btrim(coalesce(_title,'')),'');
  if _clean is null then raise exception 'DORI_INVALID_TITLE'; end if;
  if length(_clean) > 24 then _clean := substring(_clean,1,24); end if;
  if _is_private and coalesce(btrim(_password),'') = '' then raise exception 'DORI_PASSWORD_REQUIRED'; end if;

  insert into public.dori_rooms(game_type, room_type, title, max_players, min_points, ante, status, owner_id, is_private)
  values ('DORI_JITGO_DDAENG', _grade, _clean, 4,
          (_preset->>'min_points')::bigint, (_preset->>'ante')::bigint,
          'WAITING', _uid, coalesce(_is_private,false))
  returning id into _room_id;

  if coalesce(_is_private,false) then
    insert into public.dori_room_secrets(room_id, password_hash) values (_room_id, md5(btrim(_password)));
  end if;
  return _room_id;
end $function$;

-- 내 카드: 현재 단계에서 지급된 장수만 반환. 짓기 후보는 5장일 때만 계산.
CREATE OR REPLACE FUNCTION public.dori_my_cards(_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _uid uuid := auth.uid(); _r public.dori_rounds; _cards text[]; _vis int;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select rd.* into _r from public.dori_rounds rd
    where rd.room_id = _room_id and rd.status = 'PLAYING' limit 1;
  if _r.id is null then return jsonb_build_object('cards','[]'::jsonb,'options','[]'::jsonb); end if;
  _vis := public.dori_visible_cards(_r.phase);
  select array_agg(card_code order by deal_order) into _cards
    from public.dori_cards where round_id = _r.id and user_id = _uid and deal_order <= _vis;
  if _cards is null then return jsonb_build_object('cards','[]'::jsonb,'options','[]'::jsonb); end if;
  return jsonb_build_object(
    'cards', to_jsonb(_cards),
    'options', case when coalesce(array_length(_cards,1),0) = 5
                    then public.dori_make_options(_cards) else '[]'::jsonb end);
end $function$;

-- 단계 진행: 3장 베팅 -> 4장 베팅 -> 짓기 -> 최종 베팅 -> 쇼다운
CREATE OR REPLACE FUNCTION public.dori_advance(_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  _r public.dori_rounds; _alive int; _next uuid;
  _s int; _cur_seat int; _i int;
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
             current_turn_user_id = null, turn_deadline_at = now() + interval '30 seconds'
       where id = _round_id;
      update public.dori_round_players set acted = false, round_bet = 0 where round_id = _round_id;
      select * into _r from public.dori_rounds where id = _round_id;
    else
      update public.dori_rounds set current_turn_user_id = null where id = _round_id;
      return;
    end if;
  end if;

  if _r.phase in ('BETTING_1','BETTING_2','BETTING_FINAL') then
    if not exists (
      select 1 from public.dori_round_players
       where round_id = _round_id and folded = false and is_all_in = false
         and (acted = false or round_bet < _r.current_bet))
    then
      if _r.phase = 'BETTING_1' then
        update public.dori_rounds set phase = 'BETTING_2', current_turn_user_id = null,
               current_bet = 0, raise_count = 0, turn_deadline_at = now() + interval '30 seconds'
          where id = _round_id;
        update public.dori_round_players set acted = false, round_bet = 0 where round_id = _round_id;
        perform public.dori_advance(_round_id);
        return;
      elsif _r.phase = 'BETTING_2' then
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
end $function$;

-- 베팅: BETTING_2 단계 허용 + 베팅 라운드 번호 1/2/3
CREATE OR REPLACE FUNCTION public.dori_place_bet(_room_id uuid, _action text, _amount bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  _uid uuid := auth.uid(); _r public.dori_rounds; _me public.dori_round_players;
  _call bigint; _add bigint := 0; _allin boolean := false; _pts bigint; _act text := upper(coalesce(_action,''));
  _bround int;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select rd.* into _r from public.dori_rounds rd
    where rd.room_id = _room_id and rd.status = 'PLAYING' for update;
  if _r.id is null then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if _r.phase not in ('BETTING_1','BETTING_2','BETTING_FINAL') then raise exception 'ROUND_NOT_ACTIVE'; end if;
  if _r.current_turn_user_id is distinct from _uid then raise exception 'NOT_YOUR_TURN'; end if;
  _bround := case _r.phase when 'BETTING_1' then 1 when 'BETTING_2' then 2 else 3 end;

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
          _bround,
          coalesce((select max(turn_number)+1 from public.dori_actions where round_id = _r.id),1));

  perform public.dori_advance(_r.id);
  update public.dori_rooms set updated_at = now() where id = _room_id;
  return jsonb_build_object('ok', true, 'action', _act, 'amount', coalesce(_add,0), 'all_in', _allin);
end $function$;

-- 방 상태: 상대 짓기 상태 마스킹 + 단계별 보이는 장수만 노출
CREATE OR REPLACE FUNCTION public.dori_room_state(_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  _uid uuid := auth.uid(); _room public.dori_rooms; _r public.dori_rounds;
  _seats jsonb; _mine jsonb; _actions jsonb; _showdown boolean; _vis int;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _room from public.dori_rooms where id = _room_id;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;
  select * into _r from public.dori_rounds where room_id = _room_id order by round_number desc limit 1;
  _showdown := _r.id is not null and _r.phase in ('SHOWDOWN','FINISHED');
  _vis := case when _r.id is null then 0 else public.dori_visible_cards(_r.phase) end;

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
      -- 상대의 짓기 성공/황 여부는 쇼다운 전까지 감춘다 (본인 제외)
      'makeStatus', case when _showdown or p.user_id = _uid then rp.make_status
                         when rp.id is null then null
                         when rp.make_status is null then null
                         when rp.make_status = 'PENDING' then 'PENDING'
                         else 'SUBMITTED' end,
      'resultType', rp.result_type,
      'cardCount', (select count(*) from public.dori_cards c
                     where c.round_id = _r.id and c.user_id = p.user_id and c.deal_order <= _vis),
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
      'roomType',_room.room_type,
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
end $function$;
