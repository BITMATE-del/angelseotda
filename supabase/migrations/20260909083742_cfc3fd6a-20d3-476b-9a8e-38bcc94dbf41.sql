-- 1) 좌석에 미접속 미응답 카운터 추가
ALTER TABLE public.dori_room_players
  ADD COLUMN IF NOT EXISTS absence_miss_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS long_absence boolean NOT NULL DEFAULT false;

-- 2) heartbeat: 3회 확정 전 재접속이면 카운터 즉시 리셋
CREATE OR REPLACE FUNCTION public.dori_heartbeat(_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.dori_room_players
     set last_seen_at = now(),
         connection_status = 'CONNECTED',
         absence_miss_count = case when long_absence then absence_miss_count else 0 end
   where room_id = _room_id and user_id = auth.uid();
end $function$;

-- 3) 빈 방 실제 삭제 (환불 먼저, lock + 재검증으로 race 방지)
CREATE OR REPLACE FUNCTION public.dori_cleanup_room(_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _cnt int;
  _carry bigint;
  _base bigint;
  _r record;
  _share bigint;
  _last_round uuid;
  _locked uuid;
begin
  select count(*) into _cnt from public.dori_room_players where room_id = _room_id;

  if _cnt = 0 then
    -- 방 row 를 잠근 뒤 인원/진행중 판을 재검증한다 (동시 입장과의 경합 방지)
    select id into _locked from public.dori_rooms where id = _room_id for update;
    if _locked is null then return; end if;
    if exists (select 1 from public.dori_room_players where room_id = _room_id) then return; end if;
    if exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING') then
      return;
    end if;

    -- 미지급 캐리팟(무승부 이월금)은 삭제 전에 마지막 판 기여도대로 환급한다.
    select carry_pot into _carry from public.dori_rooms where id = _room_id;
    if coalesce(_carry, 0) > 0 then
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
            end if;
          end loop;
        end if;
      end if;
      update public.dori_rooms set carry_pot = 0 where id = _room_id;
    end if;

    -- 실제 row 삭제 (하위 round/card/chat 은 FK CASCADE)
    delete from public.dori_rooms where id = _room_id;
  elsif _cnt < 2 then
    update public.dori_rooms set status = 'WAITING', updated_at = now() where id = _room_id
      and not exists (select 1 from public.dori_rounds where room_id = _room_id and status = 'PLAYING');
  end if;
end
$function$;

-- 4) tick: 미접속 상태에서 "실제로 요구된 자기 액션"을 놓친 경우만 카운트
CREATE OR REPLACE FUNCTION public.dori_tick(_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _r public.dori_rounds; _me public.dori_round_players; _call bigint;
  _acted int := 0; _pending record; _opts jsonb; _sel text[]; _cards text[];
  _rem text[]; _tot int; _hand jsonb; _conn text; _misses int;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- 접속 상태 갱신: 20초 이상 heartbeat 없음 = DISCONNECTED, 3분 이상 = LONG_ABSENCE
  update public.dori_room_players set connection_status = case
      when last_seen_at < now() - interval '3 minutes' then 'LONG_ABSENCE'
      when last_seen_at < now() - interval '20 seconds' then 'DISCONNECTED'
      else 'CONNECTED' end
    where room_id = _room_id;

  select rd.* into _r from public.dori_rounds rd
    where rd.room_id = _room_id and rd.status = 'PLAYING' for update;

  if _r.id is null then
    -- 진행 중인 판이 없으면 장기 미접속 확정 좌석을 즉시 제거한다.
    if exists (select 1 from public.dori_room_players
                where room_id = _room_id and long_absence = true) then
      delete from public.dori_room_players where room_id = _room_id and long_absence = true;
      update public.dori_rooms set updated_at = now() where id = _room_id;
      perform public.dori_cleanup_room(_room_id);
    end if;
    return jsonb_build_object('ok', true, 'autoActions', 0);
  end if;

  if _r.turn_deadline_at is null or _r.turn_deadline_at > now() then
    return jsonb_build_object('ok', true, 'autoActions', 0);
  end if;

  if _r.phase in ('BETTING_1','BETTING_FINAL') and _r.current_turn_user_id is not null then
    select * into _me from public.dori_round_players
      where round_id = _r.id and user_id = _r.current_turn_user_id;
    if _me.id is not null and _me.folded = false and _me.is_all_in = false then
      _call := greatest(0, _r.current_bet - _me.round_bet);
      if _call > 0 then
        update public.dori_round_players set folded = true, acted = true, result_type = 'FOLD'
          where id = _me.id;
        insert into public.dori_actions(round_id, user_id, action_type, amount, betting_round, turn_number)
        values (_r.id, _me.user_id, 'FOLD', 0,
                case when _r.phase = 'BETTING_1' then 1 else 2 end,
                coalesce((select max(turn_number)+1 from public.dori_actions where round_id = _r.id),1));
      else
        update public.dori_round_players set acted = true where id = _me.id;
        insert into public.dori_actions(round_id, user_id, action_type, amount, betting_round, turn_number)
        values (_r.id, _me.user_id, 'CHECK', 0,
                case when _r.phase = 'BETTING_1' then 1 else 2 end,
                coalesce((select max(turn_number)+1 from public.dori_actions where round_id = _r.id),1));
      end if;

      update public.dori_room_players set missed_turn_count = coalesce(missed_turn_count,0) + 1
        where room_id = _room_id and user_id = _me.user_id;

      -- 미접속 상태에서 요구된 액션을 놓친 경우만 absence 카운트
      select connection_status into _conn from public.dori_room_players
        where room_id = _room_id and user_id = _me.user_id;
      if _conn in ('DISCONNECTED','LONG_ABSENCE') then
        update public.dori_room_players
           set absence_miss_count = least(3, coalesce(absence_miss_count,0) + 1)
         where room_id = _room_id and user_id = _me.user_id and long_absence = false
         returning absence_miss_count into _misses;
        if coalesce(_misses,0) >= 3 then
          update public.dori_room_players
             set long_absence = true, leave_pending = true,
                 leave_requested_at = coalesce(leave_requested_at, now()), is_ready = false
           where room_id = _room_id and user_id = _me.user_id;
        end if;
      end if;

      _acted := 1;
      perform public.dori_advance(_r.id);
    end if;
  elsif _r.phase = 'MAKE_SELECTION' then
    -- 짓기 시간 초과: 서버가 최상위 조합을 자동 확정 (조합이 없으면 이미 HWANG 처리됨)
    for _pending in
      select rp.user_id from public.dori_round_players rp
       where rp.round_id = _r.id and rp.folded = false and rp.make_status = 'PENDING'
    loop
      select array_agg(card_code order by deal_order) into _cards
        from public.dori_cards where round_id = _r.id and user_id = _pending.user_id;
      _opts := public.dori_make_options(_cards);
      if jsonb_array_length(_opts) = 0 then
        update public.dori_round_players set make_status = 'HWANG'
          where round_id = _r.id and user_id = _pending.user_id;
      else
        select array_agg(value::text) into _sel
          from jsonb_array_elements_text((_opts->0)->'selected') value;
        select sum(public.dori_month(s)) into _tot from unnest(_sel) s;
        select array_agg(c order by ord) into _rem
          from unnest(_cards) with ordinality as t(c,ord) where not (c = any(_sel));
        _hand := public.dori_eval_pair(public.dori_month(_rem[1]), public.dori_month(_rem[2]));
        insert into public.dori_hand_submissions(round_id, user_id, selected_card_ids, remaining_card_ids,
               make_total, hand_type, hand_rank, hand_label)
        values (_r.id, _pending.user_id, _sel, _rem, _tot, _hand->>'type', (_hand->>'rank')::int, _hand->>'label');
        update public.dori_round_players set make_status = 'MADE'
          where round_id = _r.id and user_id = _pending.user_id;
      end if;

      select connection_status into _conn from public.dori_room_players
        where room_id = _room_id and user_id = _pending.user_id;
      if _conn in ('DISCONNECTED','LONG_ABSENCE') then
        update public.dori_room_players
           set absence_miss_count = least(3, coalesce(absence_miss_count,0) + 1)
         where room_id = _room_id and user_id = _pending.user_id and long_absence = false
         returning absence_miss_count into _misses;
        if coalesce(_misses,0) >= 3 then
          update public.dori_room_players
             set long_absence = true, leave_pending = true,
                 leave_requested_at = coalesce(leave_requested_at, now()), is_ready = false
           where room_id = _room_id and user_id = _pending.user_id;
        end if;
      end if;

      _acted := _acted + 1;
    end loop;
    if _acted > 0 then perform public.dori_advance(_r.id); end if;
  end if;

  update public.dori_rooms set updated_at = now() where id = _room_id;
  return jsonb_build_object('ok', true, 'autoActions', _acted);
end
$function$;

-- 5) 이미 로비에 남아 있는 빈 방 정리 (실제 참가자 0 + 진행중 판 없음)
DO $cleanup$
declare _id uuid;
begin
  for _id in
    select r.id from public.dori_rooms r
     where not exists (select 1 from public.dori_room_players p where p.room_id = r.id)
       and not exists (select 1 from public.dori_rounds d where d.room_id = r.id and d.status = 'PLAYING')
  loop
    perform public.dori_cleanup_room(_id);
  end loop;
end
$cleanup$;
