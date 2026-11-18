CREATE OR REPLACE FUNCTION public.dori_place_bet(_room_id uuid, _action text, _amount bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  _uid uuid := auth.uid(); _r public.dori_rounds; _me public.dori_round_players;
  _call bigint; _add bigint := 0; _allin boolean := false; _pts bigint;
  _act text := lower(coalesce(_action,'')); _bround int; _new_stage bigint;
  _alive int; _actionable int;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

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

  select count(*) into _alive from public.dori_round_players where round_id = _r.id and folded = false;
  _actionable := public.dori_actionable_betting_count(_r.id);
  if _actionable <= 1 and _alive > 1 then
    perform public.dori_advance(_r.id);
    raise exception 'DORI_NO_OPPONENT_TO_BET';
  end if;

  select game_points into _pts from public.profiles where id = _uid;
  _call := greatest(0, _r.current_bet - _me.round_bet);

  if _act = 'die' then
    if _alive <= 1 then raise exception 'DORI_LAST_PLAYER_CANNOT_FOLD'; end if;
    update public.dori_round_players set folded = true, acted = true, result_type = 'FOLD'
      where id = _me.id;
  elsif _act = 'check' then
    if _call > 0 or _r.current_bet > 0 then raise exception 'DORI_CHECK_NOT_ALLOWED'; end if;
    update public.dori_round_players set acted = true where id = _me.id;
  elsif _act in ('call','ping','ttadang','quarter','half','all_in') then
    if _act = 'call' and _call <= 0 then raise exception 'DORI_NOTHING_TO_CALL'; end if;
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