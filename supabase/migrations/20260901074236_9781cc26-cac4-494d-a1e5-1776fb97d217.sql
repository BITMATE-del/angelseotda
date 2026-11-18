CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

-- 1) ROOM TYPES ---------------------------------------------------------------
CREATE TABLE public.room_types (
  id text PRIMARY KEY,
  name text NOT NULL,
  min_points bigint NOT NULL,
  base_bet bigint NOT NULL,
  max_players integer NOT NULL DEFAULT 5,
  active boolean NOT NULL DEFAULT true,
  allow_sutda2 boolean NOT NULL DEFAULT true,
  allow_sutda3 boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.room_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_types TO authenticated;
GRANT ALL ON public.room_types TO service_role;
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_types_read ON public.room_types FOR SELECT USING (true);
CREATE POLICY room_types_admin ON public.room_types FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER room_types_updated_at BEFORE UPDATE ON public.room_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.room_types (id, name, min_points, base_bet, max_players, sort_order) VALUES
  ('beginner', '초보방', 100000, 1000, 5, 1),
  ('normal',   '일반방', 300000, 2000, 5, 2),
  ('expert',   '고수방', 800000, 3500, 5, 3);

ALTER TABLE public.game_rooms
  ADD COLUMN room_type text NOT NULL DEFAULT 'normal' REFERENCES public.room_types(id);

-- 2) CARD ASSETS --------------------------------------------------------------
CREATE TABLE public.card_assets (
  id text PRIMARY KEY,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 10),
  variant text NOT NULL,
  asset_url text NOT NULL,
  is_gwang boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.card_assets TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_assets TO authenticated;
GRANT ALL ON public.card_assets TO service_role;
ALTER TABLE public.card_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY card_assets_read ON public.card_assets FOR SELECT USING (true);
CREATE POLICY card_assets_admin ON public.card_assets FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER card_assets_updated_at BEFORE UPDATE ON public.card_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.card_assets (id, month, variant, asset_url, is_gwang, name) VALUES
  ('m01-gwang',  1, 'gwang',  '/cards/hwatu/m01-gwang.png',  true,  '1월 송학 광'),
  ('m01-normal', 1, 'normal', '/cards/hwatu/m01-normal.png', false, '1월 송학'),
  ('m02-a',      2, 'normal', '/cards/hwatu/m02-a.png',      false, '2월 매조'),
  ('m02-b',      2, 'normal', '/cards/hwatu/m02-b.png',      false, '2월 매조 열'),
  ('m03-gwang',  3, 'gwang',  '/cards/hwatu/m03-gwang.png',  true,  '3월 벚꽃 광'),
  ('m03-normal', 3, 'normal', '/cards/hwatu/m03-normal.png', false, '3월 벚꽃'),
  ('m04-a',      4, 'normal', '/cards/hwatu/m04-a.png',      false, '4월 흑싸리'),
  ('m04-b',      4, 'normal', '/cards/hwatu/m04-b.png',      false, '4월 흑싸리 열'),
  ('m05-a',      5, 'normal', '/cards/hwatu/m05-a.png',      false, '5월 난초'),
  ('m05-b',      5, 'normal', '/cards/hwatu/m05-b.png',      false, '5월 난초 열'),
  ('m06-a',      6, 'normal', '/cards/hwatu/m06-a.png',      false, '6월 모란'),
  ('m06-b',      6, 'normal', '/cards/hwatu/m06-b.png',      false, '6월 모란 열'),
  ('m07-a',      7, 'normal', '/cards/hwatu/m07-a.png',      false, '7월 홍싸리'),
  ('m07-b',      7, 'normal', '/cards/hwatu/m07-b.png',      false, '7월 홍싸리 열'),
  ('m08-gwang',  8, 'gwang',  '/cards/hwatu/m08-gwang.png',  true,  '8월 공산 광'),
  ('m08-normal', 8, 'normal', '/cards/hwatu/m08-normal.png', false, '8월 공산'),
  ('m09-a',      9, 'normal', '/cards/hwatu/m09-a.png',      false, '9월 국화'),
  ('m09-b',      9, 'normal', '/cards/hwatu/m09-b.png',      false, '9월 국화 열'),
  ('m10-a',     10, 'normal', '/cards/hwatu/m10-a.png',      false, '10월 단풍'),
  ('m10-b',     10, 'normal', '/cards/hwatu/m10-b.png',      false, '10월 단풍 열');

-- 3) NOTICES ------------------------------------------------------------------
CREATE TABLE public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notices TO authenticated;
GRANT ALL ON public.notices TO service_role;
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY notices_public_read ON public.notices FOR SELECT
  USING (published = true OR public.is_admin(auth.uid()));
CREATE POLICY notices_admin ON public.notices FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER notices_updated_at BEFORE UPDATE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) REPORTS ------------------------------------------------------------------
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'user',
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  room_id uuid,
  round_id uuid,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED',
  admin_note text,
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_self_read ON public.reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY reports_self_insert ON public.reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
CREATE POLICY reports_admin ON public.reports FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER reports_updated_at BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) 시스템 설정 추가 항목 ------------------------------------------------------
INSERT INTO public.app_settings (key, value) VALUES
  ('maintenance_enabled', 'false'::jsonb),
  ('maintenance_message', '"점검 중입니다. 잠시 후 다시 이용해 주세요."'::jsonb),
  ('notice_popup_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 6) 방 입장 서버 검증 ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_room(_room_id uuid, _spectator boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _room game_rooms;
  _rt room_types;
  _p profiles;
  _seat integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  SELECT * INTO _rt FROM room_types WHERE id = _room.room_type;
  SELECT * INTO _p FROM profiles WHERE id = _uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION '회원 정보를 찾을 수 없습니다.'; END IF;
  IF _p.status = 'suspended' THEN RAISE EXCEPTION '이용이 정지된 계정입니다.'; END IF;

  IF NOT _spectator AND _rt.id IS NOT NULL THEN
    IF NOT _rt.active THEN RAISE EXCEPTION '%은 현재 이용할 수 없습니다.', _rt.name; END IF;
    IF _p.game_points < _rt.min_points THEN
      RAISE EXCEPTION '% 입장을 위해 최소 %P가 필요합니다.',
        _rt.name, to_char(_rt.min_points, 'FM999,999,999');
    END IF;
  END IF;

  SELECT seat INTO _seat FROM game_room_players WHERE room_id = _room_id AND user_id = _uid;
  IF _seat IS NOT NULL THEN RETURN _seat; END IF;

  IF NOT _spectator THEN
    IF (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
       >= _room.max_players THEN
      RAISE EXCEPTION '방 정원이 가득 찼습니다.';
    END IF;
  END IF;

  SELECT COALESCE(min(s.n), 0) INTO _seat
  FROM generate_series(0, GREATEST(_room.max_players - 1, 0)) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM game_room_players gp
    WHERE gp.room_id = _room_id AND gp.is_spectator = false AND gp.seat = s.n
  );

  INSERT INTO game_room_players (room_id, user_id, seat, is_spectator)
  VALUES (_room_id, _uid, _seat, _spectator);

  UPDATE game_rooms SET current_players =
    (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
  WHERE id = _room_id;

  RETURN _seat;
END;
$$;

-- 7) 관리자 운영 함수 ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_status(_user_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before text;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('active','suspended','chat_banned') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT status INTO _before FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  UPDATE profiles SET status = _status WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'set_user_status', 'profile', _user_id,
    jsonb_build_object('before', _before, 'after', _status, 'reason', _reason));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_level(_user_id uuid, _level integer, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before integer;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _level < 1 THEN RAISE EXCEPTION '레벨은 1 이상이어야 합니다.'; END IF;
  SELECT level INTO _before FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  UPDATE profiles SET level = _level WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'set_user_level', 'profile', _user_id,
    jsonb_build_object('before', _before, 'after', _level, 'reason', _reason));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_grant_item(_user_id uuid, _item_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  INSERT INTO user_items (user_id, item_id) VALUES (_user_id, _item_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'grant_item', 'profile', _user_id,
    jsonb_build_object('item_id', _item_id, 'reason', _reason));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_room_type(
  _id text, _min_points bigint, _base_bet bigint, _max_players integer,
  _active boolean, _allow_sutda2 boolean, _allow_sutda3 boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _min_points < 0 OR _base_bet <= 0 OR _max_players < 2 THEN RAISE EXCEPTION '설정값이 올바르지 않습니다.'; END IF;
  SELECT to_jsonb(r) INTO _before FROM room_types r WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION '방 등급을 찾을 수 없습니다.'; END IF;
  UPDATE room_types SET min_points = _min_points, base_bet = _base_bet, max_players = _max_players,
    active = _active, allow_sutda2 = _allow_sutda2, allow_sutda3 = _allow_sutda3
  WHERE id = _id;
  INSERT INTO admin_logs (admin_id, action, target_type, metadata)
  VALUES (_uid, 'update_room_type', 'room_type',
    jsonb_build_object('id', _id, 'before', _before,
      'after', (SELECT to_jsonb(r) FROM room_types r WHERE id = _id)));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_setting(_key text, _value jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT value INTO _before FROM app_settings WHERE key = _key;
  INSERT INTO app_settings (key, value) VALUES (_key, _value)
  ON CONFLICT (key) DO UPDATE SET value = _value, updated_at = now();
  INSERT INTO admin_logs (admin_id, action, target_type, metadata)
  VALUES (_uid, 'update_setting', 'app_setting',
    jsonb_build_object('key', _key, 'before', _before, 'after', _value));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_update_card_asset(
  _id text, _asset_url text, _enabled boolean, _is_gwang boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT to_jsonb(c) INTO _before FROM card_assets c WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION '카드를 찾을 수 없습니다.'; END IF;
  UPDATE card_assets SET asset_url = _asset_url, enabled = _enabled,
    is_gwang = COALESCE(_is_gwang, is_gwang) WHERE id = _id;
  INSERT INTO admin_logs (admin_id, action, target_type, metadata)
  VALUES (_uid, 'update_card_asset', 'card_asset',
    jsonb_build_object('id', _id, 'before', _before,
      'after', (SELECT to_jsonb(c) FROM card_assets c WHERE id = _id)));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_handle_report(_report_id uuid, _status text, _admin_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before text;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('RECEIVED','REVIEWING','RESOLVED','REJECTED') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT status INTO _before FROM reports WHERE id = _report_id;
  IF _before IS NULL THEN RAISE EXCEPTION '신고를 찾을 수 없습니다.'; END IF;
  UPDATE reports SET status = _status, admin_note = COALESCE(_admin_note, admin_note),
    handled_by = _uid, handled_at = now() WHERE id = _report_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'handle_report', 'report', _report_id,
    jsonb_build_object('before', _before, 'after', _status, 'note', _admin_note));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_recalc_season_rankings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _season uuid; _rows integer := 0;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT id INTO _season FROM seasons WHERE status = 'active' ORDER BY start_at DESC LIMIT 1;
  IF _season IS NULL THEN RAISE EXCEPTION '진행 중인 시즌이 없습니다.'; END IF;
  INSERT INTO season_rankings (season_id, user_id, rank_points, wins, losses)
  SELECT _season, p.id, p.rank_points, p.wins, p.losses FROM profiles p
  ON CONFLICT (season_id, user_id) DO UPDATE
    SET rank_points = EXCLUDED.rank_points, wins = EXCLUDED.wins, losses = EXCLUDED.losses;
  SELECT count(*) INTO _rows FROM season_rankings WHERE season_id = _season;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'recalc_rankings', 'season', _season, jsonb_build_object('rows', _rows));
  RETURN _rows;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_season_status(_season_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _before text;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('scheduled','active','ended') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT status INTO _before FROM seasons WHERE id = _season_id;
  IF _before IS NULL THEN RAISE EXCEPTION '시즌을 찾을 수 없습니다.'; END IF;
  IF _status = 'active' THEN UPDATE seasons SET status = 'ended', end_at = COALESCE(end_at, now())
    WHERE status = 'active' AND id <> _season_id; END IF;
  UPDATE seasons SET status = _status,
    end_at = CASE WHEN _status = 'ended' THEN COALESCE(end_at, now()) ELSE end_at END
  WHERE id = _season_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'set_season_status', 'season', _season_id,
    jsonb_build_object('before', _before, 'after', _status));
END; $$;

REVOKE EXECUTE ON FUNCTION public.join_room(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_level(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_grant_item(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_room_type(text, bigint, bigint, integer, boolean, boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_setting(text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_card_asset(text, text, boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_handle_report(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_recalc_season_rankings() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_season_status(uuid, text) FROM anon;