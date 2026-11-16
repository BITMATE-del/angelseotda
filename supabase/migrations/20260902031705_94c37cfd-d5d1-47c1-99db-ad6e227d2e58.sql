REVOKE EXECUTE ON FUNCTION public.cancel_leave_room(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_leave_room(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_leave_pending(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_empty_rooms() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.equip_item(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unequip_category(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_messages_guard() FROM anon, PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.cancel_leave_room(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_leave_room(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_leave_pending(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_empty_rooms() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.equip_item(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unequip_category(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_messages_guard() TO service_role;