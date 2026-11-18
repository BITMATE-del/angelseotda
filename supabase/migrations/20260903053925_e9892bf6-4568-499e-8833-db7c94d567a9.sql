revoke execute on function public.admin_critical_alerts(text) from anon;
revoke execute on function public.admin_service_readiness() from anon;
revoke execute on function public.admin_scan_integrity_findings() from anon;
revoke execute on function public.admin_list_integrity_findings(text,text) from anon;
revoke execute on function public.admin_set_finding_status(uuid,text,text) from anon;