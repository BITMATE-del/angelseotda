-- 관리자 조치 감사 로그는 admin_logs 에 직접 기록한다.
-- (admin_log_event 는 세션 로그 전용 화이트리스트라 커스텀 프로필 조치를 받지 못한다)
CREATE OR REPLACE FUNCTION public.admin_disable_custom_profile(_user_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF COALESCE(btrim(_reason),'') = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;

  UPDATE public.custom_profiles
     SET active = false, status = 'DISABLED', image_path = NULL,
         disabled_reason = btrim(_reason), updated_at = now()
   WHERE user_id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '커스텀 프로필 정보를 찾을 수 없습니다.'; END IF;

  INSERT INTO public.admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, 'custom_profile_disable', 'custom_profile', _user_id,
          jsonb_build_object('userId', _user_id), btrim(_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_custom_profile_expiry(_user_id uuid, _expires_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF _expires_at IS NULL THEN RAISE EXCEPTION '만료일을 입력해 주세요.'; END IF;

  UPDATE public.custom_profiles
     SET expires_at = _expires_at,
         active = (_expires_at > now() AND status <> 'DISABLED'),
         status = CASE WHEN status = 'DISABLED' THEN 'DISABLED'
                       WHEN _expires_at > now() THEN 'ACTIVE' ELSE 'EXPIRED' END,
         started_at = COALESCE(started_at, now()),
         updated_at = now()
   WHERE user_id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION '커스텀 프로필 정보를 찾을 수 없습니다.'; END IF;

  INSERT INTO public.admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, 'custom_profile_expiry', 'custom_profile', _user_id,
          jsonb_build_object('expiresAt', _expires_at), '커스텀 프로필 만료일 변경');
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_disable_custom_profile(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_disable_custom_profile(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_custom_profile_expiry(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_custom_profile_expiry(uuid, timestamptz) TO authenticated, service_role;