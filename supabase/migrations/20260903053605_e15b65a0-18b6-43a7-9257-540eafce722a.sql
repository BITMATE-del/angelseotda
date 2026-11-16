create table if not exists public.integrity_findings (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  scope text not null default 'OPERATION',
  subject_type text not null,
  subject_id uuid,
  subject_label text,
  status text not null default 'OPEN',
  detail jsonb not null default '{}'::jsonb,
  reason text,
  occurred_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint integrity_findings_status_chk check (status in ('OPEN','RESOLVED','IGNORED_TEST')),
  constraint integrity_findings_scope_chk check (scope in ('OPERATION','TEST'))
);
create unique index if not exists integrity_findings_uniq on public.integrity_findings(code, subject_type, coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid));

grant select on public.integrity_findings to authenticated;
grant all on public.integrity_findings to service_role;
alter table public.integrity_findings enable row level security;

drop policy if exists "admins read findings" on public.integrity_findings;
create policy "admins read findings" on public.integrity_findings
  for select to authenticated using (public.is_admin(auth.uid()));