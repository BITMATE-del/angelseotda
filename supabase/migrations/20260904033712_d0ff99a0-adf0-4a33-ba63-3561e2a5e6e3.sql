CREATE OR REPLACE FUNCTION public.gusa_best_other_score(_scores jsonb, _codes jsonb, _self text DEFAULT NULL)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(max(COALESCE((_scores->>t.k)::int, 0)), 0)
    FROM jsonb_each_text(_codes) t(k,v)
   WHERE t.v NOT IN ('gusa','gusa_meongteong')
     AND (_self IS NULL OR t.k <> _self);
$$;

CREATE OR REPLACE FUNCTION public.gusa_rematch_required(_scores jsonb, _codes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(bool_or(
    CASE
      WHEN t.v = 'gusa_meongteong' THEN public.gusa_best_other_score(_scores,_codes) <= 909
      WHEN t.v = 'gusa'            THEN public.gusa_best_other_score(_scores,_codes) <= 806
      ELSE false
    END), false)
  FROM jsonb_each_text(_codes) t(k,v);
$$;

CREATE OR REPLACE FUNCTION public.apply_contextual_rules(_scores jsonb, _codes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _eff jsonb := '{}'::jsonb; _u text; _code text; _raw int; _e int; _other int;
BEGIN
  FOR _u, _code IN SELECT k, v FROM jsonb_each_text(_codes) t(k,v) LOOP
    _raw := COALESCE((_scores->>_u)::int, 0);
    _e := _raw * 10;
    IF _code = 'amhaeng' THEN
      IF EXISTS (SELECT 1 FROM jsonb_each_text(_codes) t(k,v)
                  WHERE t.k <> _u AND t.v IN ('kwang18','kwang13'))
      THEN _e := 9955; ELSE _e := 1010; END IF;
    ELSIF _code = 'ttaengjabi' THEN
      IF EXISTS (SELECT 1 FROM jsonb_each_text(_codes) t(k,v)
                  WHERE t.k <> _u AND t.v ~ '^ttaeng[1-9]$')
      THEN _e := 9095; ELSE _e := 1000; END IF;
    ELSIF _code IN ('gusa','gusa_meongteong') THEN
      _other := public.gusa_best_other_score(_scores, _codes, _u);
      IF (_code = 'gusa' AND _other > 806) OR (_code = 'gusa_meongteong' AND _other > 909) THEN
        _e := 1030;
      END IF;
    END IF;
    _eff := jsonb_set(_eff, ARRAY[_u], to_jsonb(_e));
  END LOOP;
  RETURN _eff;
END; $function$;

DO $do$
DECLARE
  _src text;
  _old text := $old$  SELECT bool_or(v = 'gusa_meongteong'
                 OR (v = 'gusa' AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(_codes) t2(k2,v2)
                                                 WHERE t2.v2 = 'kwang38')))
    INTO _gusa FROM jsonb_each_text(_codes) t(k,v);
  _gusa := COALESCE(_gusa,false) AND _alive > 1;$old$;
  _new text := $new$  _gusa := public.gusa_rematch_required(_scores, _codes) AND _alive > 1;$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='settle_round_without_phase_guard';
  IF position(_old in _src) = 0 THEN
    RAISE EXCEPTION 'gusa block not found';
  END IF;
  EXECUTE replace(_src, _old, _new);
END $do$;

CREATE OR REPLACE FUNCTION public.enforce_room_balance_eligibility(_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _min bigint;
  _room public.game_rooms;
  _removed jsonb := '[]'::jsonb;
  _r record;
  _reason text;
  _left int;
  _new_host uuid;
BEGIN
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;
  IF _room.id IS NULL THEN
    RETURN jsonb_build_object('minPoints', NULL, 'removed', _removed, 'skipped', 'NO_ROOM');
  END IF;
  _min := GREATEST(COALESCE(_room.min_points, 0), 0);

  IF EXISTS (SELECT 1 FROM public.game_rounds
              WHERE room_id = _room_id AND status <> 'finished') THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'ROUND_ACTIVE');
  END IF;

  IF EXISTS (SELECT 1 FROM public.game_rounds
              WHERE room_id = _room_id
                AND (settled = false OR settlement_status NOT IN ('SETTLED','REMATCH'))) THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'SETTLEMENT_PENDING');
  END IF;

  IF COALESCE(_room.rematch_pending, false) THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed, 'skipped', 'REMATCH_PENDING');
  END IF;

  UPDATE public.game_room_players p
     SET is_ready = false, ready_at = NULL
   WHERE p.room_id = _room_id
     AND p.is_spectator = false
     AND EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.id = p.user_id
                    AND (pr.game_points <= 0 OR pr.game_points < _min));

  FOR _r IN
    SELECT p.user_id, p.seat, pr.game_points, pr.nickname
      FROM public.game_room_players p
      JOIN public.profiles pr ON pr.id = p.user_id
     WHERE p.room_id = _room_id
       AND p.is_spectator = false
       AND (pr.game_points <= 0 OR pr.game_points < _min)
     ORDER BY p.seat
  LOOP
    _reason := CASE WHEN COALESCE(_r.game_points,0) <= 0
                    THEN 'ZERO_BALANCE' ELSE 'BELOW_ROOM_MINIMUM' END;
    DELETE FROM public.game_room_players
     WHERE room_id = _room_id AND user_id = _r.user_id;

    _removed := _removed || jsonb_build_object(
      'userId', _r.user_id, 'points', _r.game_points,
      'nickname', _r.nickname, 'reason', _reason);

    INSERT INTO public.chat_messages (room_id, user_id, message, kind)
    VALUES (_room_id, NULL,
      COALESCE(_r.nickname, '플레이어') || '님이 잔액 부족으로 퇴장했습니다.', 'system');

    BEGIN
      PERFORM public.log_room_event(
        _room_id, 'AUTO_ROOM_KICK', _r.user_id, NULL, _r.seat, NULL, NULL, NULL,
        jsonb_build_object('balance', _r.game_points, 'nickname', _r.nickname,
                           'roomNumber', _room.room_number),
        jsonb_build_object('minimumRequired', _min, 'reason', _reason),
        NULL, 'OK', _reason);
    EXCEPTION WHEN others THEN NULL;
    END;
  END LOOP;

  IF jsonb_array_length(_removed) = 0 THEN
    RETURN jsonb_build_object('minPoints', _min, 'removed', _removed);
  END IF;

  SELECT count(*) INTO _left FROM public.game_room_players
   WHERE room_id = _room_id AND is_spectator = false;
  UPDATE public.game_rooms SET current_players = _left WHERE id = _room_id;

  IF COALESCE(_room.rematch_pending, false) THEN
    IF (SELECT count(*) FROM public.game_room_players p
         WHERE p.room_id = _room_id AND p.is_spectator = false
           AND p.user_id = ANY(_room.rematch_users)) < 2 THEN
      UPDATE public.game_rooms
         SET rematch_pending = false, rematch_users = '{}', carry_caps = '{}'::jsonb
       WHERE id = _room_id;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.game_room_players
                  WHERE room_id = _room_id AND user_id = _room.host_id AND is_spectator = false) THEN
    SELECT user_id INTO _new_host FROM public.game_room_players
     WHERE room_id = _room_id AND is_spectator = false ORDER BY seat LIMIT 1;
    IF _new_host IS NOT NULL THEN
      UPDATE public.game_rooms SET host_id = _new_host WHERE id = _room_id;
    END IF;
  END IF;

  PERFORM public.close_or_hold_room(_room_id);
  PERFORM public.cleanup_empty_rooms();

  RETURN jsonb_build_object('minPoints', _min, 'removed', _removed);
END; $function$;