INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::app_role FROM public.profiles WHERE username = 'angeladmin'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.admin_logs (admin_id, action, target_type, target_id, reason, metadata)
SELECT id, 'ROLE_CHANGED', 'user', id, '초기 최고관리자 지정', jsonb_build_object('role', 'super_admin', 'via', 'initial_setup')
FROM public.profiles WHERE username = 'angeladmin';