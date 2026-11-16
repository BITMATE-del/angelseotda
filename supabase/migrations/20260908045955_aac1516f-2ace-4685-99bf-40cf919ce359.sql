-- 도리 전용 접속 상태/턴 타임아웃 처리 (기존 섯다 로직과 완전 분리)
create or replace function public.dori_tick(_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _r public.dori_rounds; _me public.dori_round_players; _call bigint;
  _acted int := 0; _pending record; _opts jsonb; _sel text[]; _cards text[];
  _rem text[]; _tot int; _hand jsonb;
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
  if _r.id is null then return jsonb_build_object('ok', true, 'autoActions', 0); end if;
  if _r.turn_deadline_at is null or _r.turn_deadline_at > now() then
    return jsonb_build_object('ok', true, 'autoActions', 0);
  end if;

  if _r.phase in ('BETTING_1','BETTING_FINAL') and _r.current_turn_user_id is not null then
    select * into _me from public.dori_round_players
      where round_id = _r.id and user_id = _r.current_turn_user_id;
    if _me.id is not null and _me.folded = false then
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
      _acted := _acted + 1;
    end loop;
    if _acted > 0 then perform public.dori_advance(_r.id); end if;
  end if;

  update public.dori_rooms set updated_at = now() where id = _room_id;
  return jsonb_build_object('ok', true, 'autoActions', _acted);
end
$$;

revoke all on function public.dori_tick(uuid) from public, anon;
grant execute on function public.dori_tick(uuid) to authenticated;