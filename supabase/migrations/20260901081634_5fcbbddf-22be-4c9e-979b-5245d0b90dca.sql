-- 1) 권한 enum 확장
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'affiliate';

-- 2) profiles 확장
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS telegram_id text,
  ADD COLUMN IF NOT EXISTS wallet_address text,
  ADD COLUMN IF NOT EXISTS referred_by_affiliate_id uuid,
  ADD COLUMN IF NOT EXISTS signup_code_used text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON public.profiles (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS profiles_nickname_key ON public.profiles (lower(nickname));

-- 3) 총판 테이블
CREATE TABLE IF NOT EXISTS public.affiliates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  affiliate_code text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliates_code_key ON public.affiliates (upper(affiliate_code));
GRANT SELECT ON public.affiliates TO authenticated;
GRANT ALL ON public.affiliates TO service_role;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affiliates_admin_read" ON public.affiliates FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR user_id = auth.uid());
CREATE TRIGGER affiliates_updated_at BEFORE UPDATE ON public.affiliates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.affiliate_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_user_id)
);
GRANT SELECT ON public.affiliate_members TO authenticated;
GRANT ALL ON public.affiliate_members TO service_role;
ALTER TABLE public.affiliate_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affiliate_members_read" ON public.affiliate_members FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR member_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.affiliates a WHERE a.id = affiliate_id AND a.user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.affiliate_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL,
  charge_request_id uuid,
  base_amount numeric NOT NULL DEFAULT 0,
  commission_amount numeric NOT NULL DEFAULT 0,
  commission_rate numeric NOT NULL DEFAULT 0.02,
  status text NOT NULL DEFAULT 'accrued',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.affiliate_commissions TO authenticated;
GRANT ALL ON public.affiliate_commissions TO service_role;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affiliate_commissions_read" ON public.affiliate_commissions FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.affiliates a WHERE a.id = affiliate_id AND a.user_id = auth.uid())
  );

-- 4) charge_requests 수수료 컬럼
ALTER TABLE public.charge_requests
  ADD COLUMN IF NOT EXISTS credited_base_amount numeric,
  ADD COLUMN IF NOT EXISTS credited_points bigint,
  ADD COLUMN IF NOT EXISTS fee_amount numeric,
  ADD COLUMN IF NOT EXISTS affiliate_commission_amount numeric,
  ADD COLUMN IF NOT EXISTS company_fee_amount numeric,
  ADD COLUMN IF NOT EXISTS affiliate_id uuid;

-- 5) 공지 분류
ALTER TABLE public.notices ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';

-- 6) 설정값
INSERT INTO public.app_settings (key, value) VALUES
  ('charge_fee_rate', '0.07'::jsonb),
  ('affiliate_commission_rate', '0.02'::jsonb),
  ('signup_code_required', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7) 아이디 중복 확인
CREATE OR REPLACE FUNCTION public.username_available(_username text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(trim(_username)));
$$;
REVOKE ALL ON FUNCTION public.username_available(text) FROM public;
GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;

-- 8) 가입 트리거: 아이디 기반 가입 정보 저장 + 총판 연결
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  _username text := NULLIF(trim(COALESCE(_meta->>'username', '')), '');
  _code text := NULLIF(trim(COALESCE(_meta->>'signup_code', '')), '');
  _aff public.affiliates;
BEGIN
  IF _username IS NULL THEN
    _username := split_part(COALESCE(NEW.email, 'angel'), '@', 1);
  END IF;

  IF _code IS NOT NULL THEN
    SELECT * INTO _aff FROM public.affiliates
     WHERE upper(affiliate_code) = upper(_code) AND status = 'active';
  END IF;

  INSERT INTO public.profiles (id, email, username, nickname, telegram_id, wallet_address,
                               signup_code_used, referred_by_affiliate_id)
  VALUES (NEW.id, NEW.email, _username,
          COALESCE(NULLIF(trim(COALESCE(_meta->>'nickname','')), ''), _username),
          NULLIF(trim(COALESCE(_meta->>'telegram_id','')), ''),
          NULLIF(trim(COALESCE(_meta->>'wallet_address','')), ''),
          _code, _aff.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  IF _aff.id IS NOT NULL THEN
    INSERT INTO public.affiliate_members (affiliate_id, member_user_id)
    VALUES (_aff.id, NEW.id) ON CONFLICT (member_user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 9) 회원 자기수정 제한: 텔레그램/지갑/아이디/포인트 변경 금지
CREATE OR REPLACE FUNCTION public.profiles_guard_self_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin(auth.uid()) OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.username IS DISTINCT FROM OLD.username
     OR NEW.telegram_id IS DISTINCT FROM OLD.telegram_id
     OR NEW.wallet_address IS DISTINCT FROM OLD.wallet_address THEN
    RAISE EXCEPTION '아이디 · 텔레그램 아이디 · 지갑주소는 고객센터 문의로만 변경할 수 있습니다.';
  END IF;
  IF NEW.game_points IS DISTINCT FROM OLD.game_points
     OR NEW.locked_points IS DISTINCT FROM OLD.locked_points
     OR NEW.rank_points IS DISTINCT FROM OLD.rank_points
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION '해당 항목은 변경할 수 없습니다.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_guard_self_update ON public.profiles;
CREATE TRIGGER profiles_guard_self_update BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_self_update();

-- 10) 충전 승인: 7% 차감 / 2% 총판 정산 / 5% 운영 수수료
CREATE OR REPLACE FUNCTION public.admin_process_charge(_request_id uuid, _status text, _admin_note text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r charge_requests;
  _p profiles;
  _rate numeric;
  _fee_rate numeric;
  _comm_rate numeric;
  _fee numeric; _comm numeric; _company numeric; _base numeric; _points bigint;
  _aff affiliates;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('REVIEWING','APPROVED','REJECTED') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT * INTO _r FROM charge_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
  IF _r.status IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION '이미 처리된 신청입니다.'; END IF;

  IF _status = 'APPROVED' THEN
    SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
    SELECT (value#>>'{}')::numeric INTO _fee_rate FROM app_settings WHERE key = 'charge_fee_rate';
    SELECT (value#>>'{}')::numeric INTO _comm_rate FROM app_settings WHERE key = 'affiliate_commission_rate';
    _rate := COALESCE(_rate, 10); _fee_rate := COALESCE(_fee_rate, 0.07); _comm_rate := COALESCE(_comm_rate, 0.02);

    _fee := round(_r.requested_amount * _fee_rate);
    _base := _r.requested_amount - _fee;
    _points := floor(_base * _rate)::bigint;

    SELECT a.* INTO _aff FROM affiliates a
      JOIN profiles pr ON pr.referred_by_affiliate_id = a.id
     WHERE pr.id = _r.user_id AND a.status = 'active';
    _comm := CASE WHEN _aff.id IS NULL THEN 0 ELSE round(_r.requested_amount * _comm_rate) END;
    _company := _fee - _comm;

    SELECT * INTO _p FROM profiles WHERE id = _r.user_id FOR UPDATE;
    UPDATE profiles SET game_points = game_points + _points WHERE id = _r.user_id;

    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, admin_id, memo)
    VALUES (_r.user_id, 'charge_approved', _points, _p.game_points, _p.game_points + _points,
            _p.locked_points, _p.locked_points, 'charge_request', _r.id, _uid,
            format('신청 %s원 / 수수료 %s원(총판 %s원, 운영 %s원) / 실충전기준 %s원 / 지급 %sP (환산 %s)',
                   _r.requested_amount, _fee, _comm, _company, _base, _points, _rate));

    IF _aff.id IS NOT NULL AND _comm > 0 THEN
      INSERT INTO affiliate_commissions (affiliate_id, member_user_id, charge_request_id, base_amount, commission_amount, commission_rate)
      VALUES (_aff.id, _r.user_id, _r.id, _r.requested_amount, _comm, _comm_rate);
    END IF;

    UPDATE charge_requests SET
      conversion_rate = _rate, point_amount = _points, credited_points = _points,
      credited_base_amount = _base, fee_amount = _fee,
      affiliate_commission_amount = _comm, company_fee_amount = _company,
      affiliate_id = _aff.id
    WHERE id = _request_id;
  END IF;

  UPDATE charge_requests SET status = _status, admin_note = COALESCE(_admin_note, admin_note),
    processed_at = CASE WHEN _status = 'REVIEWING' THEN processed_at ELSE now() END,
    processed_by = _uid
  WHERE id = _request_id;

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'charge_' || lower(_status), 'charge_request', _request_id,
          jsonb_build_object('requested', _r.requested_amount, 'fee', _fee, 'affiliate_commission', _comm,
                             'company_fee', _company, 'base', _base, 'points', _points));
END;
$$;

-- 11) 총판 관리 RPC
CREATE OR REPLACE FUNCTION public.admin_set_affiliate(_user_id uuid, _code text DEFAULT NULL, _memo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _final text; _id uuid;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _user_id) THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  _final := upper(NULLIF(trim(COALESCE(_code,'')), ''));
  IF _final IS NULL THEN
    _final := 'AF' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));
  END IF;
  IF EXISTS (SELECT 1 FROM affiliates WHERE upper(affiliate_code) = _final AND user_id <> _user_id) THEN
    RAISE EXCEPTION '이미 사용 중인 가입코드입니다.';
  END IF;
  INSERT INTO affiliates (user_id, affiliate_code, memo) VALUES (_user_id, _final, _memo)
  ON CONFLICT (user_id) DO UPDATE SET affiliate_code = _final, status = 'active',
    memo = COALESCE(_memo, affiliates.memo)
  RETURNING id INTO _id;
  INSERT INTO user_roles (user_id, role) VALUES (_user_id, 'affiliate') ON CONFLICT DO NOTHING;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'set_affiliate', 'profile', _user_id, jsonb_build_object('code', _final, 'memo', _memo));
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_affiliate_status(_affiliate_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _before text; _user uuid;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('active','inactive','revoked') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT status, user_id INTO _before, _user FROM affiliates WHERE id = _affiliate_id;
  IF _user IS NULL THEN RAISE EXCEPTION '총판을 찾을 수 없습니다.'; END IF;
  UPDATE affiliates SET status = _status WHERE id = _affiliate_id;
  IF _status = 'revoked' THEN
    DELETE FROM user_roles WHERE user_id = _user AND role = 'affiliate';
  ELSE
    INSERT INTO user_roles (user_id, role) VALUES (_user, 'affiliate') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'set_affiliate_status', 'affiliate', _affiliate_id,
          jsonb_build_object('before', _before, 'after', _status));
END;
$$;

-- 12) 공지 관리 RPC
CREATE OR REPLACE FUNCTION public.admin_upsert_notice(
  _id uuid, _title text, _body text, _category text, _pinned boolean, _published boolean,
  _starts_at timestamptz DEFAULT NULL, _ends_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _out uuid; _before jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _category NOT IN ('general','maintenance','event','system') THEN RAISE EXCEPTION '잘못된 분류입니다.'; END IF;
  IF _id IS NULL THEN
    INSERT INTO notices (title, body, category, pinned, published, starts_at, ends_at, created_by)
    VALUES (_title, _body, _category, _pinned, _published, _starts_at, _ends_at, _uid)
    RETURNING id INTO _out;
  ELSE
    SELECT to_jsonb(n) INTO _before FROM notices n WHERE id = _id;
    UPDATE notices SET title = _title, body = _body, category = _category, pinned = _pinned,
      published = _published, starts_at = _starts_at, ends_at = _ends_at WHERE id = _id
    RETURNING id INTO _out;
    IF _out IS NULL THEN RAISE EXCEPTION '공지를 찾을 수 없습니다.'; END IF;
  END IF;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, CASE WHEN _id IS NULL THEN 'create_notice' ELSE 'update_notice' END, 'notice', _out,
          jsonb_build_object('before', _before, 'after', (SELECT to_jsonb(n) FROM notices n WHERE id = _out)));
  RETURN _out;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_notice(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT to_jsonb(n) INTO _before FROM notices n WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION '공지를 찾을 수 없습니다.'; END IF;
  DELETE FROM notices WHERE id = _id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'delete_notice', 'notice', _id, jsonb_build_object('before', _before));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_affiliate(uuid, text, text) FROM public;
REVOKE ALL ON FUNCTION public.admin_set_affiliate_status(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.admin_upsert_notice(uuid, text, text, text, boolean, boolean, timestamptz, timestamptz) FROM public;
REVOKE ALL ON FUNCTION public.admin_delete_notice(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_affiliate(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_affiliate_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_notice(uuid, text, text, text, boolean, boolean, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_notice(uuid) TO authenticated;