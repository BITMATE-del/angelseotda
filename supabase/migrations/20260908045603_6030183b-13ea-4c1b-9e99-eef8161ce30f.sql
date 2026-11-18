-- 도리짓고땡 관리자 모니터링 전용 RPC. 카드/덱 정보는 어떤 필드에도 포함하지 않는다.
create or replace function public.dori_admin_list_rooms(_include_closed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _rows jsonb;
begin
  if not is_admin(auth.uid()) then raise exception '권한이 없습니다.'; end if;
  select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) into _rows from (
    select jsonb_build_object(
      'roomId', r.id,
      'roomNumber', r.room_number,
      'title', r.title,
      'roomType', r.room_type,
      'status', r.status,
      'ante', r.ante,
      'isPrivate', r.is_private,
      'carryPot', r.carry_pot,
      'seated', (select count(*) from dori_room_players p where p.room_id = r.id),
      'maxPlayers', r.max_players,
      'createdAt', r.created_at,
      'closedAt', r.closed_at,
      'updatedAt', r.updated_at,
      'roundId', rd.id,
      'roundNumber', rd.round_number,
      'phase', rd.phase,
      'roundStatus', rd.status,
      'settlementStatus', rd.settlement_status,
      'dealerSeat', rd.dealer_seat,
      'currentTurnUserId', rd.current_turn_user_id,
      'currentTurnSeat', (select p.seat from dori_room_players p
                          where p.room_id = r.id and p.user_id = rd.current_turn_user_id),
      'pot', coalesce(rd.pot, 0),
      'raiseCount', rd.raise_count,
      'lastActionAt', (select max(a.created_at) from dori_actions a where a.round_id = rd.id),
      'leavePendingCount', (select count(*) from dori_room_players p
                            where p.room_id = r.id and p.leave_pending),
      'disconnectedCount', (select count(*) from dori_room_players p
                            where p.room_id = r.id and p.connection_status <> 'CONNECTED'),
      'stale', (rd.id is not null and rd.status = 'PLAYING'
                and coalesce((select max(a.created_at) from dori_actions a where a.round_id = rd.id),
                             rd.created_at) < now() - interval '5 minutes')
    ) x
    from dori_rooms r
    left join dori_rounds rd on rd.id = (
      select d.id from dori_rounds d where d.room_id = r.id order by d.round_number desc limit 1
    )
    where _include_closed or r.status <> 'CLOSED'
  ) t;
  return _rows;
end
$$;

create or replace function public.dori_admin_room_detail(_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _room jsonb; _round jsonb; _seats jsonb; _actions jsonb; _rid uuid;
begin
  if not is_admin(auth.uid()) then raise exception '권한이 없습니다.'; end if;

  select jsonb_build_object(
    'roomId', r.id, 'roomNumber', r.room_number, 'title', r.title, 'roomType', r.room_type,
    'status', r.status, 'ante', r.ante, 'minPoints', r.min_points, 'isPrivate', r.is_private,
    'carryPot', r.carry_pot, 'maxPlayers', r.max_players, 'lastDealerSeat', r.last_dealer_seat,
    'createdAt', r.created_at, 'closedAt', r.closed_at, 'closeReason', r.close_reason
  ), (select d.id from dori_rounds d where d.room_id = r.id order by d.round_number desc limit 1)
  into _room, _rid
  from dori_rooms r where r.id = _room_id;

  if _room is null then raise exception '방을 찾을 수 없습니다.'; end if;

  select jsonb_build_object(
    'roundId', d.id, 'roundNumber', d.round_number, 'status', d.status, 'phase', d.phase,
    'settlementStatus', d.settlement_status, 'dealerSeat', d.dealer_seat, 'pot', d.pot,
    'currentBet', d.current_bet, 'raiseCount', d.raise_count, 'ante', d.ante,
    'currentTurnUserId', d.current_turn_user_id, 'turnDeadline', d.turn_deadline,
    'winnerId', d.winner_id, 'createdAt', d.created_at
  ) into _round from dori_rounds d where d.id = _rid;

  -- 좌석 정보: 카드 코드/월 값은 절대 포함하지 않고 장수만 노출한다.
  select coalesce(jsonb_agg(jsonb_build_object(
    'seat', p.seat, 'userId', p.user_id, 'nickname', pr.nickname,
    'points', pr.game_points, 'isReady', p.is_ready, 'leavePending', p.leave_pending,
    'connectionStatus', p.connection_status, 'lastSeenAt', p.last_seen_at,
    'inRound', rp.user_id is not null, 'folded', coalesce(rp.is_folded, false),
    'isAllIn', coalesce(rp.is_all_in, false), 'acted', coalesce(rp.has_acted, false),
    'roundBet', coalesce(rp.round_bet, 0), 'contribution', coalesce(rp.contribution, 0),
    'makeStatus', rp.make_status, 'resultType', rp.result_type,
    'cardCount', (select count(*) from dori_cards c where c.round_id = _rid and c.user_id = p.user_id)
  ) order by p.seat), '[]'::jsonb) into _seats
  from dori_room_players p
  join profiles pr on pr.id = p.user_id
  left join dori_round_players rp on rp.round_id = _rid and rp.user_id = p.user_id
  where p.room_id = _room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'roundId', a.round_id, 'roundNumber', d.round_number,
    'seat', (select p.seat from dori_room_players p where p.room_id = _room_id and p.user_id = a.user_id),
    'nickname', pr.nickname, 'action', a.action_type, 'amount', a.amount,
    'bettingRound', a.betting_round, 'at', a.created_at
  ) order by a.created_at desc), '[]'::jsonb) into _actions
  from dori_actions a
  join dori_rounds d on d.id = a.round_id
  left join profiles pr on pr.id = a.user_id
  where d.room_id = _room_id
  order by a.created_at desc
  limit 60;

  return jsonb_build_object('room', _room, 'round', _round, 'seats', _seats, 'actions', _actions);
end
$$;

create or replace function public.dori_admin_safe_close(_room_id uuid, _force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _active int; _open int; _status text;
begin
  if not is_admin(auth.uid()) then raise exception '권한이 없습니다.'; end if;
  select status into _status from dori_rooms where id = _room_id;
  if _status is null then raise exception '방을 찾을 수 없습니다.'; end if;
  if _status = 'CLOSED' then
    return jsonb_build_object('ok', true, 'result', 'ALREADY_CLOSED');
  end if;

  select count(*) into _active from dori_room_players where room_id = _room_id;
  select count(*) into _open from dori_rounds
    where room_id = _room_id and (status = 'PLAYING' or settlement_status = 'PENDING');

  if _open > 0 and not _force then
    return jsonb_build_object('ok', false, 'result', 'ROUND_IN_PROGRESS', 'openRounds', _open);
  end if;
  if _active > 0 and not _force then
    return jsonb_build_object('ok', false, 'result', 'PLAYERS_SEATED', 'seated', _active);
  end if;
  if _open > 0 and _force then
    return jsonb_build_object('ok', false, 'result', 'ROUND_IN_PROGRESS', 'openRounds', _open);
  end if;

  delete from dori_room_players where room_id = _room_id;
  perform public.dori_cleanup_room(_room_id);
  update dori_rooms set status = 'CLOSED', closed_at = coalesce(closed_at, now()),
         close_reason = coalesce(close_reason, 'ADMIN_CLOSE'), current_round_id = null
    where id = _room_id;
  perform public.admin_log_event('DORI_ROOM_CLOSE', 'dori_room', _room_id::text,
          jsonb_build_object('seated', _active, 'force', _force));
  return jsonb_build_object('ok', true, 'result', 'CLOSED', 'seated', _active);
end
$$;

revoke all on function public.dori_admin_list_rooms(boolean) from public, anon;
revoke all on function public.dori_admin_room_detail(uuid) from public, anon;
revoke all on function public.dori_admin_safe_close(uuid, boolean) from public, anon;
grant execute on function public.dori_admin_list_rooms(boolean) to authenticated;
grant execute on function public.dori_admin_room_detail(uuid) to authenticated;
grant execute on function public.dori_admin_safe_close(uuid, boolean) to authenticated;