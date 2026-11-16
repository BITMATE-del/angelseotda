-- 이전 마이그레이션에서 변경된 응답 필드 구성을 원본대로 복구하고,
-- 짓기 진행 중 상대 완료 여부 마스킹만 유지한다.
CREATE OR REPLACE FUNCTION public.dori_room_state(_room_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid(); _room public.dori_rooms; _r public.dori_rounds;
  _seats jsonb; _mine jsonb; _actions jsonb; _vis int; _mode text; _mysubmit boolean;
  _making boolean;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _room from public.dori_rooms where id = _room_id;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;
  select * into _r from public.dori_rounds where room_id = _room_id order by round_number desc limit 1;
  _vis := case when _r.id is null then 0 else public.dori_visible_cards(_r.phase) end;
  _mode := case when _r.id is null then 'HIDDEN' else public.dori_reveal_mode(_r.id) end;
  -- 짓기 진행 중에는 상대의 완료 여부(황 자동완료 포함)를 내려보내지 않는다.
  _making := _r.id is not null and _r.status = 'PLAYING' and _r.phase = 'MAKE_SELECTION';

  select coalesce(jsonb_agg(x order by x->>'seat'),'[]'::jsonb) into _seats from (
    select jsonb_build_object(
      'seat', p.seat,
      'userId', p.user_id,
      'nickname', pr.nickname,
      'rank', pr.rank,
      'level', pr.level,
      'avatarUrl', pr.avatar_url,
      'characterUrl', public.equipped_item_asset(p.user_id, 'character'),
      'title', public.equipped_item_asset(p.user_id, 'title'),
      'points', pr.game_points,
      'isMe', p.user_id = _uid,
      'isReady', p.is_ready,
      'leavePending', p.leave_pending,
      'connection', p.connection_status,
      'absenceMisses', coalesce(p.absence_miss_count,0),
      'longAbsence', coalesce(p.long_absence,false),
      'inRound', rp.id is not null,
      'folded', coalesce(rp.folded,false),
      'isAllIn', coalesce(rp.is_all_in,false),
      'acted', coalesce(rp.acted,false),
      'roundBet', coalesce(rp.round_bet,0),
      'contribution', coalesce(rp.contribution,0),
      'makeStatus', case
          when p.user_id = _uid then rp.make_status
          when rp.id is null then null
          when public.dori_seat_revealed(_mode, rp.folded, rp.result_type) then rp.make_status
          when rp.make_status is null then null
          when _making then 'PENDING'
          when rp.make_status = 'PENDING' then 'PENDING'
          else 'SUBMITTED' end,
      'resultType', rp.result_type,
      'cardCount', (select count(*) from public.dori_cards c
                     where c.round_id = _r.id and c.user_id = p.user_id and c.deal_order <= _vis),
      'revealed', p.user_id <> _uid and public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type),
      'cards', case when p.user_id <> _uid
                     and public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then (select to_jsonb(array_agg(c.card_code order by c.deal_order))
                from public.dori_cards c where c.round_id = _r.id and c.user_id = p.user_id)
        else null end,
      'handLabel', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then rp.hand_label else null end,
      'handRank', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then rp.hand_rank else null end,
      'makeTotal', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type)
        then rp.make_total else null end,
      'selectedCards', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type) then
          (select to_jsonb(s.selected_card_ids) from public.dori_hand_submissions s
            where s.round_id = _r.id and s.user_id = p.user_id order by s.created_at desc limit 1)
        else null end,
      'remainingCards', case when p.user_id = _uid or public.dori_seat_revealed(_mode, coalesce(rp.folded,true), rp.result_type) then
          (select to_jsonb(s.remaining_card_ids) from public.dori_hand_submissions s
            where s.round_id = _r.id and s.user_id = p.user_id order by s.created_at desc limit 1)
        else null end
    ) as x
    from public.dori_room_players p
    join public.profiles pr on pr.id = p.user_id
    left join public.dori_round_players rp on rp.round_id = _r.id and rp.user_id = p.user_id
    where p.room_id = _room_id
  ) t;

  _mine := case when _r.id is not null and _r.status = 'PLAYING'
    then public.dori_my_cards(_room_id) else jsonb_build_object('cards','[]'::jsonb,'options','[]'::jsonb) end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.action_id, 'userId', a.user_id, 'type', a.action_type,
      'amount', a.amount, 'bettingRound', a.betting_round, 'at', a.created_at)
      order by a.created_at),'[]'::jsonb) into _actions
    from (select a.id as action_id, a.user_id, a.action_type, a.amount, a.betting_round, a.created_at
            from public.dori_actions a where a.round_id = _r.id) a;

  _mysubmit := _r.id is not null and _r.status = 'FINISHED' and _r.settlement_status <> 'PENDING'
    and _r.reveal_choice = 'PENDING' and _r.winner_id = _uid
    and (select count(*) from public.dori_round_players where round_id = _r.id and folded = false) < 2;

  return jsonb_build_object(
    'room', jsonb_build_object('id',_room.id,'roomNumber',_room.room_number,'title',_room.title,
      'roomType',_room.room_type,
      'ante',_room.ante,'minPoints',_room.min_points,'status',_room.status,'maxPlayers',_room.max_players,
      'isPrivate',_room.is_private,'carryPot',_room.carry_pot,
      'readyRequired', _room.last_dealer_seat is null,
      'lastDealerSeat', _room.last_dealer_seat),
    'round', case when _r.id is null then null else jsonb_build_object(
      'roundId',_r.id,'roundNumber',_r.round_number,'status',_r.status,'phase',_r.phase,
      'dealerSeat',_r.dealer_seat,'pot',_r.pot,'currentBet',_r.current_bet,'raiseCount',0,
      'ante',_r.ante,'turnUserId',_r.current_turn_user_id,'turnDeadline',_r.turn_deadline_at,
      'winnerId',_r.winner_id,'settlementStatus',_r.settlement_status,
      'rematchReason',_r.rematch_reason,
      'revealMode', _mode, 'revealChoice', _r.reveal_choice,
      'canChooseReveal', coalesce(_mysubmit,false)) end,
    'seats', _seats,
    'myCards', _mine->'cards',
    'makeOptions', _mine->'options',
    'actionOptions', public.dori_action_options(_room_id),
    'actions', _actions);
end $function$;