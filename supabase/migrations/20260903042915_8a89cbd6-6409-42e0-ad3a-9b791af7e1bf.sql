-- TEST-ONLY E2E DRIVER
INSERT INTO public.app_settings(key, value)
VALUES ('test_driver_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.test_sound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid,
  game_action_id uuid,
  result_event_id text,
  sound_type text NOT NULL,
  sound_key text NOT NULL,
  client_session text NOT NULL,
  user_id uuid,
  played_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.test_sound_events TO authenticated;
GRANT ALL ON public.test_sound_events TO service_role;
ALTER TABLE public.test_sound_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "test sound events own insert" ON public.test_sound_events;
CREATE POLICY "test sound events own insert" ON public.test_sound_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_test_user = true)
  );
DROP POLICY IF EXISTS "test sound events admin read" ON public.test_sound_events;
CREATE POLICY "test sound events admin read" ON public.test_sound_events
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.test_pot_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_key text NOT NULL,
  round_id uuid NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.test_pot_reports TO authenticated;
GRANT ALL ON public.test_pot_reports TO service_role;
ALTER TABLE public.test_pot_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "test pot reports admin read" ON public.test_pot_reports;
CREATE POLICY "test pot reports admin read" ON public.test_pot_reports
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.test_driver_assert(_room_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _enabled boolean; _room public.game_rooms; _bad int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN: 로그인이 필요합니다.'; END IF;
  SELECT COALESCE((value)::text = 'true', false) INTO _enabled
    FROM public.app_settings WHERE key = 'test_driver_enabled';
  IF NOT COALESCE(_enabled, false) THEN
    RAISE EXCEPTION 'TEST_DRIVER_DISABLED: 테스트 드라이버가 비활성 상태입니다.';
  END IF;
  IF NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN: 최고관리자만 사용할 수 있습니다.';
  END IF;
  IF _room_id IS NOT NULL THEN
    SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;
    IF _room.id IS NULL THEN RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN: 방이 없습니다.'; END IF;
    IF NOT COALESCE(_room.is_test_room, false) THEN
      RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN: 테스트 방에서만 사용할 수 있습니다.';
    END IF;
    SELECT count(*) INTO _bad FROM public.game_room_players rp
      JOIN public.profiles pr ON pr.id = rp.user_id
     WHERE rp.room_id = _room_id AND COALESCE(pr.is_test_user, false) = false;
    IF _bad > 0 THEN
      RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN: 실회원이 포함된 방입니다.';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.test_driver_assert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_driver_assert(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.test_set_points(_user_id uuid, _points bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _before bigint;
BEGIN
  PERFORM public.test_driver_assert(NULL);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND is_test_user = true) THEN
    RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN: 테스트 회원이 아닙니다.';
  END IF;
  SELECT game_points INTO _before FROM public.profiles WHERE id = _user_id FOR UPDATE;
  UPDATE public.profiles SET game_points = _points, locked_points = 0 WHERE id = _user_id;
  INSERT INTO public.point_transactions(user_id, type, amount, balance_before, balance_after,
    locked_before, locked_after, admin_id, memo)
  VALUES (_user_id, 'admin_adjust', _points - _before, _before, _points, 0, 0, auth.uid(), 'TEST_DRIVER_SET_POINTS');
  RETURN jsonb_build_object('ok', true, 'before', _before, 'after', _points);
END $$;
REVOKE ALL ON FUNCTION public.test_set_points(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_set_points(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.test_seed_round_cards(_round_id uuid, _map jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _r public.game_rounds; _n int; _i int := 0; _p record; _need int; _have int;
  _deck text[]; _cards text[]; _all text[] := '{}'; _k int; _pos int;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  PERFORM public.test_driver_assert(_r.room_id);
  IF _r.settled THEN RAISE EXCEPTION 'ROUND_ALREADY_SETTLED'; END IF;

  _need := CASE WHEN _r.game_mode = 'sutda3' THEN 3 ELSE 2 END;
  SELECT count(*) INTO _n FROM public.game_round_players WHERE round_id = _round_id;
  _deck := _r.deck;

  FOR _p IN SELECT * FROM public.game_round_players WHERE round_id = _round_id ORDER BY seat LOOP
    _i := _i + 1;
    SELECT array_agg(t ORDER BY ord) INTO _cards
      FROM jsonb_array_elements_text(_map -> _p.user_id::text) WITH ORDINALITY x(t, ord);
    IF _cards IS NULL OR array_length(_cards, 1) <> _need THEN
      RAISE EXCEPTION 'TEST_DRIVER_BAD_SEED: user % 카드 %장 필요', _p.user_id, _need;
    END IF;
    _all := _all || _cards;

    SELECT count(*) INTO _have FROM public.game_cards WHERE round_id = _round_id AND user_id = _p.user_id;
    DELETE FROM public.game_cards WHERE round_id = _round_id AND user_id = _p.user_id;
    FOR _k IN 1.._have LOOP
      INSERT INTO public.game_cards(round_id, user_id, card_code, card_order)
      VALUES (_round_id, _p.user_id, _cards[_k], _k);
    END LOOP;
    FOR _k IN (_have + 1).._need LOOP
      _pos := (_k - 1) * _n + _i;
      IF _pos > array_length(_deck, 1) THEN RAISE EXCEPTION 'TEST_DRIVER_BAD_SEED: deck overflow'; END IF;
      _deck[_pos] := _cards[_k];
    END LOOP;
  END LOOP;

  IF (SELECT count(DISTINCT c) FROM unnest(_all) c) <> array_length(_all, 1) THEN
    RAISE EXCEPTION 'TEST_DRIVER_BAD_SEED: 중복 카드';
  END IF;

  UPDATE public.game_rounds SET deck = _deck WHERE id = _round_id;
  PERFORM public.log_room_event(_r.room_id, 'TEST_SEED_CARDS', NULL, _round_id, NULL, NULL,
    _r.pot, _r.pot, '{}'::jsonb, jsonb_build_object('players', _n, 'mode', _r.game_mode),
    NULL, 'OK', NULL);
  RETURN jsonb_build_object('ok', true, 'players', _n, 'mode', _r.game_mode);
END $$;
REVOKE ALL ON FUNCTION public.test_seed_round_cards(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_seed_round_cards(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.test_pot_report(_case_key text, _round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _r public.game_rounds; _rep jsonb; _contrib bigint; _pots jsonb; _potsum bigint;
BEGIN
  SELECT * INTO _r FROM public.game_rounds WHERE id = _round_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'ROUND_NOT_FOUND'; END IF;
  PERFORM public.test_driver_assert(_r.room_id);

  _pots := public.build_side_pots(_round_id);
  SELECT COALESCE(sum((v->>'amount')::bigint),0) INTO _potsum FROM jsonb_array_elements(_pots) v;
  SELECT COALESCE(sum(amount),0) + COALESCE(_r.carry_in,0) INTO _contrib
    FROM public.game_actions WHERE round_id = _round_id;

  _rep := jsonb_build_object(
    'caseKey', _case_key,
    'roundId', _round_id,
    'mode', _r.game_mode,
    'settlementStatus', _r.settlement_status,
    'roundPot', _r.pot,
    'carryIn', _r.carry_in,
    'contributionSum', _contrib,
    'potLayerSum', _potsum,
    'pots', _pots,
    'players', (SELECT jsonb_agg(jsonb_build_object(
        'seat', p.seat, 'nickname', pr.nickname, 'userId', p.user_id,
        'totalBet', p.total_bet, 'folded', p.folded, 'allIn', p.is_all_in,
        'handCode', p.hand_code, 'resultType', p.result_type,
        'payout', COALESCE((SELECT sum(t.amount) FROM public.point_transactions t
                            WHERE t.reference_id = _round_id AND t.user_id = p.user_id
                              AND t.type = 'game_win'), 0)
      ) ORDER BY p.seat)
      FROM public.game_round_players p JOIN public.profiles pr ON pr.id = p.user_id
      WHERE p.round_id = _round_id),
    'payoutSum', COALESCE((SELECT sum(amount) FROM public.point_transactions
                           WHERE reference_id = _round_id AND type = 'game_win'), 0)
  );
  INSERT INTO public.test_pot_reports(case_key, round_id, report) VALUES (_case_key, _round_id, _rep);
  RETURN _rep;
END $$;
REVOKE ALL ON FUNCTION public.test_pot_report(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_pot_report(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.test_log_sound_event(
  _sound_key text, _sound_type text, _client_session text,
  _round_id uuid DEFAULT NULL, _game_action_id uuid DEFAULT NULL, _result_event_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND is_test_user = true) THEN
    RAISE EXCEPTION 'TEST_DRIVER_FORBIDDEN: 테스트 회원 전용';
  END IF;
  INSERT INTO public.test_sound_events(round_id, game_action_id, result_event_id, sound_type,
    sound_key, client_session, user_id)
  VALUES (_round_id, _game_action_id, _result_event_id, _sound_type, _sound_key, _client_session, _uid);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.test_log_sound_event(text, text, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_log_sound_event(text, text, text, uuid, uuid, text) TO authenticated;