-- custom-profiles 버킷 접근 정책
-- 읽기: 로그인 회원 전체 (게임 참가자 HUD 표시용, signed URL)
-- 쓰기/수정/삭제: 본인 폴더({user_id}/...)만, 관리자는 삭제 가능

DROP POLICY IF EXISTS "custom_profiles_read_authenticated" ON storage.objects;
CREATE POLICY "custom_profiles_read_authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'custom-profiles');

DROP POLICY IF EXISTS "custom_profiles_insert_own" ON storage.objects;
CREATE POLICY "custom_profiles_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'custom-profiles'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "custom_profiles_update_own" ON storage.objects;
CREATE POLICY "custom_profiles_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'custom-profiles'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'custom-profiles'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "custom_profiles_delete_own_or_admin" ON storage.objects;
CREATE POLICY "custom_profiles_delete_own_or_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'custom-profiles'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );