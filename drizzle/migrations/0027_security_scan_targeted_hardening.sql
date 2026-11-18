-- 0027 보안 스캔 개별 대응 (게임 코어 / 정산 / RPC 로직 변경 없음)

--------------------------------------------------------------------
-- 1) CRITICAL: game_rounds deck 노출
--    deck / deck_pos 컬럼 SELECT 권한은 이미 없으나(컬럼 GRANT 목록 제외),
--    행 정책이 USING(true) 였으므로 같은 방 참가자/관리자로 축소한다.
--------------------------------------------------------------------
DROP POLICY IF EXISTS "rounds readable" ON public.game_rounds;
CREATE POLICY "rounds readable by room members"
ON public.game_rounds FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.game_room_players p
    WHERE p.room_id = game_rounds.room_id AND p.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.game_round_players rp
    WHERE rp.round_id = game_rounds.id AND rp.user_id = auth.uid()
  )
);

-- deck / deck_pos 는 어떤 클라이언트 role 에도 부여하지 않는다 (재확인)
REVOKE SELECT (deck, deck_pos) ON public.game_rounds FROM authenticated, anon;

--------------------------------------------------------------------
-- 2) CRITICAL: profiles private 컬럼 노출
--    금융/연락처 컬럼은 이미 GRANT 되어 있지 않다.
--    남아 있던 로그인 아이디·상태·접속시각 등 비공개 컬럼 권한을 회수하고
--    공개 프로필(닉네임/아바타/레벨/계급/랭킹 지표)만 남긴다.
--------------------------------------------------------------------
REVOKE SELECT (username, status, created_at, last_seen_at, attendance_count, exp, current_streak)
  ON public.profiles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;

COMMENT ON POLICY "profiles_auth_read" ON public.profiles IS
  '공개 프로필 컬럼만 조회 가능 (비공개 컬럼은 컬럼 GRANT 로 차단, 본인/관리자 조회는 전용 RPC 사용)';

-- 관리자 아이디 검색 전용 (컬럼 권한 회수로 인한 관리자 기능 보존)
CREATE OR REPLACE FUNCTION public.admin_find_user_by_username(_username text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;
  SELECT id INTO _id FROM public.profiles WHERE lower(username) = lower(btrim(_username));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.admin_find_user_by_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_find_user_by_username(text) TO authenticated;

--------------------------------------------------------------------
-- 3) WARNING: custom-profiles 스토리지 전체 열람
--    본인 / 관리자 / "현재 활성 커스텀 프로필 이미지"만 읽기 허용.
--    (게임 HUD 아바타 표시는 활성 이미지만 사용하므로 그대로 동작)
--------------------------------------------------------------------
DROP POLICY IF EXISTS custom_profiles_read_authenticated ON storage.objects;
CREATE POLICY custom_profiles_read_own_or_active
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'custom-profiles'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.custom_profiles cp
      WHERE cp.image_path = storage.objects.name
        AND cp.active
        AND cp.expires_at > now()
    )
  )
);

--------------------------------------------------------------------
-- 4) WARNING: ranking_rewards 전체 지급내역 노출 → 본인 + 관리자
--------------------------------------------------------------------
DROP POLICY IF EXISTS "상금 내역 조회" ON public.ranking_rewards;
CREATE POLICY ranking_rewards_self_or_admin
ON public.ranking_rewards FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ranking_rewards FROM authenticated;

--------------------------------------------------------------------
-- 5) WARNING: Function Search Path Mutable (미설정 함수 1건)
--------------------------------------------------------------------
ALTER FUNCTION public.is_valid_tron_address(text) SET search_path = public;

--------------------------------------------------------------------
-- 6) WARNING: 비로그인(anon) 이 실행 가능한 함수 정리
--    로그인 전 필요한 함수(username_available, custom_title_available,
--    validate/normalize_custom_title, support/official 링크)만 남긴다.
--------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'actionable_betting_count','apply_contextual_rules','bet_additional_amount',
        'cancel_rare_offer','create_rare_offer','equip_custom_title','expire_rare_item_offers',
        'purchase_custom_title','my_custom_titles','my_equipped_title','my_rare_offers',
        'rare_item_owners','received_rare_offers','respond_rare_offer',
        'sutda_round_result','sutda_best_pair','sutda_is_pair',
        'gusa_best_other_score','gusa_rematch_required',
        'dori_action_options','dori_actionable_betting_count','dori_eval_pair_cards',
        'dori_my_active_room','dori_reveal_choice','dori_reveal_mode','dori_round_history',
        'dori_seat_revealed','dori_special_hand','dori_visible_cards','dori_grade_preset',
        'affiliate_commission_is_settled','affiliate_commission_is_unsettled'
      )
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;