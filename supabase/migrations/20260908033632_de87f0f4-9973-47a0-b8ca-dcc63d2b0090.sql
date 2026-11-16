alter function public.dori_hwang() set search_path = public;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'dori\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('dori_advance','dori_settle_round','dori_cleanup_room') then
      continue;
    end if;
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;