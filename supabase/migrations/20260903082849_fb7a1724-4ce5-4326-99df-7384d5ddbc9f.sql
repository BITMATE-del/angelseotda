REVOKE ALL ON FUNCTION public.angel_finalize_empty_room(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.angel_auto_cleanup_room_on_seat_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.angel_finalize_empty_room(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.angel_auto_cleanup_room_on_seat_change() TO service_role;