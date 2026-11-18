-- 1) profiles: 타회원 금융/운영 필드 직접 조회 차단 (본인/관리자는 my_profile·admin RPC로 조회)
REVOKE SELECT (game_points, locked_points, total_charge_amount, total_charge_count,
               referred_by_affiliate_id, is_test_user, suspended_until, chat_banned_until)
  ON public.profiles FROM authenticated;

-- 2) 주간 통계: 본인 또는 관리자만
REVOKE ALL ON public.weekly_deposit_stats FROM anon;
REVOKE ALL ON public.weekly_profit_stats FROM anon;
REVOKE ALL ON public.weekly_gwang_stats FROM anon;

DROP POLICY IF EXISTS "입금 스냅샷 조회" ON public.weekly_deposit_stats;
DROP POLICY IF EXISTS "수익 스냅샷 조회" ON public.weekly_profit_stats;
DROP POLICY IF EXISTS "광땡 스냅샷 조회" ON public.weekly_gwang_stats;

CREATE POLICY "입금 스냅샷 본인/관리자 조회" ON public.weekly_deposit_stats
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "수익 스냅샷 본인/관리자 조회" ON public.weekly_profit_stats
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "광땡 스냅샷 본인/관리자 조회" ON public.weekly_gwang_stats
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- 3) 금융 원본: 비로그인 권한 회수
REVOKE ALL ON public.ranking_rewards FROM anon;
REVOKE ALL ON public.point_transactions FROM anon;
REVOKE ALL ON public.season_rankings FROM anon;
DROP POLICY IF EXISTS "season_rankings_read" ON public.season_rankings;
CREATE POLICY "season_rankings_read" ON public.season_rankings
  FOR SELECT TO authenticated USING (true);

-- 4) 게임방 참가자 보유금 스냅샷: 클라이언트 조회 불가 + 비로그인 차단
REVOKE ALL ON public.game_room_players FROM anon;
REVOKE SELECT (entry_balance_snapshot) ON public.game_room_players FROM authenticated;
DROP POLICY IF EXISTS "room_players_read" ON public.game_room_players;
CREATE POLICY "room_players_read" ON public.game_room_players
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.dori_room_players FROM anon;
REVOKE SELECT (entry_balance_snapshot) ON public.dori_room_players FROM authenticated;
REVOKE ALL ON public.dori_rounds FROM anon;
REVOKE ALL ON public.dori_cards FROM anon;
REVOKE ALL ON public.dori_round_players FROM anon;
REVOKE ALL ON public.dori_room_secrets FROM anon, authenticated;

-- 5) 게임방 비밀번호 해시: 컬럼 단위 조회 제외
REVOKE SELECT ON public.game_rooms FROM anon, authenticated;
GRANT SELECT (id, title, game_mode, host_id, max_players, current_players, min_points,
              base_bet, friends_only, spectator_enabled, status, created_at, room_type,
              channel_no, visibility, room_code, is_test_room, room_number, carry_pot,
              current_round_id, rematch_pending, rematch_users, carry_caps, closed_at,
              deleted_at, close_reason, ready_required)
  ON public.game_rooms TO anon, authenticated;