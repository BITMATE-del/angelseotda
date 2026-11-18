-- ALL-IN 베팅 lifecycle 보완:
-- 상대가 모두 올인/다이여서 아무도 판돈을 따라올 수 없을 때
-- 혼자 판돈을 올리는 행동(삥·따당·쿼터·하프·올인)을 서버에서 차단하고 버튼도 제공하지 않는다.
-- 콜/체크/다이는 그대로 허용하고, 콜 금액을 채울 수 없는 경우의 부분 올인만 예외로 둔다.
-- POT / side pot / settlement / RLS / schema 는 변경하지 않는다 (기존 함수 본문에 guard만 삽입).
DO $mig$
DECLARE
  _def text; _new text; _anchor text; _guard text;
BEGIN
  ---------------------------------------------------------------- place_bet_action
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='place_bet_action';
  _anchor := '  SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;' || chr(10);
  IF position(_anchor in _def) = 0 THEN RAISE EXCEPTION 'anchor missing: place_bet_action'; END IF;
  _guard := _anchor || chr(10) ||
    '  -- 상대가 모두 올인/다이면 혼자 판돈을 올리는 행동은 허용하지 않는다 (의미 없는 self-bet 방지)' || chr(10) ||
    '  IF _action_type IN (''ping'',''ttadang'',''half'',''quarter'',''all_in'')' || chr(10) ||
    '     AND NOT EXISTS (SELECT 1 FROM public.game_round_players o' || chr(10) ||
    '                      WHERE o.round_id=_round_id AND o.user_id<>_uid' || chr(10) ||
    '                        AND o.folded=false AND o.is_all_in=false) THEN' || chr(10) ||
    '    IF NOT (_action_type=''all_in'' AND _owed > 0 AND COALESCE(_bal,0) <= _owed) THEN' || chr(10) ||
    '      RAISE EXCEPTION ''상대가 모두 올인이라 판돈을 더 올릴 수 없습니다.'';' || chr(10) ||
    '    END IF;' || chr(10) ||
    '  END IF;' || chr(10);
  _new := replace(_def, _anchor, _guard);
  EXECUTE _new;

  ---------------------------------------------------------------- get_round_state (버튼 목록)
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_round_state';
  _anchor := '      CONTINUE WHEN _a=''all_in''  AND (_cnt < 2 OR COALESCE(_bal,0) <= 0);' || chr(10);
  IF position(_anchor in _def) = 0 THEN RAISE EXCEPTION 'anchor missing: get_round_state'; END IF;
  _guard := _anchor ||
    '      CONTINUE WHEN _a IN (''ping'',''ttadang'',''half'',''quarter'') AND NOT EXISTS (SELECT 1 FROM public.game_round_players o WHERE o.round_id=_round_id AND o.user_id<>_uid AND o.folded=false AND o.is_all_in=false);' || chr(10) ||
    '      CONTINUE WHEN _a=''all_in'' AND NOT EXISTS (SELECT 1 FROM public.game_round_players o WHERE o.round_id=_round_id AND o.user_id<>_uid AND o.folded=false AND o.is_all_in=false) AND NOT (_owed > 0 AND COALESCE(_bal,0) <= _owed);' || chr(10);
  _new := replace(_def, _anchor, _guard);
  EXECUTE _new;

  ---------------------------------------------------------------- dori_place_bet
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='dori_place_bet';
  _anchor := '  _call := greatest(0, _r.current_bet - _me.round_bet);' || chr(10);
  IF position(_anchor in _def) = 0 THEN RAISE EXCEPTION 'anchor missing: dori_place_bet'; END IF;
  _guard := _anchor || chr(10) ||
    '  if _act in (''ping'',''ttadang'',''quarter'',''half'',''all_in'')' || chr(10) ||
    '     and not exists (select 1 from public.dori_round_players o' || chr(10) ||
    '                      where o.round_id=_r.id and o.user_id<>_uid' || chr(10) ||
    '                        and o.folded=false and o.is_all_in=false) then' || chr(10) ||
    '    if not (_act = ''all_in'' and _call > 0 and coalesce(_pts,0) <= _call) then' || chr(10) ||
    '      raise exception ''상대가 모두 올인이라 판돈을 더 올릴 수 없습니다.'';' || chr(10) ||
    '    end if;' || chr(10) ||
    '  end if;' || chr(10);
  _new := replace(_def, _anchor, _guard);
  EXECUTE _new;

  ---------------------------------------------------------------- dori_action_options (버튼 목록)
  SELECT pg_get_functiondef(p.oid) INTO _def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='dori_action_options';
  _anchor := '    _out := _out || jsonb_build_object(' || chr(10);
  IF position(_anchor in _def) = 0 THEN RAISE EXCEPTION 'anchor missing: dori_action_options'; END IF;
  _guard :=
    '    if _ok and _a in (''ping'',''ttadang'',''quarter'',''half'') and not exists (select 1 from public.dori_round_players o where o.round_id=_r.id and o.user_id<>_uid and o.folded=false and o.is_all_in=false) then' || chr(10) ||
    '      _ok := false; _why := ''상대가 모두 올인이라 판돈을 더 올릴 수 없습니다.'';' || chr(10) ||
    '    end if;' || chr(10) ||
    '    if _ok and _a = ''all_in'' and not exists (select 1 from public.dori_round_players o where o.round_id=_r.id and o.user_id<>_uid and o.folded=false and o.is_all_in=false) and not (_call > 0 and coalesce(_pts,0) <= _call) then' || chr(10) ||
    '      _ok := false; _why := ''상대가 모두 올인이라 판돈을 더 올릴 수 없습니다.'';' || chr(10) ||
    '    end if;' || chr(10) || _anchor;
  _new := replace(_def, _anchor, _guard);
  EXECUTE _new;
END $mig$;