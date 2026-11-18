REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_round(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_withdrawal(bigint, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.purchase_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_adjust_points(uuid, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_process_charge(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_process_withdrawal(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(bigint, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_points(uuid, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_charge(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_withdrawal(uuid, text, text) TO authenticated;