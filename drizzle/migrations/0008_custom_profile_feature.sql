-- ============================================================
-- CUSTOM PROFILE (커스텀 프로필) — 30,000P / 7일 기간제
-- 커스텀 칭호와 완전히 분리된 별도 테이블 / 별도 RPC.
-- 기존 profiles / user_items / custom_titles 구조는 변경하지 않는다.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.custom_profiles (
  user_id         uuid PRIMARY KEY,
  image_path      text,
  image_mime      text,
  image_bytes     integer,
  image_width     integer,
  image_height    integer,
  image_updated_at timestamptz,
  started_at      timestamptz,
  expires_at      timestamptz,
  active          boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'NONE',
  disabled_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.custom_profiles TO authenticated;
GRANT ALL ON public.custom_profiles TO service_role;
ALTER TABLE public.custom_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_profiles_select_own" ON public.custom_profiles;
CREATE POLICY "custom_profiles_select_own" ON public.custom_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.custom_profile_purchases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  price       bigint NOT NULL,
  days        integer NOT NULL,
  request_id  uuid UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.custom_profile_purchases TO authenticated;
GRANT ALL ON public.custom_profile_purchases TO service_role;
ALTER TABLE public.custom_profile_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_profile_purchases_select_own" ON public.custom_profile_purchases;
CREATE POLICY "custom_profile_purchases_select_own" ON public.custom_profile_purchases
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS custom_profile_purchases_user_idx
  ON public.custom_profile_purchases (user_id, created_at DESC);

-- ------------------------------------------------------------
-- 만료 처리 (서버 시간 기준)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_custom_profiles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.custom_profiles
     SET active = false,
         status = 'EXPIRED',
         updated_at = now()
   WHERE status <> 'DISABLED'
     AND expires_at IS NOT NULL
     AND expires_at <= now()
     AND (active = true OR status = 'ACTIVE');
END $$;

REVOKE ALL ON FUNCTION public.expire_custom_profiles() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_custom_profiles() TO service_role;

-- ------------------------------------------------------------
-- 내 커스텀 프로필 상태
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_custom_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _r public.custom_profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_profiles();

  SELECT * INTO _r FROM public.custom_profiles WHERE user_id = _uid;
  IF _r.user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'NONE', 'active', false, 'imagePath', NULL,
      'startedAt', NULL, 'expiresAt', NULL, 'disabledReason', NULL,
      'imageWidth', NULL, 'imageHeight', NULL, 'imageBytes', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'status', _r.status,
    'active', _r.active AND _r.expires_at > now(),
    'imagePath', _r.image_path,
    'startedAt', _r.started_at,
    'expiresAt', _r.expires_at,
    'disabledReason', _r.disabled_reason,
    'imageWidth', _r.image_width,
    'imageHeight', _r.image_height,
    'imageBytes', _r.image_bytes
  );
END $$;

REVOKE ALL ON FUNCTION public.my_custom_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_custom_profile() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 구매 (서버 가격 30,000P 고정 · 7일 · 재구매 시 기간 연장 · request_id 멱등)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_custom_profile(_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _price bigint := 30000;
  _days int := 7;
  _balance bigint;
  _locked bigint;
  _cur public.custom_profiles;
  _base timestamptz;
  _new_expires timestamptz;
  _purchase_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_profiles();

  IF _request_id IS NOT NULL THEN
    SELECT id, expires_at INTO _purchase_id, _new_expires
      FROM public.custom_profile_purchases WHERE request_id = _request_id;
    IF _purchase_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicateRequest', true,
        'expiresAt', _new_expires, 'price', _price);
    END IF;
  END IF;

  SELECT * INTO _cur FROM public.custom_profiles WHERE user_id = _uid FOR UPDATE;

  -- 포인트 차감 (원자적: 부족하면 차감되지 않는다)
  UPDATE public.profiles
     SET game_points = game_points - _price
   WHERE id = _uid AND game_points - locked_points >= _price
   RETURNING game_points, locked_points INTO _balance, _locked;
  IF _balance IS NULL THEN RAISE EXCEPTION '보유 포인트가 부족합니다.'; END IF;

  -- 남은 기간이 있으면 그 위에 7일 추가
  _base := CASE
    WHEN _cur.user_id IS NOT NULL AND _cur.status <> 'DISABLED'
         AND _cur.expires_at IS NOT NULL AND _cur.expires_at > now()
    THEN _cur.expires_at ELSE now() END;
  _new_expires := _base + (_days || ' days')::interval;

  INSERT INTO public.custom_profiles AS cp
    (user_id, started_at, expires_at, active, status, disabled_reason, updated_at)
  VALUES (_uid, now(), _new_expires, true, 'ACTIVE', NULL, now())
  ON CONFLICT (user_id) DO UPDATE
     SET started_at = COALESCE(
           CASE WHEN cp.expires_at IS NOT NULL AND cp.expires_at > now()
                     AND cp.status <> 'DISABLED'
                THEN cp.started_at END, now()),
         expires_at = _new_expires,
         active = true,
         status = 'ACTIVE',
         disabled_reason = NULL,
         updated_at = now();

  INSERT INTO public.custom_profile_purchases (user_id, price, days, request_id, expires_at)
  VALUES (_uid, _price, _days, _request_id, _new_expires)
  RETURNING id INTO _purchase_id;

  INSERT INTO public.point_transactions
    (user_id, type, amount, balance_before, balance_after, locked_before, locked_after,
     reference_type, reference_id, memo)
  VALUES (_uid, 'item_purchase', -_price, _balance + _price, _balance, _locked, _locked,
          'custom_profile', _purchase_id, '커스텀 프로필 구매 (7일)');

  RETURN jsonb_build_object('ok', true, 'expiresAt', _new_expires, 'price', _price, 'days', _days);
END $$;

REVOKE ALL ON FUNCTION public.purchase_custom_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_custom_profile(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 이미지 등록/변경 (이용권 기간 내 무료 · 서버에서 형식·용량·해상도 재검증)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_custom_profile_image(
  _path text, _mime text, _bytes integer, _width integer, _height integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _cur public.custom_profiles; _p text := btrim(COALESCE(_path,''));
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_profiles();

  SELECT * INTO _cur FROM public.custom_profiles WHERE user_id = _uid FOR UPDATE;
  IF _cur.user_id IS NULL OR _cur.status <> 'ACTIVE' OR _cur.expires_at IS NULL
     OR _cur.expires_at <= now() THEN
    RAISE EXCEPTION '커스텀 프로필 이용권이 필요합니다.';
  END IF;

  IF _p = '' OR _p <> _uid::text || '/' || split_part(_p, '/', 2) OR split_part(_p, '/', 2) = '' THEN
    RAISE EXCEPTION '이미지 경로가 올바르지 않습니다.';
  END IF;
  IF lower(_p) !~ '\.(jpg|jpeg|png|webp)$' THEN
    RAISE EXCEPTION 'JPG, PNG, WEBP 이미지만 사용할 수 있습니다.';
  END IF;
  IF COALESCE(_mime,'') NOT IN ('image/jpeg','image/png','image/webp') THEN
    RAISE EXCEPTION 'JPG, PNG, WEBP 이미지만 사용할 수 있습니다.';
  END IF;
  IF COALESCE(_bytes,0) <= 0 OR _bytes > 5242880 THEN
    RAISE EXCEPTION '이미지 용량은 최대 5MB까지 사용할 수 있습니다.';
  END IF;
  IF COALESCE(_width,0) < 400 OR COALESCE(_height,0) < 400 THEN
    RAISE EXCEPTION '프로필 이미지는 최소 400×400px 이상이어야 합니다.';
  END IF;
  IF _width > 2000 OR _height > 2000 THEN
    RAISE EXCEPTION '프로필 이미지는 최대 2000×2000px까지 사용할 수 있습니다.';
  END IF;

  UPDATE public.custom_profiles
     SET image_path = _p, image_mime = _mime, image_bytes = _bytes,
         image_width = _width, image_height = _height,
         image_updated_at = now(), updated_at = now()
   WHERE user_id = _uid;

  RETURN jsonb_build_object('ok', true, 'imagePath', _p);
END $$;

REVOKE ALL ON FUNCTION public.set_custom_profile_image(text, text, integer, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_custom_profile_image(text, text, integer, integer, integer)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 다른 회원의 활성 커스텀 프로필 이미지 경로 조회 (게임 HUD 표시용)
-- 이미지 경로만 노출하고 기간/금융 정보는 절대 노출하지 않는다.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_profile_images(_user_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_object_agg(cp.user_id::text, cp.image_path), '{}'::jsonb)
    FROM public.custom_profiles cp
   WHERE cp.user_id = ANY(COALESCE(_user_ids, ARRAY[]::uuid[]))
     AND cp.active = true
     AND cp.status = 'ACTIVE'
     AND cp.expires_at > now()
     AND cp.image_path IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.custom_profile_images(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.custom_profile_images(uuid[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 관리자 조회 / 강제 해제 / 만료일 수정
-- ------------------------------------------------------------
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
        'paidTotal', (SELECT COALESCE(sum(q.price),0) FROM public.custom_profile_purchases q WHERE q.user_id = cp.user_id)
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

CREATE OR REPLACE FUNCTION public.admin_disable_custom_profile(_user_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _old text;
BEGIN
  IF _uid IS NULL OR NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF COALESCE(btrim(_reason),'') = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;

  UPDATE public.custom_profiles
     SET active = false, status = 'DISABLED', image_path = NULL,
         disabled_reason = btrim(_reason), updated_at = now()
   WHERE user_id = _user_id
   RETURNING image_path INTO _old;
  IF NOT FOUND THEN RAISE EXCEPTION '커스텀 프로필 정보를 찾을 수 없습니다.'; END IF;

  PERFORM public.admin_log_event('custom_profile_disable', 'custom_profile', _user_id,
    jsonb_build_object('userId', _user_id), btrim(_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_disable_custom_profile(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_disable_custom_profile(uuid, text) TO authenticated, service_role;

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

  PERFORM public.admin_log_event('custom_profile_expiry', 'custom_profile', _user_id,
    jsonb_build_object('expiresAt', _expires_at), '커스텀 프로필 만료일 변경');
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_custom_profile_expiry(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_custom_profile_expiry(uuid, timestamptz) TO authenticated, service_role;