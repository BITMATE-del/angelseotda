drop function if exists public.admin_critical_alerts();
revoke all on function public.admin_critical_alerts(text) from public;
grant execute on function public.admin_critical_alerts(text) to authenticated;