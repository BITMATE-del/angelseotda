-- ===== 1. 회원 제재 컬럼 =====
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_until timestamptz,
  ADD COLUMN IF NOT EXISTS chat_banned_until timestamptz,
  ADD COLUMN IF NOT EXISTS sanction_reason text;

-- ===== 2. 방 종료/삭제 메타 =====
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text;

-- ===== 3. 상점 상품 확장 =====
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.items SET status = CASE WHEN enabled AND for_sale THEN 'ON_SALE' WHEN enabled THEN 'HIDDEN' ELSE 'PAUSED' END
WHERE status = 'DRAFT';

-- ===== 4. 방 진행 로그 (room_number 기준 영구 보관) =====
CREATE TABLE IF NOT EXISTS public.room_event_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  room_number integer NOT NULL,
  room_id uuid,
  round_id uuid,
  user_id uuid,
  nickname text,
  seat integer,
  event_type text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount bigint,
  pot_before bigint,
  pot_after bigint,
  action_id uuid,
  server_result text,
  error_code text
);

GRANT SELECT ON public.room_event_logs TO authenticated;
GRANT ALL ON public.room_event_logs TO service_role;
ALTER TABLE public.room_event_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read room logs" ON public.room_event_logs;
CREATE POLICY "admins read room logs" ON public.room_event_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS room_event_logs_number_idx ON public.room_event_logs (room_number, occurred_at DESC);
CREATE INDEX IF NOT EXISTS room_event_logs_user_idx ON public.room_event_logs (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS room_event_logs_round_idx ON public.room_event_logs (round_id);

-- 로그 기록 헬퍼 (카드 원문은 절대 기록하지 않는다)
CREATE OR REPLACE FUNCTION public.log_room_event(
  _room_id uuid,
  _event_type text,
  _user_id uuid DEFAULT NULL,
  _round_id uuid DEFAULT NULL,
  _seat integer DEFAULT NULL,
  _amount bigint DEFAULT NULL,
  _pot_before bigint DEFAULT NULL,
  _pot_after bigint DEFAULT NULL,
  _before jsonb DEFAULT '{}'::jsonb,
  _after jsonb DEFAULT '{}'::jsonb,
  _action_id uuid DEFAULT NULL,
  _server_result text DEFAULT NULL,
  _error_code text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _num integer; _nick text;
BEGIN
  SELECT room_number INTO _num FROM game_rooms WHERE id = _room_id;
  IF _num IS NULL THEN RETURN; END IF;
  IF _user_id IS NOT NULL THEN SELECT nickname INTO _nick FROM profiles WHERE id = _user_id; END IF;
  INSERT INTO room_event_logs (
    room_number, room_id, round_id, user_id, nickname, seat, event_type,
    before_state, after_state, amount, pot_before, pot_after, action_id, server_result, error_code
  ) VALUES (
    _num, _room_id, _round_id, _user_id, _nick, _seat, _event_type,
    COALESCE(_before, '{}'::jsonb) - 'cards' - 'card_code' - 'selected_cards',
    COALESCE(_after, '{}'::jsonb) - 'cards' - 'card_code' - 'selected_cards',
    _amount, _pot_before, _pot_after, _action_id, _server_result, _error_code
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.log_room_event(uuid,text,uuid,uuid,integer,bigint,bigint,bigint,jsonb,jsonb,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_room_event(uuid,text,uuid,uuid,integer,bigint,bigint,bigint,jsonb,jsonb,uuid,text,text) TO authenticated, service_role;

-- ===== 5. 채팅 금지 서버 검증 =====
CREATE OR REPLACE FUNCTION public.chat_messages_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  SELECT status, chat_banned_until, suspended_until INTO p FROM profiles WHERE id = NEW.user_id;
  IF p IS NULL THEN RETURN NEW; END IF;
  IF p.status = 'suspended' OR (p.suspended_until IS NOT NULL AND p.suspended_until > now()) THEN
    RAISE EXCEPTION '계정이 정지되어 채팅을 사용할 수 없습니다.';
  END IF;
  IF p.status = 'chat_banned' OR (p.chat_banned_until IS NOT NULL AND p.chat_banned_until > now()) THEN
    RAISE EXCEPTION '채팅이 금지된 상태입니다.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chat_messages_guard_trg ON public.chat_messages;
CREATE TRIGGER chat_messages_guard_trg BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_guard();

-- ===== 6. 관리자 세부 권한 =====
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (user_id, permission)
);

GRANT SELECT ON public.admin_permissions TO authenticated;
GRANT ALL ON public.admin_permissions TO service_role;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read permissions" ON public.admin_permissions;
CREATE POLICY "admins read permissions" ON public.admin_permissions
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.has_admin_permission(_user_id uuid, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (SELECT 1 FROM admin_permissions WHERE user_id = _user_id AND permission = _permission);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_permissions(_user_id uuid, _permissions text[], _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old text[];
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '최고관리자만 가능합니다.'; END IF;
  SELECT COALESCE(array_agg(permission), '{}') INTO _old FROM admin_permissions WHERE user_id = _user_id;
  DELETE FROM admin_permissions WHERE user_id = _user_id;
  INSERT INTO admin_permissions (user_id, permission, created_by)
  SELECT _user_id, p, auth.uid() FROM unnest(COALESCE(_permissions, '{}')) p;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'ADMIN_PERMISSIONS_SET', 'user', _user_id, _reason,
          jsonb_build_object('before', to_jsonb(_old), 'after', to_jsonb(COALESCE(_permissions,'{}'))));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_set_permissions(uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_permissions(uuid, text[], text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.has_admin_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(uuid, text) TO authenticated, service_role;

-- ===== 7. 회원 제재 RPC =====
CREATE OR REPLACE FUNCTION public.admin_suspend_user(_user_id uuid, _days integer, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb; _until timestamptz;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;
  IF (_days IS NULL OR _days <= 0) AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION '영구 정지는 최고관리자만 가능합니다.';
  END IF;
  SELECT jsonb_build_object('status', status, 'suspended_until', suspended_until) INTO _before
  FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  _until := CASE WHEN _days IS NULL OR _days <= 0 THEN NULL ELSE now() + make_interval(days => _days) END;
  UPDATE profiles SET status = 'suspended', suspended_until = _until, sanction_reason = _reason WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'USER_SUSPEND', 'user', _user_id, _reason,
    jsonb_build_object('before', _before, 'after', jsonb_build_object('status','suspended','suspended_until', _until), 'days', _days));
  RETURN jsonb_build_object('ok', true, 'until', _until);
END $$;

CREATE OR REPLACE FUNCTION public.admin_chat_ban_user(_user_id uuid, _hours integer, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb; _until timestamptz;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;
  SELECT jsonb_build_object('status', status, 'chat_banned_until', chat_banned_until) INTO _before
  FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  _until := CASE WHEN _hours IS NULL OR _hours <= 0 THEN NULL ELSE now() + make_interval(hours => _hours) END;
  UPDATE profiles
     SET chat_banned_until = _until,
         status = CASE WHEN status = 'suspended' THEN status ELSE 'chat_banned' END,
         sanction_reason = _reason
   WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'USER_CHAT_BAN', 'user', _user_id, _reason,
    jsonb_build_object('before', _before, 'after', jsonb_build_object('chat_banned_until', _until), 'hours', _hours));
  RETURN jsonb_build_object('ok', true, 'until', _until);
END $$;

CREATE OR REPLACE FUNCTION public.admin_clear_sanction(_user_id uuid, _kind text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _kind NOT IN ('suspend','chat','all') THEN RAISE EXCEPTION '잘못된 해제 유형입니다.'; END IF;
  SELECT jsonb_build_object('status', status, 'suspended_until', suspended_until, 'chat_banned_until', chat_banned_until)
    INTO _before FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  IF _kind IN ('suspend','all') THEN
    UPDATE profiles SET suspended_until = NULL WHERE id = _user_id;
  END IF;
  IF _kind IN ('chat','all') THEN
    UPDATE profiles SET chat_banned_until = NULL WHERE id = _user_id;
  END IF;
  UPDATE profiles
     SET status = CASE
       WHEN suspended_until IS NOT NULL AND suspended_until > now() THEN 'suspended'
       WHEN chat_banned_until IS NOT NULL AND chat_banned_until > now() THEN 'chat_banned'
       ELSE 'active' END,
         sanction_reason = NULLIF(_reason, '')
   WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'USER_SANCTION_CLEAR', 'user', _user_id, _reason,
    jsonb_build_object('before', _before, 'kind', _kind));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ===== 8. 회원 정보 수정 =====
CREATE OR REPLACE FUNCTION public.admin_update_member_profile(
  _user_id uuid,
  _username text DEFAULT NULL,
  _nickname text DEFAULT NULL,
  _telegram_id text DEFAULT NULL,
  _wallet_address text DEFAULT NULL,
  _status text DEFAULT NULL,
  _rank text DEFAULT NULL,
  _affiliate_id uuid DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb; _after jsonb; _banned text[] := ARRAY['운영자','관리자','admin','ADMIN','엔젤섯다운영'];
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '회원 정보 수정은 최고관리자만 가능합니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;

  SELECT to_jsonb(p) - 'game_points' - 'locked_points' INTO _before FROM profiles p WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;

  IF _username IS NOT NULL AND btrim(_username) <> '' THEN
    IF EXISTS (SELECT 1 FROM profiles WHERE lower(username) = lower(btrim(_username)) AND id <> _user_id) THEN
      RAISE EXCEPTION '이미 사용 중인 아이디입니다.';
    END IF;
    UPDATE profiles SET username = btrim(_username) WHERE id = _user_id;
  END IF;

  IF _nickname IS NOT NULL AND btrim(_nickname) <> '' THEN
    IF EXISTS (SELECT 1 FROM profiles WHERE lower(nickname) = lower(btrim(_nickname)) AND id <> _user_id) THEN
      RAISE EXCEPTION '이미 사용 중인 닉네임입니다.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(_banned) w WHERE btrim(_nickname) ILIKE '%' || w || '%') THEN
      RAISE EXCEPTION '사용할 수 없는 닉네임입니다.';
    END IF;
    UPDATE profiles SET nickname = btrim(_nickname) WHERE id = _user_id;
  END IF;

  IF _telegram_id IS NOT NULL THEN UPDATE profiles SET telegram_id = NULLIF(btrim(_telegram_id), '') WHERE id = _user_id; END IF;
  IF _wallet_address IS NOT NULL THEN UPDATE profiles SET wallet_address = NULLIF(btrim(_wallet_address), '') WHERE id = _user_id; END IF;
  IF _status IS NOT NULL THEN
    IF _status NOT IN ('active','suspended','chat_banned') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
    UPDATE profiles SET status = _status WHERE id = _user_id;
  END IF;
  IF _rank IS NOT NULL THEN
    UPDATE profiles SET rank = _rank::app_rank WHERE id = _user_id;
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), 'USER_RANK_MANUAL', 'user', _user_id, _reason,
            jsonb_build_object('before', _before -> 'rank', 'after', _rank, 'warning', '자동 계급 계산과 다른 수동 변경'));
  END IF;
  IF _affiliate_id IS NOT NULL THEN
    UPDATE profiles SET referred_by_affiliate_id = _affiliate_id WHERE id = _user_id;
  END IF;

  SELECT to_jsonb(p) - 'game_points' - 'locked_points' INTO _after FROM profiles p WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'MEMBER_PROFILE_UPDATE', 'user', _user_id, _reason,
          jsonb_build_object('before', _before, 'after', _after));
  RETURN jsonb_build_object('ok', true, 'after', _after);
END $$;

-- 잠금 포인트 특별 보정 (최고관리자 전용)
CREATE OR REPLACE FUNCTION public.admin_correct_locked_points(_user_id uuid, _locked bigint, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before bigint;
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '최고관리자만 가능합니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;
  IF _locked < 0 THEN RAISE EXCEPTION '잠금 포인트는 0 이상이어야 합니다.'; END IF;
  SELECT locked_points INTO _before FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  UPDATE profiles SET locked_points = _locked WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'LOCKED_POINTS_CORRECTION', 'user', _user_id, _reason,
          jsonb_build_object('before', _before, 'after', _locked));
  RETURN jsonb_build_object('ok', true, 'before', _before, 'after', _locked);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_suspend_user(uuid,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_chat_ban_user(uuid,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_clear_sanction(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_member_profile(uuid,text,text,text,text,text,text,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_correct_locked_points(uuid,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid,integer,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_chat_ban_user(uuid,integer,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_clear_sanction(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_member_profile(uuid,text,text,text,text,text,text,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_correct_locked_points(uuid,bigint,text) TO authenticated, service_role;

-- ===== 9. 방 관리 =====
CREATE OR REPLACE FUNCTION public.admin_list_rooms(_search text DEFAULT NULL, _filter text DEFAULT NULL, _limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'createdAt' DESC), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object(
      'roomId', gr.id,
      'roomNumber', gr.room_number,
      'title', gr.title,
      'roomType', gr.room_type,
      'mode', gr.game_mode,
      'status', gr.status,
      'basePet', gr.base_bet,
      'isTestRoom', gr.is_test_room,
      'createdAt', gr.created_at,
      'closedAt', gr.closed_at,
      'deletedAt', gr.deleted_at,
      'carryPot', gr.carry_pot,
      'players', (SELECT count(*) FROM game_room_players p WHERE p.room_id = gr.id AND NOT p.is_spectator AND p.seat_status <> 'LEFT'),
      'spectators', (SELECT count(*) FROM game_room_players p WHERE p.room_id = gr.id AND p.is_spectator AND p.seat_status <> 'LEFT'),
      'currentRoundId', (SELECT id FROM game_rounds x WHERE x.room_id = gr.id ORDER BY started_at DESC LIMIT 1),
      'currentRoundStatus', (SELECT status FROM game_rounds x WHERE x.room_id = gr.id ORDER BY started_at DESC LIMIT 1),
      'currentPot', COALESCE((SELECT pot FROM game_rounds x WHERE x.room_id = gr.id AND x.status <> 'finished' ORDER BY started_at DESC LIMIT 1), 0),
      'lastActivityAt', GREATEST(gr.created_at, COALESCE((SELECT max(started_at) FROM game_rounds x WHERE x.room_id = gr.id), gr.created_at)),
      'stuck', (
        gr.status IN ('waiting','playing')
        AND NOT EXISTS (SELECT 1 FROM game_room_players p WHERE p.room_id = gr.id AND p.seat_status <> 'LEFT')
        AND NOT EXISTS (SELECT 1 FROM game_rounds x WHERE x.room_id = gr.id AND x.status <> 'finished')
      )
    ) AS r
    FROM game_rooms gr
    WHERE (
      _search IS NULL OR btrim(_search) = ''
      OR gr.room_number::text ILIKE '%' || btrim(_search) || '%'
      OR gr.id::text ILIKE '%' || btrim(_search) || '%'
      OR EXISTS (
        SELECT 1 FROM game_room_players p JOIN profiles pr ON pr.id = p.user_id
        WHERE p.room_id = gr.id AND (pr.nickname ILIKE '%' || btrim(_search) || '%' OR pr.id::text ILIKE '%' || btrim(_search) || '%')
      )
    )
    AND (
      _filter IS NULL OR _filter = 'ALL'
      OR (_filter = 'TEST' AND gr.is_test_room)
      OR (_filter = 'EMPTY' AND NOT EXISTS (SELECT 1 FROM game_room_players p WHERE p.room_id = gr.id AND p.seat_status <> 'LEFT'))
      OR (_filter = 'WAITING' AND gr.status = 'waiting')
      OR (_filter = 'PLAYING' AND gr.status = 'playing')
      OR (_filter = 'PAUSED' AND gr.status = 'paused')
      OR (_filter = 'CLOSED' AND gr.status IN ('closed','deleted'))
    )
    ORDER BY gr.created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 300))
  ) s;
  RETURN _rows;
END $$;

CREATE OR REPLACE FUNCTION public.admin_room_snapshot(_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _room record; _round record; _players jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT * INTO _room FROM game_rooms WHERE id = _room_id;
  IF _room IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  SELECT * INTO _round FROM game_rounds WHERE room_id = _room_id ORDER BY started_at DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'userId', p.user_id,
    'nickname', pr.nickname,
    'seat', p.seat,
    'isSpectator', p.is_spectator,
    'seatStatus', p.seat_status,
    'connection', p.connection_status,
    'leavePending', p.leave_pending,
    'currentBet', COALESCE((SELECT rp.total_bet FROM game_round_players rp WHERE rp.round_id = _round.id AND rp.user_id = p.user_id), 0),
    'points', pr.game_points
  ) ORDER BY p.seat), '[]'::jsonb) INTO _players
  FROM game_room_players p JOIN profiles pr ON pr.id = p.user_id
  WHERE p.room_id = _room_id AND p.seat_status <> 'LEFT';

  RETURN jsonb_build_object(
    'roomId', _room.id,
    'roomNumber', _room.room_number,
    'title', _room.title,
    'status', _room.status,
    'mode', _room.game_mode,
    'isTestRoom', _room.is_test_room,
    'carryPot', _room.carry_pot,
    'players', _players,
    'playerCount', (SELECT count(*) FROM jsonb_array_elements(_players) e WHERE NOT (e->>'isSpectator')::boolean),
    'spectatorCount', (SELECT count(*) FROM jsonb_array_elements(_players) e WHERE (e->>'isSpectator')::boolean),
    'activeRound', CASE WHEN _round.id IS NULL OR _round.status = 'finished' THEN NULL ELSE jsonb_build_object(
      'roundId', _round.id, 'roundNumber', _round.round_number, 'phase', _round.phase, 'pot', _round.pot) END,
    'currentPot', COALESCE(CASE WHEN _round.status = 'finished' THEN 0 ELSE _round.pot END, 0)
  );
END $$;

-- 안전 종료: 진행 중 라운드는 정상 정산 → 신규 라운드 차단 → 좌석 정리 → CLOSED
CREATE OR REPLACE FUNCTION public.admin_safe_close_room(_room_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _snap jsonb; _round record; _settled jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;
  _snap := admin_room_snapshot(_room_id);

  SELECT * INTO _round FROM game_rounds WHERE room_id = _room_id AND status <> 'finished'
   ORDER BY started_at DESC LIMIT 1;
  IF _round.id IS NOT NULL THEN
    BEGIN
      _settled := settle_round(_round.id);
    EXCEPTION WHEN OTHERS THEN
      _settled := jsonb_build_object('error', SQLERRM);
    END;
  END IF;

  UPDATE game_rooms
     SET status = 'closed', closed_at = now(), close_reason = _reason,
         current_players = 0, current_round_id = NULL, rematch_pending = false, rematch_users = '{}'
   WHERE id = _room_id;
  UPDATE game_room_players SET seat_status = 'LEFT', leave_pending = false WHERE room_id = _room_id;

  PERFORM log_room_event(_room_id, 'ROOM_CLOSED', auth.uid(), _round.id, NULL, NULL, NULL, NULL,
                         _snap, jsonb_build_object('reason', _reason, 'settled', _settled), NULL, 'SAFE_CLOSE');
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'ROOM_SAFE_CLOSE', 'room', _room_id, _reason,
          jsonb_build_object('before', _snap, 'settled', _settled));
  RETURN jsonb_build_object('ok', true, 'settled', _settled);
END $$;

-- 강제 삭제: 최고관리자 + 방번호 확인. 과거 기록(라운드/액션/원장)은 보존한다.
CREATE OR REPLACE FUNCTION public.admin_force_delete_room(_room_id uuid, _room_number_confirm integer, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _snap jsonb; _num integer;
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '강제 삭제는 최고관리자만 가능합니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;
  SELECT room_number INTO _num FROM game_rooms WHERE id = _room_id;
  IF _num IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF _num <> _room_number_confirm THEN RAISE EXCEPTION '방 번호 확인이 일치하지 않습니다.'; END IF;

  _snap := admin_room_snapshot(_room_id);

  UPDATE game_rounds SET status = 'finished', finished_at = COALESCE(finished_at, now()),
         settlement_status = CASE WHEN settlement_status = 'PENDING' THEN 'CANCELLED' ELSE settlement_status END,
         phase = 'FINISHED', current_turn_user_id = NULL
   WHERE room_id = _room_id AND status <> 'finished';
  UPDATE game_room_players SET seat_status = 'LEFT', leave_pending = false WHERE room_id = _room_id;
  UPDATE game_rooms
     SET status = 'deleted', closed_at = COALESCE(closed_at, now()), deleted_at = now(),
         close_reason = _reason, current_players = 0, current_round_id = NULL,
         rematch_pending = false, rematch_users = '{}', carry_pot = 0
   WHERE id = _room_id;

  PERFORM log_room_event(_room_id, 'ROOM_FORCE_DELETED', auth.uid(), NULL, NULL, NULL, NULL, NULL,
                         _snap, jsonb_build_object('reason', _reason), NULL, 'FORCE_DELETE');
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'ROOM_FORCE_DELETE', 'room', _room_id, _reason,
          jsonb_build_object('before', _snap, 'roomNumber', _num));
  RETURN jsonb_build_object('ok', true, 'roomNumber', _num);
END $$;

-- 방 로그 검색
CREATE OR REPLACE FUNCTION public.admin_room_logs(
  _room_number integer DEFAULT NULL,
  _user_search text DEFAULT NULL,
  _round_id uuid DEFAULT NULL,
  _event_type text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.occurred_at DESC), '[]'::jsonb) INTO _rows
  FROM (
    SELECT * FROM room_event_logs
     WHERE (_room_number IS NULL OR room_number = _room_number)
       AND (_round_id IS NULL OR round_id = _round_id)
       AND (_event_type IS NULL OR _event_type = '' OR event_type = _event_type)
       AND (_from IS NULL OR occurred_at >= _from)
       AND (_to IS NULL OR occurred_at <= _to)
       AND (
         _user_search IS NULL OR btrim(_user_search) = ''
         OR nickname ILIKE '%' || btrim(_user_search) || '%'
         OR user_id::text ILIKE '%' || btrim(_user_search) || '%'
       )
     ORDER BY occurred_at DESC
     LIMIT GREATEST(1, LEAST(_limit, 1000))
  ) l;
  RETURN _rows;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_list_rooms(text,text,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_room_snapshot(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_safe_close_room(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_force_delete_room(uuid,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_room_logs(integer,text,uuid,text,timestamptz,timestamptz,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_rooms(text,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_room_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_safe_close_room(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_force_delete_room(uuid,integer,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_room_logs(integer,text,uuid,text,timestamptz,timestamptz,integer) TO authenticated, service_role;

-- ===== 10. 상점 상품 관리 =====
CREATE OR REPLACE FUNCTION public.admin_upsert_item(
  _id uuid,
  _category text,
  _name text,
  _description text,
  _price bigint,
  _rarity text,
  _asset_url text,
  _images jsonb,
  _status text,
  _sort_order integer,
  _reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb; _new_id uuid; _sold boolean;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _name IS NULL OR btrim(_name) = '' THEN RAISE EXCEPTION '상품명을 입력해 주세요.'; END IF;
  IF _price IS NULL OR _price < 0 THEN RAISE EXCEPTION '가격을 확인해 주세요.'; END IF;
  IF _rarity NOT IN ('NORMAL','RARE') THEN RAISE EXCEPTION '등급은 NORMAL 또는 RARE만 가능합니다.'; END IF;
  IF _status NOT IN ('DRAFT','ON_SALE','PAUSED','SOLD_OUT','HIDDEN') THEN RAISE EXCEPTION '잘못된 판매 상태입니다.'; END IF;

  IF _id IS NOT NULL THEN
    SELECT to_jsonb(i) INTO _before FROM items i WHERE id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.'; END IF;
    _sold := EXISTS (SELECT 1 FROM user_items WHERE item_id = _id);
    IF (_before->>'rarity') = 'RARE' AND _sold THEN
      IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '판매 완료된 RARE 상품은 최고관리자만 수정할 수 있습니다.'; END IF;
      IF (_before->>'price')::bigint <> _price THEN RAISE EXCEPTION '판매 완료된 RARE 상품의 가격은 변경할 수 없습니다.'; END IF;
    END IF;
    UPDATE items SET
      category = _category, name = btrim(_name), description = _description, price = _price,
      rarity = _rarity, asset_url = _asset_url, images = COALESCE(_images, '[]'::jsonb),
      status = CASE WHEN _sold AND _rarity = 'RARE' THEN 'SOLD_OUT' ELSE _status END,
      sort_order = COALESCE(_sort_order, 0),
      enabled = (_status IN ('ON_SALE','SOLD_OUT')),
      for_sale = (_status = 'ON_SALE'),
      updated_at = now()
    WHERE id = _id;
    _new_id := _id;
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), 'ITEM_UPDATE', 'item', _id, _reason,
            jsonb_build_object('before', _before, 'after', (SELECT to_jsonb(i) FROM items i WHERE id = _id)));
  ELSE
    INSERT INTO items (category, name, description, price, rarity, asset_url, images, status, sort_order, enabled, for_sale, source_type)
    VALUES (_category, btrim(_name), _description, _price, _rarity, _asset_url, COALESCE(_images,'[]'::jsonb),
            _status, COALESCE(_sort_order,0), _status IN ('ON_SALE','SOLD_OUT'), _status = 'ON_SALE', 'shop')
    RETURNING id INTO _new_id;
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), 'ITEM_CREATE', 'item', _new_id, _reason,
            jsonb_build_object('after', (SELECT to_jsonb(i) FROM items i WHERE id = _new_id)));
  END IF;
  RETURN _new_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_item_status(_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb; _sold boolean;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('DRAFT','ON_SALE','PAUSED','SOLD_OUT','HIDDEN') THEN RAISE EXCEPTION '잘못된 판매 상태입니다.'; END IF;
  SELECT to_jsonb(i) INTO _before FROM items i WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.'; END IF;
  _sold := EXISTS (SELECT 1 FROM user_items WHERE item_id = _id);
  IF (_before->>'rarity') = 'RARE' AND _sold AND _status <> 'SOLD_OUT' THEN
    RAISE EXCEPTION '판매 완료된 RARE 상품은 SOLD_OUT 상태를 유지합니다.';
  END IF;
  UPDATE items SET status = _status, enabled = (_status IN ('ON_SALE','SOLD_OUT')),
                   for_sale = (_status = 'ON_SALE'), updated_at = now()
   WHERE id = _id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'ITEM_STATUS', 'item', _id, _reason,
          jsonb_build_object('before', _before->>'status', 'after', _status));
END $$;

CREATE OR REPLACE FUNCTION public.admin_delete_item(_id uuid, _reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb; _sold boolean;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;
  SELECT to_jsonb(i) INTO _before FROM items i WHERE id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.'; END IF;
  _sold := EXISTS (SELECT 1 FROM user_items WHERE item_id = _id);
  IF _sold THEN
    UPDATE items SET status = 'HIDDEN', enabled = false, for_sale = false, updated_at = now() WHERE id = _id;
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), 'ITEM_ARCHIVE', 'item', _id, _reason, jsonb_build_object('before', _before));
    RETURN 'ARCHIVED';
  END IF;
  DELETE FROM items WHERE id = _id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'ITEM_DELETE', 'item', _id, _reason, jsonb_build_object('before', _before));
  RETURN 'DELETED';
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_upsert_item(uuid,text,text,text,bigint,text,text,jsonb,text,integer,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_item_status(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_item(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_item(uuid,text,text,text,bigint,text,text,jsonb,text,integer,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_item_status(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_item(uuid,text) TO authenticated, service_role;

-- ===== 11. 설정 저장 (수수료 합계 검증) =====
CREATE OR REPLACE FUNCTION public.admin_update_settings(_values jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k text; v jsonb; _before jsonb := '{}'::jsonb; _fee numeric; _aff numeric; _com numeric;
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '설정 변경은 최고관리자만 가능합니다.'; END IF;

  IF _values ? 'charge_fee_rate' OR _values ? 'affiliate_share_rate' OR _values ? 'company_share_rate' THEN
    _fee := COALESCE((_values->>'charge_fee_rate')::numeric, (SELECT (value#>>'{}')::numeric FROM app_settings WHERE key='charge_fee_rate'), 0.07);
    _aff := COALESCE((_values->>'affiliate_share_rate')::numeric, (SELECT (value#>>'{}')::numeric FROM app_settings WHERE key='affiliate_share_rate'), 0.02);
    _com := COALESCE((_values->>'company_share_rate')::numeric, (SELECT (value#>>'{}')::numeric FROM app_settings WHERE key='company_share_rate'), 0.05);
    IF round(_aff + _com, 6) <> round(_fee, 6) THEN
      RAISE EXCEPTION '수수료 배분 합계가 충전 수수료와 일치하지 않습니다. (총판 % + 운영 % = 수수료 %)', _aff, _com, _fee;
    END IF;
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(_values) LOOP
    _before := _before || jsonb_build_object(k, (SELECT value FROM app_settings WHERE key = k));
    INSERT INTO app_settings (key, value, updated_at) VALUES (k, v, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END LOOP;

  INSERT INTO admin_logs (admin_id, action, target_type, reason, metadata)
  VALUES (auth.uid(), 'SETTINGS_UPDATE', 'settings', _reason,
          jsonb_build_object('before', _before, 'after', _values));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_rank_requirement(
  _rank text, _min_charge_amount numeric, _min_charge_count integer,
  _min_attendance integer, _points_reward bigint, _reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _before jsonb;
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '계급 설정은 최고관리자만 가능합니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;
  SELECT to_jsonb(r) INTO _before FROM rank_requirements r WHERE rank = _rank::app_rank;
  IF _before IS NULL THEN RAISE EXCEPTION '계급을 찾을 수 없습니다.'; END IF;
  UPDATE rank_requirements
     SET min_charge_amount = _min_charge_amount, min_charge_count = _min_charge_count,
         min_attendance = _min_attendance, points_reward = _points_reward
   WHERE rank = _rank::app_rank;
  INSERT INTO admin_logs (admin_id, action, target_type, reason, metadata)
  VALUES (auth.uid(), 'RANK_REQUIREMENT_UPDATE', 'rank', _reason,
          jsonb_build_object('before', _before, 'after', (SELECT to_jsonb(r) FROM rank_requirements r WHERE rank = _rank::app_rank)));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_update_settings(jsonb,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_rank_requirement(text,numeric,integer,integer,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_settings(jsonb,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_rank_requirement(text,numeric,integer,integer,bigint,text) TO authenticated, service_role;

-- ===== 12. 운영 로그 검색 =====
CREATE OR REPLACE FUNCTION public.admin_search_logs(
  _admin_search text DEFAULT NULL,
  _target_search text DEFAULT NULL,
  _action text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'created_at' DESC), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object(
      'id', l.id, 'created_at', l.created_at, 'action', l.action,
      'admin_id', l.admin_id, 'admin_nickname', ap.nickname,
      'target_type', l.target_type, 'target_id', l.target_id, 'target_nickname', tp.nickname,
      'reason', l.reason, 'metadata', l.metadata
    ) AS r
    FROM admin_logs l
    LEFT JOIN profiles ap ON ap.id = l.admin_id
    LEFT JOIN profiles tp ON tp.id = l.target_id
    WHERE (_action IS NULL OR _action = '' OR l.action = _action)
      AND (_from IS NULL OR l.created_at >= _from)
      AND (_to IS NULL OR l.created_at <= _to)
      AND (_admin_search IS NULL OR btrim(_admin_search) = ''
           OR ap.nickname ILIKE '%' || btrim(_admin_search) || '%'
           OR l.admin_id::text ILIKE '%' || btrim(_admin_search) || '%')
      AND (_target_search IS NULL OR btrim(_target_search) = ''
           OR tp.nickname ILIKE '%' || btrim(_target_search) || '%'
           OR l.target_id::text ILIKE '%' || btrim(_target_search) || '%'
           OR l.metadata::text ILIKE '%' || btrim(_target_search) || '%')
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 1000))
  ) s;
  RETURN _rows;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_search_logs(text,text,text,timestamptz,timestamptz,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_logs(text,text,text,timestamptz,timestamptz,integer) TO authenticated, service_role;

-- ===== 13. 회원 관리 목록 (계급 중심, 이메일은 상세에서만) =====
CREATE OR REPLACE FUNCTION public.admin_list_members(_search text DEFAULT NULL, _limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'created_at' DESC), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object(
      'id', p.id, 'username', p.username, 'nickname', p.nickname, 'rank', p.rank,
      'game_points', p.game_points, 'locked_points', p.locked_points,
      'wins', p.wins, 'losses', p.losses, 'status', p.status,
      'suspended_until', p.suspended_until, 'chat_banned_until', p.chat_banned_until,
      'last_seen_at', p.last_seen_at, 'created_at', p.created_at,
      'total_charge_amount', p.total_charge_amount, 'total_charge_count', p.total_charge_count,
      'total_withdraw_amount', COALESCE((SELECT sum(payout_amount) FROM withdrawal_requests w WHERE w.user_id = p.id AND w.status = 'approved'), 0),
      'attendance_count', p.attendance_count,
      'is_test_user', p.is_test_user,
      'affiliate_code', (SELECT a.affiliate_code FROM affiliates a WHERE a.id = p.referred_by_affiliate_id),
      'rounds_played', (SELECT count(*) FROM game_round_players rp WHERE rp.user_id = p.id)
    ) AS r
    FROM profiles p
    WHERE _search IS NULL OR btrim(_search) = ''
       OR p.nickname ILIKE '%' || btrim(_search) || '%'
       OR p.username ILIKE '%' || btrim(_search) || '%'
       OR p.id::text ILIKE '%' || btrim(_search) || '%'
    ORDER BY p.created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 300))
  ) s;
  RETURN _rows;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_list_members(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_members(text,integer) TO authenticated, service_role;