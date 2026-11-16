-- 컬럼명 정정 (turn_deadline_at, folded, acted)
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
    'carryPot', d.carry_pot, 'currentBet', d.current_bet, 'raiseCount', d.raise_count,
    'ante', d.ante, 'currentTurnUserId', d.current_turn_user_id,
    'turnDeadlineAt', d.turn_deadline_at, 'lastActivityAt', d.last_activity_at,
    'winnerId', d.winner_id, 'createdAt', d.created_at, 'finishedAt', d.finished_at
  ) into _round from dori_rounds d where d.id = _rid;

  -- 좌석 정보: 카드 코드/월 값은 절대 포함하지 않고 장수만 노출한다.
  select coalesce(jsonb_agg(jsonb_build_object(
    'seat', p.seat, 'userId', p.user_id, 'nickname', pr.nickname,
    'points', pr.game_points, 'isReady', p.is_ready, 'leavePending', p.leave_pending,
    'connectionStatus', p.connection_status, 'lastSeenAt', p.last_seen_at,
    'missedTurnCount', p.missed_turn_count,
    'inRound', rp.user_id is not null, 'folded', coalesce(rp.folded, false),
    'isAllIn', coalesce(rp.is_all_in, false), 'acted', coalesce(rp.acted, false),
    'roundBet', coalesce(rp.round_bet, 0), 'contribution', coalesce(rp.contribution, 0),
    'makeStatus', rp.make_status, 'resultType', rp.result_type,
    'cardCount', (select count(*) from dori_cards c where c.round_id = _rid and c.user_id = p.user_id)
  ) order by p.seat), '[]'::jsonb) into _seats
  from dori_room_players p
  join profiles pr on pr.id = p.user_id
  left join dori_round_players rp on rp.round_id = _rid and rp.user_id = p.user_id
  where p.room_id = _room_id;

  select coalesce(jsonb_agg(a order by a->>'at' desc), '[]'::jsonb) into _actions from (
    select jsonb_build_object(
      'id', a.id, 'roundNumber', d.round_number,
      'seat', (select p.seat from dori_room_players p where p.room_id = _room_id and p.user_id = a.user_id),
      'nickname', pr.nickname, 'action', a.action_type, 'amount', a.amount,
      'bettingRound', a.betting_round, 'at', a.created_at
    ) a
    from dori_actions a
    join dori_rounds d on d.id = a.round_id
    left join profiles pr on pr.id = a.user_id
    where d.room_id = _room_id
    order by a.created_at desc
    limit 60
  ) t;

  return jsonb_build_object('room', _room, 'round', _round, 'seats', _seats, 'actions', _actions);
end
$$;

revoke all on function public.dori_admin_room_detail(uuid) from public, anon;
grant execute on function public.dori_admin_room_detail(uuid) to authenticated;