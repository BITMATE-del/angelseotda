-- ========== 1. 방 제목 서버 검증 ==========
CREATE OR REPLACE FUNCTION public.angel_sanitize_room_title()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE _t text;
BEGIN
  _t := COALESCE(NEW.title, '');
  -- 제어문자 제거
  _t := regexp_replace(_t, '[\x00-\x1F\x7F]', '', 'g');
  -- HTML/script 위험 문자 제거
  _t := regexp_replace(_t, '[<>&"''`\\]', '', 'g');
  -- 연속 공백 축약 + trim
  _t := btrim(regexp_replace(_t, '\s+', ' ', 'g'));
  IF char_length(_t) > 20 THEN
    _t := substr(_t, 1, 20);
  END IF;
  IF _t = '' THEN
    _t := CASE WHEN NEW.game_mode = 'sutda3' THEN '일반방 3장 테이블' ELSE '일반방 2장 테이블' END;
  END IF;
  NEW.title := _t;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_angel_sanitize_room_title ON public.game_rooms;
CREATE TRIGGER trg_angel_sanitize_room_title
BEFORE INSERT OR UPDATE OF title ON public.game_rooms
FOR EACH ROW EXECUTE FUNCTION public.angel_sanitize_room_title();

-- ========== 2. 커스텀 칭호 테이블 ==========
CREATE TABLE IF NOT EXISTS public.custom_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id uuid,
  title_text text NOT NULL,
  normalized_title text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  equipped boolean NOT NULL DEFAULT false,
  price bigint NOT NULL DEFAULT 25000,
  request_id uuid,
  disabled_reason text,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.custom_titles TO authenticated;
GRANT ALL ON public.custom_titles TO service_role;
ALTER TABLE public.custom_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_titles_select_own" ON public.custom_titles;
CREATE POLICY "custom_titles_select_own" ON public.custom_titles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_titles_active_name_uidx
  ON public.custom_titles (normalized_title) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS custom_titles_request_uidx
  ON public.custom_titles (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS custom_titles_user_idx ON public.custom_titles (user_id);

DROP TRIGGER IF EXISTS trg_custom_titles_updated_at ON public.custom_titles;
CREATE TRIGGER trg_custom_titles_updated_at
BEFORE UPDATE ON public.custom_titles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== 3. 기본 금칙어 / 예약어 설정 ==========
INSERT INTO public.app_settings (key, value)
VALUES ('custom_title_banned_words', '["관리자","운영자","운영진","운영팀","고객센터","엔젤운영","gm","admin","administrator","superadmin","super admin","system","시스템","공식","섯다운영","씨발","시발","병신","지랄","좆","보지","자지","섹스","sex","fuck","shit","bitch","니미","엠창","한국인혐오","토토","카지노","베팅사이트","불법","환전문의","텔레그램문의"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('custom_title_reserved_words', '["엔젤섯다","angel","angelsutda","마스터","챌린저","challenger","diamond","gold","silver","bronze","unranked"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ========== 4. 정규화 / 검증 ==========
CREATE OR REPLACE FUNCTION public.normalize_custom_title(_t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(regexp_replace(regexp_replace(COALESCE(_t,''), '[\x00-\x1F\x7F]', '', 'g'), '\s+', '', 'g')))
$$;

CREATE OR REPLACE FUNCTION public.expire_custom_titles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  UPDATE public.custom_titles
     SET status = 'EXPIRED', equipped = false
   WHERE status = 'ACTIVE' AND expires_at <= now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.validate_custom_title(_title text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean text;
  _norm text;
  _w text;
BEGIN
  _clean := btrim(regexp_replace(COALESCE(_title,''), '[\x00-\x1F\x7F]', '', 'g'));
  IF _clean = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EMPTY', 'message', '칭호명을 입력해 주세요.');
  END IF;
  IF char_length(_clean) > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TOO_LONG', 'message', '칭호명은 1~6글자만 가능합니다.');
  END IF;
  IF _clean !~ '^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CHAR', 'message', '한글/영문/숫자만 사용할 수 있습니다.');
  END IF;

  _norm := public.normalize_custom_title(_clean);

  -- 금칙어
  FOR _w IN SELECT lower(btrim(x)) FROM jsonb_array_elements_text(
      COALESCE((SELECT value FROM public.app_settings WHERE key='custom_title_banned_words'), '[]'::jsonb)) AS t(x)
  LOOP
    IF _w <> '' AND position(replace(_w,' ','') in _norm) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'BANNED', 'message', '사용할 수 없는 단어가 포함되어 있습니다.');
    END IF;
  END LOOP;

  -- 예약어 (시스템/브랜드)
  FOR _w IN SELECT lower(btrim(x)) FROM jsonb_array_elements_text(
      COALESCE((SELECT value FROM public.app_settings WHERE key='custom_title_reserved_words'), '[]'::jsonb)) AS t(x)
  LOOP
    IF _w <> '' AND _norm = replace(_w,' ','') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'RESERVED', 'message', '공식 명칭은 사용할 수 없습니다.');
    END IF;
  END LOOP;

  -- 공식 칭호 아이템 이름 / 계급 명칭 예약
  IF EXISTS (SELECT 1 FROM public.items
              WHERE category = 'title'
                AND public.normalize_custom_title(name) = _norm) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RESERVED', 'message', '공식 칭호와 동일한 이름은 사용할 수 없습니다.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.rank_requirements
              WHERE public.normalize_custom_title(label) = _norm) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RESERVED', 'message', '계급 명칭과 동일한 이름은 사용할 수 없습니다.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'title', _clean, 'normalized', _norm);
END $$;

CREATE OR REPLACE FUNCTION public.custom_title_available(_title text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _v jsonb; _norm text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  _v := public.validate_custom_title(_title);
  IF NOT (_v->>'ok')::boolean THEN RETURN _v; END IF;
  _norm := _v->>'normalized';
  IF EXISTS (SELECT 1 FROM public.custom_titles
              WHERE normalized_title = _norm AND status = 'ACTIVE' AND expires_at > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'message', '이미 사용 중인 칭호입니다.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'message', '사용 가능한 칭호입니다.', 'title', _v->>'title');
END $$;

-- ========== 5. 구매 ==========
CREATE OR REPLACE FUNCTION public.purchase_custom_title(_title text, _request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _v jsonb;
  _clean text;
  _norm text;
  _price bigint := 25000;
  _days int := 7;
  _balance bigint;
  _locked bigint;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_titles();

  IF _request_id IS NOT NULL THEN
    SELECT id INTO _id FROM public.custom_titles WHERE request_id = _request_id;
    IF _id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'id', _id, 'duplicateRequest', true);
    END IF;
  END IF;

  _v := public.validate_custom_title(_title);
  IF NOT (_v->>'ok')::boolean THEN
    RAISE EXCEPTION '%', _v->>'message';
  END IF;
  _clean := _v->>'title';
  _norm := _v->>'normalized';

  -- 포인트 차감 (원자적: 부족하면 차감되지 않음)
  UPDATE public.profiles
     SET game_points = game_points - _price
   WHERE id = _uid AND game_points - locked_points >= _price
   RETURNING game_points, locked_points INTO _balance, _locked;
  IF _balance IS NULL THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;

  BEGIN
    INSERT INTO public.custom_titles (user_id, title_text, normalized_title, price, request_id, expires_at)
    VALUES (_uid, _clean, _norm, _price, _request_id, now() + (_days || ' days')::interval)
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '이미 사용 중인 칭호입니다.';
  END;

  INSERT INTO public.point_transactions
    (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, memo)
  VALUES (_uid, 'item_purchase', -_price, _balance + _price, _balance, _locked, _locked,
          'custom_title', _id, '커스텀 칭호 구매: ' || _clean);

  RETURN jsonb_build_object('ok', true, 'id', _id, 'title', _clean,
    'expiresAt', (now() + (_days || ' days')::interval), 'price', _price);
END $$;

-- ========== 6. 장착 / 조회 ==========
CREATE OR REPLACE FUNCTION public.equip_custom_title(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _ok boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_titles();
  SELECT true INTO _ok FROM public.custom_titles
   WHERE id = _id AND user_id = _uid AND status = 'ACTIVE' AND expires_at > now();
  IF _ok IS NOT TRUE THEN RAISE EXCEPTION '사용할 수 없는 칭호입니다.'; END IF;

  -- 기존 칭호 아이템 장착 해제 (칭호는 1개만 장착)
  UPDATE public.user_items ui SET equipped = false, equipped_at = NULL
    FROM public.items it
   WHERE ui.item_id = it.id AND ui.user_id = _uid AND it.category = 'title' AND ui.equipped;
  UPDATE public.custom_titles SET equipped = false WHERE user_id = _uid AND equipped;
  UPDATE public.custom_titles SET equipped = true WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.my_custom_titles()
RETURNS TABLE (
  id uuid, title_text text, status text, equipped boolean, price bigint,
  purchased_at timestamptz, expires_at timestamptz, disabled_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_titles();
  RETURN QUERY
    SELECT c.id, c.title_text, c.status, c.equipped, c.price,
           c.purchased_at, c.expires_at, c.disabled_reason
      FROM public.custom_titles c
     WHERE c.user_id = auth.uid()
     ORDER BY c.purchased_at DESC;
END $$;

-- ========== 7. 장착 칭호 표시(커스텀 포함) ==========
CREATE OR REPLACE FUNCTION public.equipped_item_asset(_user_id uuid, _category text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF _category = 'title' THEN
    SELECT jsonb_build_object('name', c.title_text, 'assetUrl', NULL, 'itemId', c.id, 'custom', true)
      INTO _r
      FROM public.custom_titles c
     WHERE c.user_id = _user_id AND c.equipped = true AND c.status = 'ACTIVE' AND c.expires_at > now()
     LIMIT 1;
    IF _r IS NOT NULL THEN RETURN _r; END IF;
  END IF;

  SELECT jsonb_build_object('name', i.name, 'assetUrl', i.asset_url, 'itemId', i.id)
    INTO _r
    FROM public.user_items ui JOIN public.items i ON i.id = ui.item_id
   WHERE ui.user_id = _user_id AND ui.equipped = true AND i.category = _category
   ORDER BY ui.equipped_at DESC NULLS LAST LIMIT 1;
  RETURN _r;
END $$;

-- ========== 8. 관리자 ==========
CREATE OR REPLACE FUNCTION public.admin_list_custom_titles(_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR NOT (public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin')) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  PERFORM public.expire_custom_titles();
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'purchasedAt' DESC) FROM (
      SELECT jsonb_build_object(
        'id', c.id, 'userId', c.user_id, 'nickname', p.nickname, 'username', p.username,
        'title', c.title_text, 'status', c.status, 'equipped', c.equipped, 'price', c.price,
        'purchasedAt', c.purchased_at, 'expiresAt', c.expires_at, 'disabledReason', c.disabled_reason
      ) AS x
      FROM public.custom_titles c
      LEFT JOIN public.profiles p ON p.id = c.user_id
      WHERE _status IS NULL OR c.status = _status
      LIMIT 500
    ) s
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_disable_custom_title(_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _title text;
BEGIN
  IF _uid IS NULL OR NOT (public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin')) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF COALESCE(btrim(_reason),'') = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;

  UPDATE public.custom_titles
     SET status = 'DISABLED', equipped = false, disabled_reason = btrim(_reason)
   WHERE id = _id
   RETURNING user_id, title_text INTO _owner, _title;
  IF _owner IS NULL THEN RAISE EXCEPTION '칭호를 찾을 수 없습니다.'; END IF;

  PERFORM public.admin_log_event('custom_title_disable', 'custom_title', _id,
    jsonb_build_object('title', _title, 'userId', _owner), btrim(_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.angel_sanitize_room_title() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_custom_titles() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_custom_titles() TO service_role;
REVOKE ALL ON FUNCTION public.validate_custom_title(text) FROM anon;
REVOKE ALL ON FUNCTION public.custom_title_available(text) FROM anon;
REVOKE ALL ON FUNCTION public.purchase_custom_title(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.equip_custom_title(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.my_custom_titles() FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_custom_titles(text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_disable_custom_title(uuid, text) FROM anon;