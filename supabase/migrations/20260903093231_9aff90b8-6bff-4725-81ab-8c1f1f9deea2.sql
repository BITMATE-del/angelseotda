create table if not exists public.signup_failure_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stage text not null,
  error_code text,
  error_message text,
  username text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists signup_failure_logs_created_idx on public.signup_failure_logs (created_at desc);
grant all on public.signup_failure_logs to service_role;
grant select on public.signup_failure_logs to authenticated;
alter table public.signup_failure_logs enable row level security;
drop policy if exists "admin read signup failures" on public.signup_failure_logs;
create policy "admin read signup failures" on public.signup_failure_logs
  for select to authenticated
  using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'));