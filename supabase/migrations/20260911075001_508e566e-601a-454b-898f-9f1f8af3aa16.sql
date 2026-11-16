-- SPECIAL HAND RULE PATCH: 도리짓고땡 특수족보(땡잡이/구사/멍텅구리구사) 활성화
ALTER TABLE public.dori_hand_submissions ADD COLUMN IF NOT EXISTS hand_code text;
ALTER TABLE public.dori_round_players   ADD COLUMN IF NOT EXISTS hand_code text;
ALTER TABLE public.dori_round_players   ADD COLUMN IF NOT EXISTS effective_rank int;
ALTER TABLE public.dori_rounds          ADD COLUMN IF NOT EXISTS rematch_reason text;

-- 특수족보 카드 identity 는 섯다와 동일한 source of truth(public.sutda_special_cards)를 사용한다.
CREATE OR REPLACE FUNCTION public.dori_special_hand(_c1 text, _c2 text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  sp jsonb := public.sutda_special_cards();
  a int := public.dori_month(_c1);
  b int := public.dori_month(_c2);
  lo int := LEAST(a,b); hi int := GREATEST(a,b);
BEGIN
  IF public.sutda_is_pair(_c1,_c2, sp->'ttaengjabi') THEN
    RETURN jsonb_build_object('type','TTAENGJABI','value',0,'rank',1,'label','땡잡이','code','TTAENGJABI');
  END IF;
  IF lo = 4 AND hi = 9 THEN
    IF public.sutda_is_pair(_c1,_c2, sp->'gusa_meongteong') THEN
      RETURN jsonb_build_object('type','GUSA','value',0,'rank',4,'label','멍텅구리구사','code','MUNG_GUSA');
    END IF;
    RETURN jsonb_build_object('type','GUSA','value',0,'rank',4,'label','구사','code','GUSA');
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.dori_eval_pair_cards(_c1 text, _c2 text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(public.dori_special_hand(_c1,_c2),
                  public.dori_eval_pair(public.dori_month(_c1), public.dori_month(_c2)));
$$;

CREATE OR REPLACE FUNCTION public.dori_make_options(_cards text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
            'hand', public.dori_eval_pair_cards(rem[1], rem[2]));
        end if;
      end loop;
    end loop;
  end loop;
  select coalesce(jsonb_agg(e order by (e->'hand'->>'rank')::int desc), '[]'::jsonb) into sorted
    from jsonb_array_elements(out) e;
  return sorted;
end $function$;

CREATE OR REPLACE FUNCTION public.dori_submit_make(_room_id uuid, _selected text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _hand := public.dori_eval_pair_cards(_rem[1], _rem[2]);

  insert into public.dori_hand_submissions(round_id, user_id, selected_card_ids, remaining_card_ids, make_total, hand_type, hand_rank, hand_label, hand_code)
  values (_r.id, _uid, _selected, _rem, _tot, _hand->>'type', (_hand->>'rank')::int, _hand->>'label', _hand->>'code');
  update public.dori_round_players set make_status = 'MADE' where round_id = _r.id and user_id = _uid;

  perform public.dori_advance(_r.id);
  update public.dori_rooms set updated_at = now() where id = _room_id;
  return jsonb_build_object('ok', true, 'make_total', _tot, 'hand', _hand);
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

  -- 족보 확정 (제출한 짓기 결과 / 황)
  for _p in select * from public.dori_round_players where round_id = _round_id and folded = false loop
    select * into _sub from public.dori_hand_submissions where round_id = _round_id and user_id = _p.user_id
      order by created_at desc limit 1;
    if _sub.id is not null then
      update public.dori_round_players set make_status = 'MADE', make_total = _sub.make_total,
        hand_type = _sub.hand_type, hand_rank = _sub.hand_rank, hand_label = _sub.hand_label,
        hand_code = _sub.hand_code
        where id = _p.id;
    else
      -- 짓기 불가(황)는 특수족보 판정 대상이 아니다.
      update public.dori_round_players set make_status = 'HWANG', hand_type = 'HWANG',
        hand_rank = 0, hand_label = '황', hand_code = 'HWANG' where id = _p.id;
    end if;
  end loop;

  -- 특수족보 contextual 비교 (섯다 규칙과 동일한 조건 재사용)
  for _p in select * from public.dori_round_players where round_id = _round_id and folded = false loop
    _eff := coalesce(_p.hand_rank,0) * 10;
    if _p.hand_code = 'TTAENGJABI' then
      if exists (select 1 from public.dori_round_players o
                  where o.round_id = _round_id and o.folded = false and o.id <> _p.id
                    and o.hand_code ~ '^DDAENG_[1-9]$')
      then _eff := 195;   -- 1~9땡을 잡는다 (장땡에는 지고 장땡 아래 땡은 잡는다)
      else _eff := 10;    -- 잡을 땡이 없으면 망통급
      end if;
    elsif _p.hand_code in ('GUSA','MUNG_GUSA') then
      select coalesce(max(coalesce(o.hand_rank,0)),0) into _other_best
        from public.dori_round_players o
       where o.round_id = _round_id and o.folded = false and o.id <> _p.id
         and coalesce(o.hand_code,'') not in ('GUSA','MUNG_GUSA');
      if (_p.hand_code = 'GUSA' and _other_best <= 10)         -- 갑오 이하
         or (_p.hand_code = 'MUNG_GUSA' and _other_best <= 19) -- 9땡 이하
      then
        _rematch := true;
        _reason := case when _p.hand_code = 'MUNG_GUSA' then '멍텅구리구사 성립 · 재경기'
                        else '구사 성립 · 재경기' end;
      else
        _eff := 40; -- 재경기 조건 미달 구사는 3끗 처리
      end if;
    end if;
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
          order by rp.effective_rank desc, rp.seat asc limit 1;
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

  -- 나가기 예약 / 잔액 0 퇴장
  delete from public.dori_room_players where room_id = _r.room_id and leave_pending = true;
  delete from public.dori_room_players p using public.profiles pr
    where p.room_id = _r.room_id and pr.id = p.user_id and pr.game_points <= 0;

  perform public.dori_cleanup_room(_r.room_id);
end $function$;