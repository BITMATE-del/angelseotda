-- 활성 커스텀 프로필 이미지 여부 판정 (스토리지 정책에서 custom_profiles RLS 를 우회하기 위한 전용 헬퍼)
CREATE OR REPLACE FUNCTION public.is_active_custom_profile_path(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.custom_profiles cp
    WHERE cp.image_path = _path
      AND cp.active
      AND cp.status = 'ACTIVE'
      AND cp.expires_at > now()
  )
$$;
REVOKE ALL ON FUNCTION public.is_active_custom_profile_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_custom_profile_path(text) TO authenticated;

DROP POLICY IF EXISTS custom_profiles_read_own_or_active ON storage.objects;
CREATE POLICY custom_profiles_read_own_or_active
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'custom-profiles'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_admin(auth.uid())
    OR public.is_active_custom_profile_path(name)
  )
);