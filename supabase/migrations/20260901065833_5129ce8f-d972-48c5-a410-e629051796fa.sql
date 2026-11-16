-- ===== roles =====
CREATE TYPE public.app_role AS ENUM ('user','admin','super_admin');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  nickname text NOT NULL,
  avatar_url text,
  level int NOT NULL DEFAULT 1,
  exp bigint NOT NULL DEFAULT 0,
  game_points bigint NOT NULL DEFAULT 100000,
  locked_points bigint NOT NULL DEFAULT 0,
  rank_points bigint NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  gwangttaeng_count int NOT NULL DEFAULT 0,
  current_streak int NOT NULL DEFAULT 0,
  max_streak int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_public_read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','super_admin'));
$$;

CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- signup trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nickname)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(COALESCE(NEW.email,'angel'),'@',1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== settings =====
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated, anon;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "settings_admin_write" ON public.app_settings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.app_settings (key, value) VALUES
  ('points_per_won', '10'::jsonb),
  ('charge_min_amount', '10000'::jsonb),
  ('charge_max_amount', '5000000'::jsonb),
  ('withdraw_min_points', '10000'::jsonb),
  ('withdraw_max_points', '5000000'::jsonb),
  ('withdraw_daily_limit_points', '10000000'::jsonb),
  ('charge_enabled', 'true'::jsonb),
  ('withdraw_enabled', 'true'::jsonb),
  ('charge_notice', '"입금 확인 후 관리자가 승인하면 포인트가 지급됩니다."'::jsonb),
  ('withdraw_notice', '"출금 신청 포인트는 지급 완료까지 잠금 상태로 보관됩니다."'::jsonb);

-- ===== game =====
CREATE TABLE public.game_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  game_mode text NOT NULL DEFAULT 'sutda2',
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  max_players int NOT NULL DEFAULT 5,
  current_players int NOT NULL DEFAULT 0,
  min_points bigint NOT NULL DEFAULT 0,
  base_bet bigint NOT NULL DEFAULT 1000,
  password_hash text,
  friends_only boolean NOT NULL DEFAULT false,
  spectator_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_rooms TO authenticated;
GRANT SELECT ON public.game_rooms TO anon;
GRANT ALL ON public.game_rooms TO service_role;
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rooms_read" ON public.game_rooms FOR SELECT USING (true);
CREATE POLICY "rooms_insert" ON public.game_rooms FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);
CREATE POLICY "rooms_update" ON public.game_rooms FOR UPDATE TO authenticated
  USING (auth.uid() = host_id OR public.is_admin(auth.uid()));
CREATE POLICY "rooms_delete" ON public.game_rooms FOR DELETE TO authenticated
  USING (auth.uid() = host_id OR public.is_admin(auth.uid()));

CREATE TABLE public.game_room_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seat int NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  is_spectator boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id),
  UNIQUE (room_id, seat)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_room_players TO authenticated;
GRANT SELECT ON public.game_room_players TO anon;
GRANT ALL ON public.game_room_players TO service_role;
ALTER TABLE public.game_room_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "room_players_read" ON public.game_room_players FOR SELECT USING (true);
CREATE POLICY "room_players_self_write" ON public.game_room_players FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE TABLE public.game_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  round_number int NOT NULL DEFAULT 1,
  game_mode text NOT NULL DEFAULT 'sutda2',
  status text NOT NULL DEFAULT 'betting',
  pot bigint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.game_rounds TO authenticated;
GRANT ALL ON public.game_rounds TO service_role;
ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rounds_read" ON public.game_rounds FOR SELECT TO authenticated USING (true);
CREATE POLICY "rounds_write" ON public.game_rounds FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "rounds_update" ON public.game_rounds FOR UPDATE TO authenticated USING (true);

CREATE TABLE public.game_round_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seat int NOT NULL,
  initial_points bigint NOT NULL DEFAULT 0,
  final_points bigint,
  result text,
  hand_rank text,
  folded boolean NOT NULL DEFAULT false,
  UNIQUE (round_id, user_id)
);
GRANT SELECT, INSERT, UPDATE ON public.game_round_players TO authenticated;
GRANT ALL ON public.game_round_players TO service_role;
ALTER TABLE public.game_round_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "round_players_read" ON public.game_round_players FOR SELECT TO authenticated USING (true);
CREATE POLICY "round_players_write" ON public.game_round_players FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "round_players_update" ON public.game_round_players FOR UPDATE TO authenticated USING (true);

CREATE TABLE public.game_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  amount bigint NOT NULL DEFAULT 0,
  turn_number int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.game_actions TO authenticated;
GRANT ALL ON public.game_actions TO service_role;
ALTER TABLE public.game_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "actions_read" ON public.game_actions FOR SELECT TO authenticated USING (true);
CREATE POLICY "actions_insert" ON public.game_actions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE TABLE public.game_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_code text NOT NULL,
  card_order int NOT NULL DEFAULT 1
);
GRANT SELECT, INSERT ON public.game_cards TO authenticated;
GRANT ALL ON public.game_cards TO service_role;
ALTER TABLE public.game_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cards_owner_read" ON public.game_cards FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.game_rounds r WHERE r.id = round_id AND r.status = 'finished'));
CREATE POLICY "cards_insert" ON public.game_cards FOR INSERT TO authenticated WITH CHECK (true);

-- ===== ledger =====
CREATE TABLE public.point_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount bigint NOT NULL,
  balance_before bigint NOT NULL,
  balance_after bigint NOT NULL,
  locked_before bigint NOT NULL DEFAULT 0,
  locked_after bigint NOT NULL DEFAULT 0,
  reference_type text,
  reference_id uuid,
  admin_id uuid,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.point_transactions TO authenticated;
GRANT ALL ON public.point_transactions TO service_role;
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ledger_self_read" ON public.point_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- ===== wallet requests =====
CREATE TABLE public.charge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_amount numeric NOT NULL,
  point_amount bigint NOT NULL,
  conversion_rate numeric NOT NULL,
  depositor_name text NOT NULL,
  user_note text,
  admin_note text,
  status text NOT NULL DEFAULT 'REQUESTED',
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid
);
GRANT SELECT, INSERT ON public.charge_requests TO authenticated;
GRANT ALL ON public.charge_requests TO service_role;
ALTER TABLE public.charge_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "charge_self_read" ON public.charge_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "charge_self_insert" ON public.charge_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'REQUESTED');
CREATE POLICY "charge_admin_update" ON public.charge_requests FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_points bigint NOT NULL,
  payout_amount numeric NOT NULL,
  conversion_rate numeric NOT NULL,
  payout_method text NOT NULL,
  payout_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'REQUESTED',
  user_note text,
  admin_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid
);
GRANT SELECT ON public.withdrawal_requests TO authenticated;
GRANT ALL ON public.withdrawal_requests TO service_role;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "withdraw_self_read" ON public.withdrawal_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- ===== season / items / social =====
CREATE TABLE public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_at timestamptz NOT NULL DEFAULT now(),
  end_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  rewards jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.seasons TO authenticated, anon;
GRANT ALL ON public.seasons TO service_role;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seasons_read" ON public.seasons FOR SELECT USING (true);
CREATE POLICY "seasons_admin" ON public.seasons FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.season_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank_points bigint NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  UNIQUE (season_id, user_id)
);
GRANT SELECT ON public.season_rankings TO authenticated, anon;
GRANT ALL ON public.season_rankings TO service_role;
ALTER TABLE public.season_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "season_rankings_read" ON public.season_rankings FOR SELECT USING (true);

CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  name text NOT NULL,
  description text,
  asset_url text,
  price bigint NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.items TO authenticated, anon;
GRANT ALL ON public.items TO service_role;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "items_read" ON public.items FOR SELECT USING (true);
CREATE POLICY "items_admin" ON public.items FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.user_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  equipped boolean NOT NULL DEFAULT false,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);
GRANT SELECT, INSERT, UPDATE ON public.user_items TO authenticated;
GRANT ALL ON public.user_items TO service_role;
ALTER TABLE public.user_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_items_self" ON public.user_items FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid());

CREATE TABLE public.friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.friends TO authenticated;
GRANT ALL ON public.friends TO service_role;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "friends_involved" ON public.friends FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "friends_insert" ON public.friends FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());
CREATE POLICY "friends_update" ON public.friends FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());
CREATE POLICY "friends_delete" ON public.friends FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  kind text NOT NULL DEFAULT 'chat',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_read" ON public.chat_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "chat_insert" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE TABLE public.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  condition_json jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.achievements TO authenticated, anon;
GRANT ALL ON public.achievements TO service_role;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "achievements_read" ON public.achievements FOR SELECT USING (true);

CREATE TABLE public.user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_id)
);
GRANT SELECT ON public.user_achievements TO authenticated;
GRANT ALL ON public.user_achievements TO service_role;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_achievements_self" ON public.user_achievements FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'system',
  title text NOT NULL,
  body text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_self" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_self_update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_logs TO authenticated;
GRANT ALL ON public.admin_logs TO service_role;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_logs_admin" ON public.admin_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- ===== transactional RPCs =====
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  _points bigint, _method text, _details jsonb, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _rate numeric;
  _p profiles;
  _req uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _points <= 0 THEN RAISE EXCEPTION '출금 포인트가 올바르지 않습니다.'; END IF;
  SELECT (value#>>'{}')::numeric INTO _rate FROM app_settings WHERE key = 'points_per_won';
  SELECT * INTO _p FROM profiles WHERE id = _uid FOR UPDATE;
  IF _p.game_points < _points THEN RAISE EXCEPTION '보유 포인트가 부족합니다.'; END IF;

  UPDATE profiles SET game_points = game_points - _points,
                      locked_points = locked_points + _points
  WHERE id = _uid;

  INSERT INTO withdrawal_requests (user_id, requested_points, payout_amount, conversion_rate, payout_method, payout_details, user_note)
  VALUES (_uid, _points, _points / _rate, _rate, _method, COALESCE(_details,'{}'::jsonb), _note)
  RETURNING id INTO _req;

  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id)
  VALUES (_uid, 'withdraw_requested', -_points, _p.game_points, _p.game_points - _points,
          _p.locked_points, _p.locked_points + _points, 'withdrawal_request', _req);
  RETURN _req;
END;
$$;
REVOKE ALL ON FUNCTION public.request_withdrawal(bigint,text,jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(bigint,text,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_process_charge(_request_id uuid, _status text, _admin_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r charge_requests;
  _p profiles;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('REVIEWING','APPROVED','REJECTED') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT * INTO _r FROM charge_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
  IF _r.status IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION '이미 처리된 신청입니다.'; END IF;

  IF _status = 'APPROVED' THEN
    SELECT * INTO _p FROM profiles WHERE id = _r.user_id FOR UPDATE;
    UPDATE profiles SET game_points = game_points + _r.point_amount WHERE id = _r.user_id;
    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, admin_id)
    VALUES (_r.user_id, 'charge_approved', _r.point_amount, _p.game_points, _p.game_points + _r.point_amount,
            _p.locked_points, _p.locked_points, 'charge_request', _r.id, _uid);
  END IF;

  UPDATE charge_requests SET status = _status, admin_note = COALESCE(_admin_note, admin_note),
    processed_at = CASE WHEN _status = 'REVIEWING' THEN processed_at ELSE now() END,
    processed_by = _uid
  WHERE id = _request_id;

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'charge_' || lower(_status), 'charge_request', _request_id, jsonb_build_object('points', _r.point_amount));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_process_charge(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_process_charge(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_process_withdrawal(_request_id uuid, _status text, _admin_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _r withdrawal_requests;
  _p profiles;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('REVIEWING','APPROVED','PAID','REJECTED') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT * INTO _r FROM withdrawal_requests WHERE id = _request_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '신청을 찾을 수 없습니다.'; END IF;
  IF _r.status IN ('PAID','REJECTED','CANCELLED') THEN RAISE EXCEPTION '이미 최종 처리된 신청입니다.'; END IF;

  SELECT * INTO _p FROM profiles WHERE id = _r.user_id FOR UPDATE;

  IF _status = 'PAID' THEN
    IF _p.locked_points < _r.requested_points THEN RAISE EXCEPTION '잠금 포인트가 부족합니다.'; END IF;
    UPDATE profiles SET locked_points = locked_points - _r.requested_points WHERE id = _r.user_id;
    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, admin_id)
    VALUES (_r.user_id, 'withdraw_completed', 0, _p.game_points, _p.game_points,
            _p.locked_points, _p.locked_points - _r.requested_points, 'withdrawal_request', _r.id, _uid);
  ELSIF _status = 'REJECTED' THEN
    IF _p.locked_points < _r.requested_points THEN RAISE EXCEPTION '잠금 포인트가 부족합니다.'; END IF;
    UPDATE profiles SET locked_points = locked_points - _r.requested_points,
                        game_points = game_points + _r.requested_points
    WHERE id = _r.user_id;
    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, admin_id)
    VALUES (_r.user_id, 'withdraw_rejected', _r.requested_points, _p.game_points, _p.game_points + _r.requested_points,
            _p.locked_points, _p.locked_points - _r.requested_points, 'withdrawal_request', _r.id, _uid);
  END IF;

  UPDATE withdrawal_requests SET status = _status, admin_note = COALESCE(_admin_note, admin_note),
    processed_at = CASE WHEN _status IN ('REVIEWING','APPROVED') THEN processed_at ELSE now() END,
    processed_by = _uid
  WHERE id = _request_id;

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'withdraw_' || lower(_status), 'withdrawal_request', _request_id,
          jsonb_build_object('points', _r.requested_points));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_process_withdrawal(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_process_withdrawal(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_adjust_points(_user_id uuid, _amount bigint, _memo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _p profiles;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _p FROM profiles WHERE id = _user_id FOR UPDATE;
  IF _p.id IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  IF _p.game_points + _amount < 0 THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;
  UPDATE profiles SET game_points = game_points + _amount WHERE id = _user_id;
  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, admin_id, memo)
  VALUES (_user_id, CASE WHEN _amount >= 0 THEN 'admin_add' ELSE 'admin_remove' END, _amount,
          _p.game_points, _p.game_points + _amount, _p.locked_points, _p.locked_points, _uid, _memo);
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (_uid, 'adjust_points', 'profile', _user_id, jsonb_build_object('amount', _amount, 'memo', _memo));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_adjust_points(uuid,bigint,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_adjust_points(uuid,bigint,text) TO authenticated;

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_room_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_actions;

-- seed shop items
INSERT INTO public.items (category, name, description, price) VALUES
  ('card_skin','클래식 레드','전통 화투의 붉은 테두리와 레드 글로우',0),
  ('card_skin','미드나잇 블루','심야의 딥 블루 테두리 스킨',50000),
  ('card_skin','에메랄드 그린','에메랄드 광채 테두리 스킨',50000),
  ('card_skin','로열 퍼플','로열 퍼플 테두리 스킨',80000),
  ('table_skin','딥 네이비 펠트','기본 홀덤 테이블 펠트',0),
  ('table_skin','딥 그린 펠트','클래식 그린 펠트 테이블',60000),
  ('profile_frame','골드 윙 프레임','엔젤 윙 골드 프로필 프레임',70000),
  ('win_effect','골드 글로우','승리 시 골드 광채 이펙트',40000),
  ('emoticon','기본 이모티콘 팩','게임 채팅 기본 이모티콘',0),
  ('character','엔젤 마스터','기본 캐릭터',0);

INSERT INTO public.seasons (name, status) VALUES ('시즌 1 : 천사의 첫 패', 'active');
