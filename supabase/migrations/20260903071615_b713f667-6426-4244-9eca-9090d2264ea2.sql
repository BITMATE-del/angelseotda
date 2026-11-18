-- 1) game_cards: 클라이언트 직접 조회 전면 차단 (서버 함수 projection만 허용)
DROP POLICY IF EXISTS "own cards only" ON public.game_cards;
CREATE POLICY "no direct card access" ON public.game_cards FOR SELECT TO authenticated USING (false);
REVOKE ALL ON public.game_cards FROM anon, authenticated;
GRANT ALL ON public.game_cards TO service_role;

-- 2) game_rounds: deck / deck_pos 컬럼 노출 차단 (realtime payload 포함)
REVOKE ALL ON public.game_rounds FROM anon, authenticated;
GRANT SELECT (id, room_id, round_number, game_mode, status, pot, started_at, finished_at,
  settled, winner_id, settlement_status, settled_at, settlement_id, turn_deadline_at,
  phase, stage, base_bet, current_bet, current_turn_user_id, dealer_seat, carry_in,
  is_rematch, fold_win_reveal_choice, fold_win_reveal_deadline, last_activity_at, paused_reason)
  ON public.game_rounds TO authenticated;
GRANT ALL ON public.game_rounds TO service_role;

-- 3) game_round_players: 본인 행만 직접 조회
DROP POLICY IF EXISTS "round players readable" ON public.game_round_players;
CREATE POLICY "own round player only" ON public.game_round_players
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.game_round_players FROM anon, authenticated;
GRANT SELECT ON public.game_round_players TO authenticated;
GRANT ALL ON public.game_round_players TO service_role;

-- 4) game_actions: anon 권한 회수
REVOKE ALL ON public.game_actions FROM anon;
GRANT SELECT ON public.game_actions TO authenticated;
GRANT ALL ON public.game_actions TO service_role;

-- 5) QA 전용 RPC 실행 권한 회수 (함수 내부 검사는 유지)
REVOKE ALL ON FUNCTION public.test_seed_round_cards(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_set_points(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_driver_assert(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_pot_report(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_seed_round_cards(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.test_set_points(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.test_driver_assert(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.test_pot_report(text, uuid) TO service_role;

-- 6) 카드 관련 조회 함수 anon 실행 권한 회수
REVOKE ALL ON FUNCTION public.round_player_hand(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advance_round_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evaluate_sutda_hand(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sutda_card_month(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sutda_card_is_gwang(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sutda_special_cards() FROM PUBLIC, anon;

-- 7) 보안 이벤트 로그
CREATE OR REPLACE FUNCTION public.log_security_event(_code text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _code IS NULL OR _code NOT IN ('HIDDEN_CARD_ACCESS_ATTEMPT','ILLEGAL_CARD_MUTATION',
      'ILLEGAL_CARD_SEED_ATTEMPT','INVALID_FINAL_HAND','DUPLICATE_DEAL_ATTEMPT',
      'TEST_DRIVER_PRODUCTION_ATTEMPT') THEN
    RETURN;
  END IF;
  INSERT INTO public.game_error_logs(user_id, fn, error_code, error_message, metadata)
  VALUES (_uid, 'SECURITY', _code, _code, COALESCE(_detail, '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.log_security_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, jsonb) TO authenticated, service_role;