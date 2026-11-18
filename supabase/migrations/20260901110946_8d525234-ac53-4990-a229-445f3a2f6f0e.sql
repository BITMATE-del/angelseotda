REVOKE EXECUTE ON FUNCTION public.start_game_round(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_my_cards(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_round_state(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.place_bet_action(uuid, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.select_final_hand(uuid, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.enforce_turn_timeout(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.settle_round(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.game_take_bet(uuid, bigint, uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.start_game_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_cards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_round_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bet_action(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.select_final_hand(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_turn_timeout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_round(uuid) TO authenticated;