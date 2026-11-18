REVOKE EXECUTE ON FUNCTION public.process_leave_pending(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_empty_rooms() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_or_hold_room(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_round(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_leave_room(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_leave_room(uuid) FROM anon;