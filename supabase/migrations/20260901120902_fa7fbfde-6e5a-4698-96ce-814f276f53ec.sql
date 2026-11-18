REVOKE ALL ON FUNCTION public.close_or_hold_room(uuid) FROM authenticated, anon, public;
REVOKE ALL ON FUNCTION public.equipped_item_asset(uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.room_table_state(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.equipped_item_asset(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.room_table_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_or_hold_room(uuid) TO service_role;
