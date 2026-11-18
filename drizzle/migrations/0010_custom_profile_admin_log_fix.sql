-- admin_log_event 는 (action text, metadata jsonb) 시그니처만 존재한다.
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

  PERFORM public.admin_log_event('custom_profile_disable',
    jsonb_build_object('targetType', 'custom_profile', 'targetId', _user_id, 'reason', btrim(_reason)));
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

  PERFORM public.admin_log_event('custom_profile_expiry',
    jsonb_build_object('targetType', 'custom_profile', 'targetId', _user_id, 'expiresAt', _expires_at));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_disable_custom_profile(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_disable_custom_profile(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_custom_profile_expiry(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_custom_profile_expiry(uuid, timestamptz) TO authenticated, service_role;