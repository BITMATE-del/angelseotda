-- 1) super_admin 판정
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin');
$$;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- 2) 내 역할 조회 (프론트에서 변경 불가, 서버 판정)
CREATE OR REPLACE FUNCTION public.my_admin_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.is_super_admin(auth.uid()) THEN 'super_admin'
    WHEN public.is_admin(auth.uid()) THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'affiliate') THEN 'affiliate'
    ELSE 'user' END;
$$;
REVOKE ALL ON FUNCTION public.my_admin_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_admin_role() TO authenticated;

-- 3) bootstrap 가능 여부
CREATE OR REPLACE FUNCTION public.super_admin_exists()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin');
$$;
REVOKE ALL ON FUNCTION public.super_admin_exists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_admin_exists() TO authenticated;

-- 4) 초기 super_admin bootstrap (super_admin 존재 시 영구 차단)
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE role = 'super_admin') THEN
    RAISE EXCEPTION '최고관리자가 이미 존재하여 초기 설정을 사용할 수 없습니다.';
  END IF;
  INSERT INTO user_roles (user_id, role) VALUES (_uid, 'super_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, 'BOOTSTRAP_SUPER_ADMIN', 'user_role', _uid, jsonb_build_object('role','super_admin'), '초기 최고관리자 생성');
  RETURN 'super_admin';
END; $$;
REVOKE ALL ON FUNCTION public.bootstrap_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin() TO authenticated;

-- 5) 역할 부여/회수 (super_admin 전용)
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _before text;
BEGIN
  IF NOT public.is_super_admin(_uid) THEN RAISE EXCEPTION '최고관리자 권한이 필요합니다.'; END IF;
  IF _role NOT IN ('user','affiliate','admin','super_admin') THEN RAISE EXCEPTION '허용되지 않은 역할입니다.'; END IF;
  IF coalesce(_reason,'') = '' THEN RAISE EXCEPTION '변경 사유를 입력해야 합니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _user_id) THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  IF _user_id = _uid AND _role <> 'super_admin' THEN
    RAISE EXCEPTION '본인의 최고관리자 권한은 회수할 수 없습니다.';
  END IF;

  SELECT public.my_admin_role() INTO _before;
  DELETE FROM user_roles WHERE user_id = _user_id AND role IN ('admin','super_admin');
  IF _role IN ('admin','super_admin') THEN
    INSERT INTO user_roles (user_id, role) VALUES (_user_id, _role::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSIF _role = 'affiliate' THEN
    INSERT INTO user_roles (user_id, role) VALUES (_user_id, 'affiliate')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM user_roles WHERE user_id = _user_id AND role = 'affiliate';
  END IF;

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, 'ROLE_CHANGED', 'user_role', _user_id, jsonb_build_object('to', _role), _reason);
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_role(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, text, text) TO authenticated;

-- 6) 관리자 목록 (super_admin 전용)
CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS TABLE(user_id uuid, username text, nickname text, role text, status text, last_login_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION '최고관리자 권한이 필요합니다.'; END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.nickname,
         (CASE WHEN bool_or(ur.role = 'super_admin') THEN 'super_admin' ELSE 'admin' END)::text,
         p.status,
         (SELECT max(l.created_at) FROM admin_logs l WHERE l.admin_id = p.id AND l.action = 'ADMIN_LOGIN'),
         p.created_at
  FROM user_roles ur
  JOIN profiles p ON p.id = ur.user_id
  WHERE ur.role IN ('admin','super_admin')
  GROUP BY p.id, p.username, p.nickname, p.status, p.created_at
  ORDER BY 4 DESC, p.created_at;
END; $$;
REVOKE ALL ON FUNCTION public.admin_list_admins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_admins() TO authenticated;

-- 7) 관리자 행동 로그 (관리자만)
CREATE OR REPLACE FUNCTION public.admin_log_event(_action text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _action NOT IN ('ADMIN_LOGIN','ADMIN_LOGOUT','ADMIN_VIEW') THEN
    RAISE EXCEPTION '허용되지 않은 로그 유형입니다.';
  END IF;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, _action, 'session', _uid, coalesce(_metadata, '{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.admin_log_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_log_event(text, jsonb) TO authenticated;

-- 8) 고위험 포인트 정정: 100만 초과는 super_admin 전용
CREATE OR REPLACE FUNCTION public.admin_adjust_points(_user_id uuid, _amount bigint, _memo text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _p profiles;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF abs(_amount) > 1000000 AND NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION '100만P를 초과하는 정정은 최고관리자만 가능합니다.';
  END IF;
  SELECT * INTO _p FROM profiles WHERE id = _user_id FOR UPDATE;
  IF _p.id IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  IF _p.game_points + _amount < 0 THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;
  UPDATE profiles SET game_points = game_points + _amount WHERE id = _user_id;
  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, admin_id, memo)
  VALUES (_user_id, CASE WHEN _amount >= 0 THEN 'admin_add' ELSE 'admin_remove' END, _amount,
          _p.game_points, _p.game_points + _amount, _p.locked_points, _p.locked_points, _uid, _memo);
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'POINT_ADJUSTED', 'profile', _user_id, jsonb_build_object('amount', _amount, 'memo', _memo));
END;
$$;

-- 9) 핵심 시스템 설정 변경은 super_admin 전용
CREATE OR REPLACE FUNCTION public.admin_update_setting(_key text, _value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _key IN ('operation_mode','conversion_rate','charge_fee_rate','affiliate_fee_rate','maintenance_enabled','game_locked')
     AND NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION '핵심 시스템 설정은 최고관리자만 변경할 수 있습니다.';
  END IF;
  SELECT value INTO _before FROM app_settings WHERE key = _key;
  INSERT INTO app_settings (key, value) VALUES (_key, _value)
  ON CONFLICT (key) DO UPDATE SET value = _value, updated_at = now();
  INSERT INTO admin_logs (admin_id, action, target_type, metadata)
  VALUES (_uid, 'update_setting', 'app_setting',
    jsonb_build_object('key', _key, 'before', _before, 'after', _value));
END; $$;