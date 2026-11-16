-- 1) 운영 모드/플래그 설정값
INSERT INTO public.app_settings (key, value) VALUES
  ('app_mode', '"TEST"'::jsonb),
  ('game_lock', 'false'::jsonb),
  ('maintenance_block_charge', 'false'::jsonb),
  ('maintenance_block_withdraw', 'false'::jsonb),
  ('maintenance_block_login', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2) 테스트 계정 / 테스트 방 구분
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_test_user boolean NOT NULL DEFAULT false;
ALTER TABLE public.game_rooms ADD COLUMN IF NOT EXISTS is_test_room boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.profiles_guard_self_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF public.is_admin(auth.uid()) OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.username IS DISTINCT FROM OLD.username
     OR NEW.telegram_id IS DISTINCT FROM OLD.telegram_id
     OR NEW.wallet_address IS DISTINCT FROM OLD.wallet_address THEN
    RAISE EXCEPTION '아이디 · 텔레그램 아이디 · 지갑주소는 고객센터 문의로만 변경할 수 있습니다.';
  END IF;
  IF NEW.game_points IS DISTINCT FROM OLD.game_points
     OR NEW.locked_points IS DISTINCT FROM OLD.locked_points
     OR NEW.rank_points IS DISTINCT FROM OLD.rank_points
     OR NEW.rank IS DISTINCT FROM OLD.rank
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.is_test_user IS DISTINCT FROM OLD.is_test_user
     OR NEW.referred_by_affiliate_id IS DISTINCT FROM OLD.referred_by_affiliate_id
     OR NEW.total_charge_amount IS DISTINCT FROM OLD.total_charge_amount
     OR NEW.total_charge_count IS DISTINCT FROM OLD.total_charge_count
     OR NEW.attendance_count IS DISTINCT FROM OLD.attendance_count THEN
    RAISE EXCEPTION '해당 항목은 변경할 수 없습니다.';
  END IF;
  RETURN NEW;
END; $function$;

-- 3) 게임 서버 오류 로그
CREATE TABLE IF NOT EXISTS public.game_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  room_id uuid,
  round_id uuid,
  fn text NOT NULL,
  error_code text,
  error_message text NOT NULL,
  phase text,
  action text,
  retried boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.game_error_logs TO authenticated;
GRANT ALL ON public.game_error_logs TO service_role;
ALTER TABLE public.game_error_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_error_logs_admin_select" ON public.game_error_logs;
CREATE POLICY "game_error_logs_admin_select" ON public.game_error_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.game_error_logs FROM authenticated;

CREATE INDEX IF NOT EXISTS game_error_logs_occurred_idx ON public.game_error_logs (occurred_at DESC);

CREATE OR REPLACE FUNCTION public.log_game_error(_fn text, _error_message text, _error_code text DEFAULT NULL,
  _round_id uuid DEFAULT NULL, _room_id uuid DEFAULT NULL, _phase text DEFAULT NULL,
  _action text DEFAULT NULL, _retried boolean DEFAULT false, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO public.game_error_logs (user_id, room_id, round_id, fn, error_code, error_message, phase, action, retried, metadata)
  VALUES (auth.uid(), _room_id, _round_id, left(COALESCE(_fn,'unknown'),120), left(_error_code, 80),
          left(COALESCE(_error_message,''), 2000), left(_phase,40), left(_action,40), COALESCE(_retried,false),
          COALESCE(_metadata,'{}'::jsonb));
END; $$;

-- 4) 운영 상태 조회 (모든 사용자)
CREATE OR REPLACE FUNCTION public.ops_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_object_agg(key, value) FROM public.app_settings
   WHERE key IN ('app_mode','maintenance_enabled','maintenance_message','game_lock',
                 'maintenance_block_charge','maintenance_block_withdraw','maintenance_block_login',
                 'charge_enabled','withdraw_enabled');
$$;
GRANT EXECUTE ON FUNCTION public.ops_status() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_flag(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT (value#>>'{}')::boolean FROM public.app_settings WHERE key = _key), false);
$$;

-- 5) 입장 가드 (점검/테스트방)
CREATE OR REPLACE FUNCTION public.join_room(_room_id uuid, _spectator boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _uid uuid := auth.uid(); _room game_rooms; _rt room_types; _p profiles; _seat integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  SELECT * INTO _rt FROM room_types WHERE id = _room.room_type;
  SELECT * INTO _p FROM profiles WHERE id = _uid;
  IF _p.id IS NULL THEN RAISE EXCEPTION '회원 정보를 찾을 수 없습니다.'; END IF;
  IF _p.status = 'suspended' THEN RAISE EXCEPTION '이용이 정지된 계정입니다.'; END IF;

  IF public.ops_flag('maintenance_enabled') AND NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '현재 서버 점검 중입니다. 진행 중인 게임은 정상 종료되며 새로운 게임 입장은 잠시 제한됩니다.';
  END IF;

  IF _room.is_test_room AND NOT _p.is_test_user AND NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION '테스트 전용 방입니다. 테스트 계정만 입장할 수 있습니다.';
  END IF;
  IF NOT _room.is_test_room AND _p.is_test_user AND public.ops_flag('game_lock') THEN
    RAISE EXCEPTION '현재 신규 게임 입장이 제한되어 있습니다.';
  END IF;

  IF NOT _spectator AND _rt.id IS NOT NULL THEN
    IF NOT _rt.active THEN RAISE EXCEPTION '%은 현재 이용할 수 없습니다.', _rt.name; END IF;
    IF _p.game_points < _rt.min_points THEN
      RAISE EXCEPTION '% 입장을 위해 최소 %P가 필요합니다.', _rt.name, to_char(_rt.min_points, 'FM999,999,999');
    END IF;
  END IF;

  SELECT seat INTO _seat FROM game_room_players WHERE room_id = _room_id AND user_id = _uid;
  IF _seat IS NOT NULL THEN RETURN _seat; END IF;

  IF NOT _spectator THEN
    IF (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false) >= _room.max_players THEN
      RAISE EXCEPTION '방 정원이 가득 찼습니다.';
    END IF;
  END IF;

  SELECT COALESCE(min(s.n), 0) INTO _seat
  FROM generate_series(0, GREATEST(_room.max_players - 1, 0)) AS s(n)
  WHERE NOT EXISTS (SELECT 1 FROM game_room_players gp
    WHERE gp.room_id = _room_id AND gp.is_spectator = false AND gp.seat = s.n);

  INSERT INTO game_room_players (room_id, user_id, seat, is_spectator)
  VALUES (_room_id, _uid, _seat, _spectator);

  UPDATE game_rooms SET current_players =
    (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
  WHERE id = _room_id;

  RETURN _seat;
END; $function$;

-- 6) 신규 라운드 차단 가드 (game_lock / 점검)
CREATE OR REPLACE FUNCTION public.assert_round_start_allowed()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.ops_flag('game_lock') THEN
    RAISE EXCEPTION '현재 신규 게임 시작이 일시 중단되었습니다. 진행 중인 게임은 정상 종료됩니다.';
  END IF;
  IF public.ops_flag('maintenance_enabled') THEN
    RAISE EXCEPTION '현재 서버 점검 중입니다. 진행 중인 게임은 정상 종료되며 새로운 게임 시작은 잠시 제한됩니다.';
  END IF;
END; $$;