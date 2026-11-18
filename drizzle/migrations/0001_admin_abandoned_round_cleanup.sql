-- 전원 이탈로 진행 불가능해진 방치 판(sutda2/sutda3)을 관리자가 기여금 기준으로 환급하며 취소하는 운영 경로.
-- 기존 정산(settle_round) 경로는 건드리지 않는다. 환급은 멱등하며 audit log는 1회만 남는다.

CREATE OR REPLACE FUNCTION public.admin_abandoned_rounds(_min_idle_minutes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _rows jsonb;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'lastActivityAt'), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object(
      'roundId', r.id,
      'roomId', r.room_id,
      'roomNumber', g.room_number,
      'roomTitle', g.title,
      'roomStatus', g.status,
      'mode', r.game_mode,
      'phase', r.phase,
      'status', r.status,
      'pot', r.pot,
      'carryIn', COALESCE(r.carry_in, 0),
      'startedAt', r.started_at,
      'lastActivityAt', COALESCE(r.last_activity_at, r.started_at),
      'activeSeats', (SELECT count(*) FROM game_room_players p
                       WHERE p.room_id = r.room_id AND p.seat_status <> 'LEFT'
                         AND p.leave_pending = false AND p.is_spectator = false),
      'refundPreview', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'userId', rp.user_id, 'nickname', pr.nickname,
                 'seat', rp.seat, 'amount', COALESCE(rp.total_bet, 0))
               ORDER BY rp.seat), '[]'::jsonb)
        FROM game_round_players rp LEFT JOIN profiles pr ON pr.id = rp.user_id
        WHERE rp.round_id = r.id AND COALESCE(rp.total_bet, 0) > 0
      ),
      'refundTotal', (SELECT COALESCE(sum(COALESCE(rp.total_bet, 0)), 0)
                        FROM game_round_players rp WHERE rp.round_id = r.id),
      'alreadyRefunded', EXISTS (SELECT 1 FROM point_transactions t
                                  WHERE t.reference_type = 'game_round_refund'
                                    AND t.reference_id = r.id)
    ) AS x
    FROM game_rounds r JOIN game_rooms g ON g.id = r.room_id
    WHERE r.status NOT IN ('finished', 'cancelled')
      AND COALESCE(r.settlement_status, 'PENDING') NOT IN ('SETTLED')
      AND COALESCE(r.last_activity_at, r.started_at) < now() - make_interval(mins => GREATEST(0, _min_idle_minutes))
      AND NOT EXISTS (
        SELECT 1 FROM game_room_players p
         WHERE p.room_id = r.room_id AND p.seat_status <> 'LEFT'
           AND p.leave_pending = false AND p.is_spectator = false
      )
  ) s;
  RETURN _rows;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_abandoned_round(_round_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _r record; _active int; _p record; _prof profiles;
        _refunded bigint := 0; _rows jsonb := '[]'::jsonb; _carry bigint;
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION '사유를 입력해 주세요.'; END IF;

  SELECT * INTO _r FROM game_rounds WHERE id = _round_id FOR UPDATE;
  IF _r.id IS NULL THEN RAISE EXCEPTION '판을 찾을 수 없습니다.'; END IF;

  IF _r.status IN ('finished', 'cancelled') OR COALESCE(_r.settlement_status, 'PENDING') = 'SETTLED' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_CLOSED', 'refunded', 0);
  END IF;

  SELECT count(*) INTO _active FROM game_room_players p
   WHERE p.room_id = _r.room_id AND p.seat_status <> 'LEFT'
     AND p.leave_pending = false AND p.is_spectator = false;
  IF _active > 0 THEN
    RAISE EXCEPTION '아직 참가자가 남아 있는 판입니다. (활성 좌석 %)', _active;
  END IF;

  IF EXISTS (SELECT 1 FROM point_transactions
              WHERE reference_type = 'game_round_refund' AND reference_id = _round_id) THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_REFUNDED', 'refunded', 0);
  END IF;

  FOR _p IN
    SELECT rp.user_id, rp.seat, COALESCE(rp.total_bet, 0) AS bet
      FROM game_round_players rp
     WHERE rp.round_id = _round_id AND COALESCE(rp.total_bet, 0) > 0
     ORDER BY rp.seat
  LOOP
    SELECT * INTO _prof FROM profiles WHERE id = _p.user_id FOR UPDATE;
    IF _prof.id IS NULL THEN CONTINUE; END IF;

    UPDATE profiles SET game_points = game_points + _p.bet WHERE id = _p.user_id;

    INSERT INTO point_transactions
      (user_id, type, amount, balance_before, balance_after, locked_before, locked_after,
       reference_type, reference_id, admin_id, memo)
    VALUES (_p.user_id, 'game_refund', _p.bet, _prof.game_points, _prof.game_points + _p.bet,
            _prof.locked_points, _prof.locked_points, 'game_round_refund', _round_id,
            auth.uid(), '방치 판 환급: ' || _reason);

    _refunded := _refunded + _p.bet;
    _rows := _rows || jsonb_build_object('userId', _p.user_id, 'seat', _p.seat, 'amount', _p.bet);
  END LOOP;

  _carry := COALESCE(_r.carry_in, 0);
  IF _carry > 0 THEN
    UPDATE game_rooms SET carry_pot = COALESCE(carry_pot, 0) + _carry WHERE id = _r.room_id;
  END IF;

  UPDATE game_rounds
     SET status = 'cancelled',
         settlement_status = 'CANCELLED',
         settled = false,
         pot = 0,
         finished_at = COALESCE(finished_at, now()),
         phase = 'FINISHED',
         current_turn_user_id = NULL,
         turn_deadline_at = NULL,
         paused_reason = 'ABANDONED_CLEANUP',
         last_activity_at = now()
   WHERE id = _round_id;

  UPDATE game_rooms SET current_round_id = NULL, rematch_pending = false, rematch_users = '{}'
   WHERE id = _r.room_id AND current_round_id = _round_id;

  PERFORM log_room_event(_r.room_id, 'ROUND_CANCELLED', auth.uid(), _round_id, NULL, NULL, NULL, NULL,
                         NULL, jsonb_build_object('reason', _reason, 'refunded', _refunded,
                                                  'refunds', _rows, 'carryRestored', _carry),
                         NULL, 'ABANDONED_CLEANUP');

  INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'ROUND_ABANDONED_CLEANUP', 'game_round', _round_id, _reason,
          jsonb_build_object('roomId', _r.room_id, 'refunded', _refunded,
                             'refunds', _rows, 'carryRestored', _carry, 'phase', _r.phase));

  PERFORM close_or_hold_room(_r.room_id);

  RETURN jsonb_build_object('ok', true, 'code', 'CANCELLED', 'refunded', _refunded,
                            'refunds', _rows, 'carryRestored', _carry);
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_abandoned_rounds(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_abandoned_round(uuid, text) TO authenticated;
