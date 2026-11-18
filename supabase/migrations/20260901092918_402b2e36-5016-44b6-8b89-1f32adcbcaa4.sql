-- =========================================================
-- 1. 게임 진행/접속 상태 (추가만)
-- =========================================================
ALTER TABLE public.game_round_players
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'CONNECTED',
  ADD COLUMN IF NOT EXISTS player_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reconnect_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_type text;

ALTER TABLE public.game_room_players
  ADD COLUMN IF NOT EXISTS seat_status text NOT NULL DEFAULT 'OCCUPIED',
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'CONNECTED',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.game_rounds
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_id uuid,
  ADD COLUMN IF NOT EXISTS turn_deadline_at timestamptz;

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS channel_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN IF NOT EXISTS room_code text;

UPDATE public.game_rooms
   SET room_code = 'R' || upper(substr(replace(id::text,'-',''),1,6))
 WHERE room_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS game_rooms_room_code_key ON public.game_rooms (room_code);

-- 2. 중복 베팅 방지
ALTER TABLE public.game_actions
  ADD COLUMN IF NOT EXISTS action_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS game_actions_idempotency_key
  ON public.game_actions (round_id, user_id, action_id);

-- 3. 총판 수수료 중복/정산 상태
ALTER TABLE public.affiliate_commissions
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_commissions_charge_key
  ON public.affiliate_commissions (charge_request_id)
  WHERE charge_request_id IS NOT NULL;

-- 4. 관리자 로그 보강 / 이상 사용자 플래그
ALTER TABLE public.admin_logs
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS session_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'LOW',
  ADD COLUMN IF NOT EXISTS risk_note text;

-- =========================================================
-- 5. 상태 변경 로그 테이블
-- =========================================================
CREATE TABLE IF NOT EXISTS public.charge_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_request_id uuid NOT NULL REFERENCES public.charge_requests(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.charge_request_logs TO authenticated;
GRANT ALL ON public.charge_request_logs TO service_role;
ALTER TABLE public.charge_request_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "charge_logs_admin_read" ON public.charge_request_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "charge_logs_own_read" ON public.charge_request_logs
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.charge_requests c
     WHERE c.id = charge_request_id AND c.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.withdrawal_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_request_id uuid NOT NULL REFERENCES public.withdrawal_requests(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.withdrawal_request_logs TO authenticated;
GRANT ALL ON public.withdrawal_request_logs TO service_role;
ALTER TABLE public.withdrawal_request_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "withdraw_logs_admin_read" ON public.withdrawal_request_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "withdraw_logs_own_read" ON public.withdrawal_request_logs
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.withdrawal_requests w
     WHERE w.id = withdrawal_request_id AND w.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.affiliate_commission_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id uuid NOT NULL REFERENCES public.affiliate_commissions(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.affiliate_commission_logs TO authenticated;
GRANT ALL ON public.affiliate_commission_logs TO service_role;
ALTER TABLE public.affiliate_commission_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_logs_admin_read" ON public.affiliate_commission_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "commission_logs_affiliate_read" ON public.affiliate_commission_logs
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.affiliate_commissions ac
      JOIN public.affiliates a ON a.id = ac.affiliate_id
     WHERE ac.id = commission_id AND a.user_id = auth.uid()));

-- =========================================================
-- 6. 충전/출금 상태 변경 로그 트리거
-- =========================================================
CREATE OR REPLACE FUNCTION public.log_charge_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO charge_request_logs (charge_request_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO charge_request_logs (charge_request_id, from_status, to_status, changed_by, reason)
    VALUES (NEW.id, OLD.status, NEW.status, COALESCE(NEW.processed_by, auth.uid()), NEW.admin_note);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_charge_status_log ON public.charge_requests;
CREATE TRIGGER trg_charge_status_log
AFTER INSERT OR UPDATE ON public.charge_requests
FOR EACH ROW EXECUTE FUNCTION public.log_charge_status_change();

CREATE OR REPLACE FUNCTION public.log_withdrawal_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO withdrawal_request_logs (withdrawal_request_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'PAID' THEN
      RAISE EXCEPTION '지급완료(PAID)는 최종 상태이므로 변경할 수 없습니다.';
    END IF;
    INSERT INTO withdrawal_request_logs (withdrawal_request_id, from_status, to_status, changed_by, reason)
    VALUES (NEW.id, OLD.status, NEW.status, COALESCE(NEW.processed_by, auth.uid()), NEW.admin_note);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_withdrawal_status_log ON public.withdrawal_requests;
CREATE TRIGGER trg_withdrawal_status_log
AFTER INSERT OR UPDATE ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION public.log_withdrawal_status_change();

-- =========================================================
-- 7. 좌석 선택 / 접속 유지 / 재접속
-- =========================================================
CREATE OR REPLACE FUNCTION public.select_seat(_room_id uuid, _seat integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _room game_rooms;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _room FROM game_rooms WHERE id = _room_id FOR UPDATE;
  IF _room.id IS NULL THEN RAISE EXCEPTION '방을 찾을 수 없습니다.'; END IF;
  IF _seat < 0 OR _seat > _room.max_players - 1 THEN RAISE EXCEPTION '잘못된 좌석입니다.'; END IF;
  IF EXISTS (SELECT 1 FROM game_room_players
              WHERE room_id = _room_id AND seat = _seat AND is_spectator = false AND user_id <> _uid) THEN
    RAISE EXCEPTION '이미 사용 중인 좌석입니다.';
  END IF;
  UPDATE game_room_players
     SET seat = _seat, is_spectator = false, seat_status = 'OCCUPIED',
         connection_status = 'CONNECTED', last_seen_at = now()
   WHERE room_id = _room_id AND user_id = _uid;
  IF NOT FOUND THEN
    INSERT INTO game_room_players (room_id, user_id, seat, is_spectator)
    VALUES (_room_id, _uid, _seat, false);
  END IF;
  UPDATE game_rooms SET current_players =
    (SELECT count(*) FROM game_room_players WHERE room_id = _room_id AND is_spectator = false)
   WHERE id = _room_id;
  RETURN _seat;
END; $$;

CREATE OR REPLACE FUNCTION public.game_heartbeat(_room_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  UPDATE game_room_players SET connection_status = 'CONNECTED', last_seen_at = now()
   WHERE room_id = _room_id AND user_id = _uid;
  UPDATE game_round_players rp SET connection_status = 'CONNECTED', last_seen_at = now(),
         reconnect_deadline_at = NULL
    FROM game_rounds r
   WHERE rp.round_id = r.id AND r.room_id = _room_id AND rp.user_id = _uid
     AND r.status <> 'finished';
  UPDATE profiles SET last_seen_at = now() WHERE id = _uid;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_disconnected(_room_id uuid, _grace_seconds integer DEFAULT 30)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  UPDATE game_room_players SET connection_status = 'DISCONNECTED', seat_status = 'DISCONNECTED'
   WHERE room_id = _room_id AND user_id = _uid;
  UPDATE game_round_players rp
     SET connection_status = 'DISCONNECTED',
         reconnect_deadline_at = now() + make_interval(secs => GREATEST(_grace_seconds, 5))
    FROM game_rounds r
   WHERE rp.round_id = r.id AND r.room_id = _room_id AND rp.user_id = _uid
     AND r.status <> 'finished' AND rp.folded = false;
END; $$;

-- 진행 중인 내 게임 (새로고침 복귀용)
CREATE OR REPLACE FUNCTION public.my_active_game()
RETURNS TABLE (room_id uuid, round_id uuid, seat integer, room_title text, game_mode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gr.id, r.id, gp.seat, gr.title, gr.game_mode
    FROM game_room_players gp
    JOIN game_rooms gr ON gr.id = gp.room_id
    LEFT JOIN game_rounds r ON r.room_id = gr.id AND r.status <> 'finished'
   WHERE gp.user_id = auth.uid() AND gp.is_spectator = false
     AND gr.status <> 'closed'
   ORDER BY gp.joined_at DESC
   LIMIT 1;
$$;

-- 유예시간 초과자 자동 다이
CREATE OR REPLACE FUNCTION public.expire_disconnected_players(_round_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer := 0;
BEGIN
  UPDATE game_round_players
     SET folded = true, player_status = 'FOLDED', result = COALESCE(result, 'lose'),
         result_type = COALESCE(result_type, 'LOSE')
   WHERE round_id = _round_id AND folded = false
     AND reconnect_deadline_at IS NOT NULL AND reconnect_deadline_at < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

-- =========================================================
-- 8. 베팅 접수 (멱등 + 잔액 검증)
-- =========================================================
CREATE OR REPLACE FUNCTION public.place_action(
  _round_id uuid, _action_id uuid, _action_type text, _amount bigint, _turn_number integer)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _round game_rounds;
  _rp game_round_players;
  _p profiles;
  _spent bigint;
  _max bigint;
  _final bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _action_id IS NULL THEN RAISE EXCEPTION '액션 식별자가 필요합니다.'; END IF;

  -- 이미 처리된 액션이면 무시 (더블클릭/재전송 방지)
  IF EXISTS (SELECT 1 FROM game_actions
              WHERE round_id = _round_id AND user_id = _uid AND action_id = _action_id) THEN
    RETURN (SELECT amount FROM game_actions
             WHERE round_id = _round_id AND user_id = _uid AND action_id = _action_id);
  END IF;

  SELECT * INTO _round FROM game_rounds WHERE id = _round_id FOR UPDATE;
  IF _round.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;
  IF _round.settled OR _round.status = 'finished' THEN RAISE EXCEPTION '이미 종료된 라운드입니다.'; END IF;

  SELECT * INTO _rp FROM game_round_players
   WHERE round_id = _round_id AND user_id = _uid FOR UPDATE;
  IF _rp.id IS NULL THEN RAISE EXCEPTION '해당 라운드의 참가자가 아닙니다.'; END IF;
  IF _rp.folded THEN RAISE EXCEPTION '다이한 플레이어는 행동할 수 없습니다.'; END IF;

  IF _action_type = 'die' THEN
    UPDATE game_round_players SET folded = true, player_status = 'FOLDED'
     WHERE id = _rp.id;
    INSERT INTO game_actions (round_id, user_id, action_id, action_type, amount, turn_number)
    VALUES (_round_id, _uid, _action_id, 'die', 0, _turn_number);
    RETURN 0;
  END IF;

  SELECT * INTO _p FROM profiles WHERE id = _uid;
  SELECT COALESCE(SUM(amount),0) INTO _spent FROM game_actions
   WHERE round_id = _round_id AND user_id = _uid;

  -- 잔액보다 큰 베팅 금지: 가용 포인트(잠금 제외) 한도로 절삭
  _max := GREATEST(_p.game_points - _p.locked_points - _spent, 0);
  _final := LEAST(GREATEST(_amount, 0), _max);
  IF _final <= 0 AND _action_type <> 'check' THEN
    RAISE EXCEPTION '보유 포인트가 부족합니다.';
  END IF;

  INSERT INTO game_actions (round_id, user_id, action_id, action_type, amount, turn_number)
  VALUES (_round_id, _uid, _action_id, _action_type, _final, _turn_number);

  IF _final >= _max THEN
    UPDATE game_round_players SET player_status = 'ALL_IN' WHERE id = _rp.id;
  END IF;

  UPDATE game_rounds SET pot = (SELECT COALESCE(SUM(amount),0) FROM game_actions WHERE round_id = _round_id)
   WHERE id = _round_id;

  RETURN _final;
END; $$;

-- =========================================================
-- 9. 정산 (단일 트랜잭션 · 중복 금지 · 동점 분배)
-- =========================================================
CREATE OR REPLACE FUNCTION public.settle_round(_round_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _round game_rounds;
  _rec record;
  _pot bigint := 0;
  _winners uuid[];
  _n integer;
  _share bigint;
  _remainder bigint;
  _first uuid;
  _p profiles;
  _pay bigint;
  _sid uuid := gen_random_uuid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _round FROM game_rounds WHERE id = _round_id FOR UPDATE;
  IF _round.id IS NULL THEN RAISE EXCEPTION '라운드를 찾을 수 없습니다.'; END IF;

  -- 중복 정산 방지: 이미 정산된 라운드는 조용히 무시
  IF _round.settled OR _round.settlement_status = 'SETTLED' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM game_round_players WHERE round_id = _round_id AND user_id = _uid) THEN
    RAISE EXCEPTION '해당 라운드의 참가자가 아닙니다.';
  END IF;

  UPDATE game_rounds SET settlement_status = 'PROCESSING' WHERE id = _round_id;

  SELECT array_agg(user_id ORDER BY seat) INTO _winners
    FROM game_round_players
   WHERE round_id = _round_id AND result = 'win' AND folded = false;
  IF _winners IS NULL OR array_length(_winners, 1) = 0 THEN
    UPDATE game_rounds SET settlement_status = 'FAILED' WHERE id = _round_id;
    RAISE EXCEPTION '승자가 확정되지 않았습니다.';
  END IF;

  -- 참가자별 베팅 합계를 서버에서 계산해 차감
  FOR _rec IN
    SELECT a.user_id, SUM(a.amount)::bigint AS bet FROM game_actions a
     WHERE a.round_id = _round_id GROUP BY a.user_id
  LOOP
    IF _rec.bet <= 0 THEN CONTINUE; END IF;
    SELECT * INTO _p FROM profiles WHERE id = _rec.user_id FOR UPDATE;
    IF _p.id IS NULL THEN CONTINUE; END IF;
    IF _p.game_points < _rec.bet THEN
      RAISE EXCEPTION '참가자의 보유 포인트가 부족합니다.';
    END IF;
    _pot := _pot + _rec.bet;
    UPDATE profiles SET game_points = game_points - _rec.bet WHERE id = _rec.user_id;
    INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, memo)
    VALUES (_rec.user_id, 'game_loss', -_rec.bet, _p.game_points, _p.game_points - _rec.bet,
            _p.locked_points, _p.locked_points, 'game_round', _round_id, 'settlement ' || _sid);
  END LOOP;

  _n := array_length(_winners, 1);
  _share := CASE WHEN _pot > 0 THEN _pot / _n ELSE 0 END;
  _remainder := CASE WHEN _pot > 0 THEN _pot - (_share * _n) ELSE 0 END;
  _first := _winners[1]; -- 잔여 포인트 규칙: 가장 낮은 좌석(먼저 행동한) 승자에게 귀속

  IF _pot > 0 THEN
    FOREACH _rec IN ARRAY '{}'::record[] LOOP NULL; END LOOP; -- no-op (구문 호환)
    FOR _rec IN SELECT unnest(_winners) AS uid LOOP
      _pay := _share + CASE WHEN _rec.uid = _first THEN _remainder ELSE 0 END;
      SELECT * INTO _p FROM profiles WHERE id = _rec.uid FOR UPDATE;
      UPDATE profiles SET game_points = game_points + _pay WHERE id = _rec.uid;
      INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, memo)
      VALUES (_rec.uid, 'game_win', _pay, _p.game_points, _p.game_points + _pay,
              _p.locked_points, _p.locked_points, 'game_round', _round_id,
              CASE WHEN _n > 1 THEN format('무승부 분배 %s명', _n) ELSE '단독 승리' END);
    END LOOP;
  END IF;

  -- 전적 / 랭킹 (동점자는 무승부 처리: 승패 미반영, 랭킹 소폭 가산)
  IF _n = 1 THEN
    UPDATE game_round_players SET result_type = 'WIN' WHERE round_id = _round_id AND user_id = _first;
    UPDATE profiles p SET wins = p.wins + 1, current_streak = p.current_streak + 1,
      max_streak = GREATEST(p.max_streak, p.current_streak + 1),
      rank_points = p.rank_points + 25, exp = p.exp + 40,
      level = GREATEST(1, ((p.exp + 40) / 500)::int + 1)
     WHERE p.id = _first;
    UPDATE profiles p SET losses = p.losses + 1, current_streak = 0,
      rank_points = GREATEST(0, p.rank_points - 10), exp = p.exp + 12,
      level = GREATEST(1, ((p.exp + 12) / 500)::int + 1)
     WHERE p.id IN (SELECT user_id FROM game_round_players
                     WHERE round_id = _round_id AND user_id <> _first);
    UPDATE game_round_players SET result_type = 'LOSE'
     WHERE round_id = _round_id AND user_id <> _first AND result_type IS NULL;
    INSERT INTO season_rankings (season_id, user_id, rank_points, wins, losses)
    SELECT s.id, _first, 25, 1, 0 FROM seasons s WHERE s.status = 'active'
    ON CONFLICT (season_id, user_id)
    DO UPDATE SET rank_points = season_rankings.rank_points + 25, wins = season_rankings.wins + 1;
  ELSE
    UPDATE game_round_players SET result_type = 'DRAW'
     WHERE round_id = _round_id AND user_id = ANY(_winners);
    UPDATE game_round_players SET result_type = 'LOSE'
     WHERE round_id = _round_id AND NOT (user_id = ANY(_winners));
    UPDATE profiles p SET rank_points = p.rank_points + 5, exp = p.exp + 20
     WHERE p.id = ANY(_winners);
  END IF;

  UPDATE profiles SET gwangttaeng_count = gwangttaeng_count + 1
   WHERE id = ANY(_winners)
     AND EXISTS (SELECT 1 FROM game_round_players
                  WHERE round_id = _round_id AND user_id = profiles.id AND hand_rank LIKE '%광땡%');

  UPDATE game_rounds SET settled = true, status = 'finished', pot = _pot,
         winner_id = CASE WHEN _n = 1 THEN _first ELSE NULL END,
         finished_at = now(), settlement_status = 'SETTLED',
         settled_at = now(), settlement_id = _sid
   WHERE id = _round_id;
END; $$;

-- =========================================================
-- 10. 총판 수수료 정산 상태 변경
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_set_commission_status(
  _commission_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _before text;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _status NOT IN ('UNSETTLED','SETTLED','CANCELLED') THEN RAISE EXCEPTION '잘못된 상태입니다.'; END IF;
  SELECT status INTO _before FROM affiliate_commissions WHERE id = _commission_id FOR UPDATE;
  IF _before IS NULL THEN RAISE EXCEPTION '수수료 내역을 찾을 수 없습니다.'; END IF;
  UPDATE affiliate_commissions
     SET status = _status,
         settled_at = CASE WHEN _status = 'SETTLED' THEN now() ELSE NULL END,
         settled_by = CASE WHEN _status = 'SETTLED' THEN _uid ELSE NULL END
   WHERE id = _commission_id;
  INSERT INTO affiliate_commission_logs (commission_id, from_status, to_status, changed_by, reason)
  VALUES (_commission_id, _before, _status, _uid, _reason);
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, 'set_commission_status', 'affiliate_commission', _commission_id,
          jsonb_build_object('before', _before, 'after', _status), _reason);
END; $$;

-- =========================================================
-- 11. 관리자 회원 연락처 변경 (사유 필수 + 로그)
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_update_member_contact(
  _user_id uuid, _telegram_id text, _wallet_address text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 2 THEN RAISE EXCEPTION '변경 사유를 입력해야 합니다.'; END IF;
  SELECT jsonb_build_object('telegram_id', telegram_id, 'wallet_address', wallet_address)
    INTO _before FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  UPDATE profiles
     SET telegram_id = COALESCE(NULLIF(trim(_telegram_id), ''), telegram_id),
         wallet_address = COALESCE(NULLIF(trim(_wallet_address), ''), wallet_address)
   WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, 'update_member_contact', 'profile', _user_id,
          jsonb_build_object('before', _before,
            'after', jsonb_build_object('telegram_id', _telegram_id, 'wallet_address', _wallet_address)),
          _reason);
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_risk_level(
  _user_id uuid, _level text, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _before text;
BEGIN
  IF NOT is_admin(_uid) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _level NOT IN ('LOW','MEDIUM','HIGH') THEN RAISE EXCEPTION '잘못된 위험도입니다.'; END IF;
  SELECT risk_level INTO _before FROM profiles WHERE id = _user_id;
  IF _before IS NULL THEN RAISE EXCEPTION '회원을 찾을 수 없습니다.'; END IF;
  UPDATE profiles SET risk_level = _level, risk_note = _note WHERE id = _user_id;
  INSERT INTO admin_logs (admin_id, action, target_type, target_id, metadata, reason)
  VALUES (_uid, 'set_risk_level', 'profile', _user_id,
          jsonb_build_object('before', _before, 'after', _level), _note);
END; $$;

-- =========================================================
-- 12. 아이템 구매 함수 컬럼명 오류 수정
-- =========================================================
CREATE OR REPLACE FUNCTION public.purchase_item(_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _price bigint;
  _p profiles;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT price INTO _price FROM public.items WHERE id = _item_id AND enabled = true;
  IF _price IS NULL THEN RAISE EXCEPTION '판매 중인 아이템이 아닙니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_items WHERE user_id = _uid AND item_id = _item_id) THEN
    RAISE EXCEPTION '이미 보유한 아이템입니다.';
  END IF;
  SELECT * INTO _p FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _p.game_points - _p.locked_points < _price THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;

  UPDATE public.profiles SET game_points = game_points - _price WHERE id = _uid;
  INSERT INTO public.user_items (user_id, item_id) VALUES (_uid, _item_id);
  INSERT INTO public.point_transactions
    (user_id, type, amount, balance_before, balance_after, locked_before, locked_after,
     reference_type, reference_id, memo)
  VALUES (_uid, 'item_purchase', -_price, _p.game_points, _p.game_points - _price,
          _p.locked_points, _p.locked_points, 'item', _item_id, '상점 아이템 구매');
END; $$;

-- =========================================================
-- 13. 실행 권한
-- =========================================================
REVOKE ALL ON FUNCTION public.place_action(uuid, uuid, text, bigint, integer) FROM anon;
REVOKE ALL ON FUNCTION public.select_seat(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_action(uuid, uuid, text, bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.select_seat(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.game_heartbeat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_disconnected(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_active_game() TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_disconnected_players(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_commission_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_member_contact(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_risk_level(uuid, text, text) TO authenticated;