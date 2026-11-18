ALTER TABLE public.game_room_players
  ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS ready_required boolean NOT NULL DEFAULT true;

-- 준비 토글 (서버 권한) : 착석자 본인만, 진행 중 라운드가 없을 때만
CREATE OR REPLACE FUNCTION public.set_room_ready(_room_id uuid, _ready boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _nick text;
  _seated int;
  _ready_cnt int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished') THEN
    RAISE EXCEPTION '진행 중인 판이 있습니다.';
  END IF;
  UPDATE public.game_room_players
     SET is_ready = _ready,
         ready_at = CASE WHEN _ready THEN now() ELSE NULL END
   WHERE room_id = _room_id AND user_id = _uid AND is_spectator = false;
  IF NOT FOUND THEN RAISE EXCEPTION '착석한 플레이어만 준비할 수 있습니다.'; END IF;

  SELECT nickname INTO _nick FROM public.profiles WHERE id = _uid;
  INSERT INTO public.chat_messages (room_id, user_id, message, kind)
  VALUES (_room_id, NULL, COALESCE(_nick,'플레이어') || (CASE WHEN _ready THEN '님이 준비 완료했습니다.' ELSE '님이 준비를 취소했습니다.' END), 'system');

  SELECT count(*) FILTER (WHERE is_spectator=false AND leave_pending=false),
         count(*) FILTER (WHERE is_spectator=false AND leave_pending=false AND is_ready)
    INTO _seated, _ready_cnt
    FROM public.game_room_players WHERE room_id = _room_id;

  RETURN jsonb_build_object('seated', _seated, 'ready', _ready_cnt, 'allReady', _seated >= 2 AND _seated = _ready_cnt);
END; $$;

REVOKE ALL ON FUNCTION public.set_room_ready(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_room_ready(uuid, boolean) TO authenticated;

-- 라운드 시작 게이트: ready_required 방은 착석자 전원 READY일 때만 새 라운드 생성 허용
CREATE OR REPLACE FUNCTION public.angel_guard_round_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _req boolean; _seated int; _ready_cnt int;
BEGIN
  SELECT ready_required INTO _req FROM public.game_rooms WHERE id = NEW.room_id;
  IF COALESCE(_req, false) THEN
    SELECT count(*) FILTER (WHERE is_spectator=false AND leave_pending=false),
           count(*) FILTER (WHERE is_spectator=false AND leave_pending=false AND is_ready)
      INTO _seated, _ready_cnt
      FROM public.game_room_players WHERE room_id = NEW.room_id;
    IF _seated < 2 OR _seated <> _ready_cnt THEN
      RAISE EXCEPTION '착석한 플레이어 전원이 준비해야 게임이 시작됩니다.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_round_ready ON public.game_rounds;
CREATE TRIGGER trg_guard_round_ready
  BEFORE INSERT ON public.game_rounds
  FOR EACH ROW EXECUTE FUNCTION public.angel_guard_round_ready();

-- 라운드 시작 시 READY 초기화 및 이후 판 자동 진행 허용
CREATE OR REPLACE FUNCTION public.angel_reset_ready_on_round()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.game_room_players SET is_ready = false, ready_at = NULL WHERE room_id = NEW.room_id;
  UPDATE public.game_rooms SET ready_required = false WHERE id = NEW.room_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reset_ready_on_round ON public.game_rounds;
CREATE TRIGGER trg_reset_ready_on_round
  AFTER INSERT ON public.game_rounds
  FOR EACH ROW EXECUTE FUNCTION public.angel_reset_ready_on_round();

-- 입장/퇴장에 따른 준비 요구 갱신
CREATE OR REPLACE FUNCTION public.angel_sync_ready_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _room uuid; _active boolean; _seated int;
BEGIN
  _room := COALESCE(NEW.room_id, OLD.room_id);
  SELECT EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room AND status <> 'finished') INTO _active;
  IF TG_OP = 'INSERT' THEN
    IF _active THEN
      UPDATE public.game_room_players SET is_ready = true, ready_at = now()
        WHERE room_id = _room AND user_id = NEW.user_id;
    ELSE
      UPDATE public.game_rooms SET ready_required = true WHERE id = _room;
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _seated FROM public.game_room_players
    WHERE room_id = _room AND is_spectator = false AND leave_pending = false;
  IF NOT _active AND _seated < 2 THEN
    UPDATE public.game_rooms SET ready_required = true WHERE id = _room;
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_ready_requirement ON public.game_room_players;
CREATE TRIGGER trg_sync_ready_requirement
  AFTER INSERT OR DELETE ON public.game_room_players
  FOR EACH ROW EXECUTE FUNCTION public.angel_sync_ready_requirement();

-- 좌석 조회에 준비 상태 포함
CREATE OR REPLACE FUNCTION public.room_table_state(_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _room public.game_rooms; _seats jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM public.game_rooms WHERE id = _room_id;
  IF _room.id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(x ORDER BY (x->>'seat')::int) INTO _seats FROM (
    SELECT jsonb_build_object(
      'userId', rp.user_id,
      'seat', rp.seat,
      'nickname', pr.nickname,
      'rank', pr.rank,
      'points', pr.game_points,
      'avatarUrl', pr.avatar_url,
      'isSpectator', rp.is_spectator,
      'connection', rp.connection_status,
      'seatStatus', rp.seat_status,
      'leavePending', rp.leave_pending,
      'isReady', rp.is_ready,
      'isMe', rp.user_id = _uid,
      'character', public.equipped_item_asset(rp.user_id, 'character'),
      'title', public.equipped_item_asset(rp.user_id, 'title')
    ) AS x
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id = _room_id
  ) s;

  RETURN jsonb_build_object(
    'roomId', _room.id, 'roomNumber', _room.room_number, 'title', _room.title,
    'status', _room.status, 'mode', _room.game_mode, 'baseBet', _room.base_bet,
    'maxPlayers', _room.max_players, 'carryPot', _room.carry_pot,
    'readyRequired', _room.ready_required,
    'activeRound', EXISTS (SELECT 1 FROM public.game_rounds WHERE room_id=_room_id AND status <> 'finished'),
    'seats', COALESCE(_seats, '[]'::jsonb)
  );
END; $$;