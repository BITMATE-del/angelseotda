CREATE OR REPLACE FUNCTION public.dori_room_state(_room_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  _uid uuid := auth.uid(); _room public.dori_rooms; _r public.dori_rounds;
  _seats jsonb; _mine jsonb; _actions jsonb; _showdown boolean; _vis int;
begin
  if _uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into _room from public.dori_rooms where id = _room_id;
  if _room.id is null then raise exception 'DORI_ROOM_NOT_FOUND'; end if;
  select * into _r from public.dori_rounds where room_id = _room_id order by round_number desc limit 1;
  _showdown := _r.id is not null and _r.phase in ('SHOWDOWN','FINISHED');
  _vis := case when _r.id is null then 0 else public.dori_visible_cards(_r.phase) end;

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
      'inRound', rp.id is not null,
      'folded', coalesce(rp.folded,false),
      'isAllIn', coalesce(rp.is_all_in,false),
      'acted', coalesce(rp.acted,false),
      'roundBet', coalesce(rp.round_bet,0),
      'contribution', coalesce(rp.contribution,0),
      'makeStatus', case when _showdown or p.user_id = _uid then rp.make_status
                         when rp.id is null then null
                         when rp.make_status is null then null
                         when rp.make_status = 'PENDING' then 'PENDING'
                         else 'SUBMITTED' end,
      'resultType', rp.result_type,
      'cardCount', (select count(*) from public.dori_cards c
                     where c.round_id = _r.id and c.user_id = p.user_id and c.deal_order <= _vis),
      'handLabel', case when _showdown then rp.hand_label else null end,
      'handRank', case when _showdown then rp.hand_rank else null end,
      'makeTotal', case when _showdown then rp.make_total else null end,
      'selectedCards', case when _showdown or p.user_id = _uid then
          (select to_jsonb(s.selected_card_ids) from public.dori_hand_submissions s
            where s.round_id = _r.id and s.user_id = p.user_id order by s.created_at desc limit 1)
        else null end,
      'remainingCards', case when _showdown or p.user_id = _uid then
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
    from public.dori_actions a where a.round_id = _r.id;

  return jsonb_build_object(
    'room', jsonb_build_object('id',_room.id,'roomNumber',_room.room_number,'title',_room.title,
      'roomType',_room.room_type,
      'ante',_room.ante,'minPoints',_room.min_points,'status',_room.status,'maxPlayers',_room.max_players,
      'isPrivate',_room.is_private,'carryPot',_room.carry_pot,
      'readyRequired', _room.last_dealer_seat is null,
      'lastDealerSeat', _room.last_dealer_seat),
    'round', case when _r.id is null then null else jsonb_build_object(
      'roundId',_r.id,'roundNumber',_r.round_number,'status',_r.status,'phase',_r.phase,
      'dealerSeat',_r.dealer_seat,'pot',_r.pot,'currentBet',_r.current_bet,'raiseCount',_r.raise_count,
      'ante',_r.ante,'turnUserId',_r.current_turn_user_id,'turnDeadline',_r.turn_deadline_at,
      'winnerId',_r.winner_id,'settlementStatus',_r.settlement_status) end,
    'seats', _seats,
    'myCards', _mine->'cards',
    'makeOptions', _mine->'options',
    'actions', _actions);
end $function$;

CREATE TABLE IF NOT EXISTS public.dori_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.dori_rooms(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text,
  message text NOT NULL,
  kind text NOT NULL DEFAULT 'chat',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dori_chat_messages_room_idx
  ON public.dori_chat_messages (room_id, created_at DESC);

GRANT SELECT, INSERT ON public.dori_chat_messages TO authenticated;
GRANT ALL ON public.dori_chat_messages TO service_role;
ALTER TABLE public.dori_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dori_chat_read ON public.dori_chat_messages;
CREATE POLICY dori_chat_read ON public.dori_chat_messages
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS dori_chat_insert ON public.dori_chat_messages;
CREATE POLICY dori_chat_insert ON public.dori_chat_messages
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS dori_chat_guard_trg ON public.dori_chat_messages;
CREATE TRIGGER dori_chat_guard_trg BEFORE INSERT ON public.dori_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_guard();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dori_chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;