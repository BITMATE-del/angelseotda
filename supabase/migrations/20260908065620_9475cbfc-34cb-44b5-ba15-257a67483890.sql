create or replace function public.dori_my_active_room()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
           'roomId', r.id,
           'roomNumber', r.room_number,
           'title', r.title,
           'ante', r.ante,
           'seat', p.seat,
           'status', r.status,
           'leavePending', p.leave_pending
         )
    into v
    from public.dori_room_players p
    join public.dori_rooms r on r.id = p.room_id
   where p.user_id = v_uid
     and r.status <> 'CLOSED'
   order by p.joined_at desc
   limit 1;

  return v;
end;
$$;

revoke all on function public.dori_my_active_room() from public;
grant execute on function public.dori_my_active_room() to authenticated;