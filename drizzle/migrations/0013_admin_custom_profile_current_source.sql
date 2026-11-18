-- 관리자 목록에 "현재 적용중인 프로필" (CUSTOM / CHARACTER / DEFAULT) 표기 추가.
-- 판정 기준은 클라이언트 resolver 와 동일하다: 활성 커스텀 → 장착 캐릭터 → 기본.
CREATE OR REPLACE FUNCTION public.admin_list_custom_profiles(_status text DEFAULT NULL)
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
  PERFORM public.expire_custom_profiles();

  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'updatedAt' DESC) FROM (
      SELECT jsonb_build_object(
        'userId', cp.user_id,
        'nickname', p.nickname,
        'username', p.username,
        'status', cp.status,
        'active', cp.active AND cp.expires_at > now(),
        'imagePath', cp.image_path,
        'startedAt', cp.started_at,
        'expiresAt', cp.expires_at,
        'updatedAt', cp.updated_at,
        'disabledReason', cp.disabled_reason,
        'purchaseCount', (SELECT count(*) FROM public.custom_profile_purchases q WHERE q.user_id = cp.user_id),
        'paidTotal', (SELECT COALESCE(sum(q.price),0) FROM public.custom_profile_purchases q WHERE q.user_id = cp.user_id),
        'hasCharacter', EXISTS (
          SELECT 1 FROM public.user_items ui
            JOIN public.items it ON it.id = ui.item_id
           WHERE ui.user_id = cp.user_id
             AND ui.equipped = true
             AND (ui.expires_at IS NULL OR ui.expires_at > now())
             AND it.category = 'character'
        ),
        'currentProfile', CASE
          WHEN cp.active AND cp.status = 'ACTIVE' AND cp.expires_at > now() AND cp.image_path IS NOT NULL
            THEN 'CUSTOM'
          WHEN EXISTS (
            SELECT 1 FROM public.user_items ui
              JOIN public.items it ON it.id = ui.item_id
             WHERE ui.user_id = cp.user_id
               AND ui.equipped = true
               AND (ui.expires_at IS NULL OR ui.expires_at > now())
               AND it.category = 'character'
          ) THEN 'CHARACTER'
          ELSE 'DEFAULT'
        END
      ) AS x
      FROM public.custom_profiles cp
      LEFT JOIN public.profiles p ON p.id = cp.user_id
      WHERE _status IS NULL OR cp.status = _status
      LIMIT 500
    ) s
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.admin_list_custom_profiles(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_custom_profiles(text) TO authenticated, service_role;
