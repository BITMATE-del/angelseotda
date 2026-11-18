-- 1) 좌석 부가정보(계급/칭호/캐릭터) 조회 헬퍼
CREATE OR REPLACE FUNCTION public.equipped_item_asset(_user_id uuid, _category text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('name', i.name, 'assetUrl', i.asset_url, 'itemId', i.id)
  FROM public.user_items ui JOIN public.items i ON i.id = ui.item_id
  WHERE ui.user_id = _user_id AND ui.equipped = true AND i.category = _category
  ORDER BY ui.equipped_at DESC NULLS LAST LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.equipped_item_asset(uuid, text) TO authenticated;

-- 2) 게임방 좌석 목록 (라운드 시작 전에도 상대가 보이도록)
CREATE OR REPLACE FUNCTION public.room_table_state(_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      'isMe', rp.user_id = _uid,
      'character', public.equipped_item_asset(rp.user_id, 'character'),
      'title', public.equipped_item_asset(rp.user_id, 'title')
    ) AS x
    FROM public.game_room_players rp JOIN public.profiles pr ON pr.id = rp.user_id
    WHERE rp.room_id = _room_id
  ) s;

  RETURN jsonb_build_object(
    'roomId', _room.id, 'title', _room.title, 'status', _room.status,
    'mode', _room.game_mode, 'baseBet', _room.base_bet, 'maxPlayers', _room.max_players,
    'seats', COALESCE(_seats, '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.room_table_state(uuid) TO authenticated;

-- 3) 라운드 상태: 계급/칭호/캐릭터 · 손익 · 서버 계산 버튼 금액 · 카드 정합성
CREATE OR REPLACE FUNCTION public.get_round_state(_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _r public.game_rounds; _seats jsonb; _finished boolean;
  _me public.game_round_players; _stage_bet bigint; _owed bigint; _bal bigint;
  _acts jsonb := '[]'::jsonb; _expected int; _bad int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT * INTO _r FROM public.game_rounds WHERE id=_round_id;
  IF _r.id IS NULL THEN RETURN NULL; END IF;
  _finished := _r.status = 'finished';

  SELECT jsonb_agg(x ORDER BY (x->>'seat')::int) INTO _seats FROM (
    SELECT jsonb_build_object(
      'userId', p.user_id,
      'seat', p.seat,
      'nickname', pr.nickname,
      'level', pr.level,
      'rank', pr.rank,
      'avatarUrl', pr.avatar_url,
      'points', pr.game_points,
      'initialPoints', p.initial_points,
      'finalPoints', p.final_points,
      'folded', p.folded,
      'status', p.player_status,
      'connection', p.connection_status,
      'acted', p.acted,
      'totalBet', p.total_bet,
      'resultType', p.result_type,
      'isMe', p.user_id = _uid,
      'character', public.equipped_item_asset(p.user_id, 'character'),
      'title', public.equipped_item_asset(p.user_id, 'title'),
      'cardCount', (SELECT count(*) FROM public.game_cards c
                     WHERE c.round_id=_round_id AND c.user_id=p.user_id
                       AND (c.card_order <= 2 OR _r.stage >= 2)),
      'cards', CASE
        WHEN p.user_id = _uid OR (_finished AND NOT p.folded) THEN
          COALESCE((SELECT jsonb_agg(c.card_code ORDER BY c.card_order) FROM public.game_cards c
             WHERE c.round_id=_round_id AND c.user_id=p.user_id
               AND (c.card_order <= 2 OR _r.stage >= 2 OR _finished)), '[]'::jsonb)
        ELSE '[]'::jsonb END,
      'handCode', CASE WHEN _finished THEN p.hand_code ELSE NULL END,
      'handName', CASE WHEN _finished THEN p.hand_rank ELSE NULL END,
      'selectedCards', CASE WHEN p.user_id=_uid OR _finished THEN p.selected_cards ELSE NULL END
    ) AS x
    FROM public.game_round_players p JOIN public.profiles pr ON pr.id = p.user_id
    WHERE p.round_id = _round_id
  ) s;

  -- 서버가 계산한 내 행동 목록/금액 (프론트 하드코딩 금지)
  SELECT * INTO _me FROM public.game_round_players WHERE round_id=_round_id AND user_id=_uid;
  IF _me.id IS NOT NULL AND NOT _finished AND NOT _me.folded
     AND _r.current_turn_user_id = _uid
     AND _r.phase IN ('BETTING','FIRST_BETTING','FINAL_BETTING') THEN
    SELECT COALESCE(sum(amount),0) INTO _stage_bet FROM public.game_actions
      WHERE round_id=_round_id AND user_id=_uid AND turn_number=_r.stage;
    _owed := GREATEST(_r.current_bet - _stage_bet, 0);
    SELECT game_points INTO _bal FROM public.profiles WHERE id=_uid;

    _acts := jsonb_build_array(jsonb_build_object('action','die','amount',0));
    IF _owed = 0 THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','check','amount',0));
    ELSE
      _acts := _acts || jsonb_build_array(
        jsonb_build_object('action','call','amount',LEAST(_owed, _bal)));
    END IF;
    IF _r.current_bet <= _r.base_bet THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','ping',
        'amount', LEAST(_owed + _r.base_bet, _bal)));
    END IF;
    _acts := _acts || jsonb_build_array(
      jsonb_build_object('action','ttadang','amount',
        LEAST(_owed + GREATEST(_r.current_bet, _r.base_bet) * 2, _bal)),
      jsonb_build_object('action','half','amount',
        LEAST(_owed + GREATEST(_r.pot / 2, _r.base_bet), _bal)));
    IF _r.game_mode = 'sutda3' AND _r.stage = 2 THEN
      _acts := _acts || jsonb_build_array(jsonb_build_object('action','jjol','amount',0));
    END IF;
  END IF;

  -- 카드 정합성: 2장 게임/3장 1스테이지 = 2장, 3장 2스테이지 = 3장
  _expected := CASE WHEN _r.game_mode='sutda3' AND _r.stage >= 2 THEN 3 ELSE 2 END;
  SELECT count(*) INTO _bad FROM public.game_round_players p
   WHERE p.round_id=_round_id AND p.folded=false
     AND (SELECT count(*) FROM public.game_cards c
           WHERE c.round_id=_round_id AND c.user_id=p.user_id
             AND (c.card_order <= 2 OR _r.stage >= 2)) <> _expected;

  RETURN jsonb_build_object(
    'roundId', _r.id, 'roomId', _r.room_id, 'mode', _r.game_mode, 'status', _r.status,
    'phase', _r.phase, 'stage', _r.stage, 'pot', _r.pot, 'baseBet', _r.base_bet,
    'currentBet', _r.current_bet, 'turnUserId', _r.current_turn_user_id,
    'turnDeadline', _r.turn_deadline_at, 'winnerId', _r.winner_id,
    'settlementStatus', _r.settlement_status, 'roundNumber', _r.round_number,
    'availableActions', _acts,
    'cardIntegrityOk', (_bad = 0),
    'seats', COALESCE(_seats, '[]'::jsonb),
    'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',a.user_id,'type',a.action_type,
                          'amount',a.amount,'stage',a.turn_number,'at',a.created_at) ORDER BY a.created_at)
                         FROM public.game_actions a WHERE a.round_id=_round_id), '[]'::jsonb)
  );
END; $$;

-- 4) 정산 후 게임방 유지: 착석 인원 2명 이상이면 PLAYING 유지
CREATE OR REPLACE FUNCTION public.close_or_hold_room(_room_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int; _next text;
BEGIN
  SELECT count(*) INTO _n FROM public.game_room_players
   WHERE room_id=_room_id AND is_spectator=false;
  IF public.ops_flag('game_lock') OR public.ops_flag('maintenance_enabled') THEN
    _next := 'paused';
  ELSIF _n = 0 THEN
    _next := 'closed';
  ELSIF _n < 2 THEN
    _next := 'waiting';
  ELSE
    _next := 'playing';
  END IF;
  UPDATE public.game_rooms SET status = _next WHERE id = _room_id;
  RETURN _next;
END; $$;

GRANT EXECUTE ON FUNCTION public.close_or_hold_room(uuid) TO authenticated;
