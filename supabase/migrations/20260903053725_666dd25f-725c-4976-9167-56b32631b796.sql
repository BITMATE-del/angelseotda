-- 신규 관리자 함수의 공개 실행 권한 제거 (비로그인 접근 차단)
revoke all on function public.admin_scan_integrity_findings() from public;
revoke all on function public.admin_list_integrity_findings(text,text) from public;
revoke all on function public.admin_set_finding_status(uuid,text,text) from public;
grant execute on function public.admin_scan_integrity_findings() to authenticated;
grant execute on function public.admin_list_integrity_findings(text,text) to authenticated;
grant execute on function public.admin_set_finding_status(uuid,text,text) to authenticated;