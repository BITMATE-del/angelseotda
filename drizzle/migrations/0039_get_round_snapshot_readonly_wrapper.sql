-- 라운드 상태 + 내 카드를 한 번의 왕복으로 조회하는 읽기 전용 래퍼.
-- 기존 get_round_state / get_my_cards 를 그대로 호출만 하며 마스킹/권한 규칙은 변경하지 않는다.
create or replace function public.get_round_snapshot(_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_state jsonb;
  v_cards jsonb;
begin
  v_state := public.get_round_state(_round_id);
  if v_state is null then
    return null;
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('card_code', c.card_code, 'card_order', c.card_order)
                     order by c.card_order),
           '[]'::jsonb)
    into v_cards
    from public.get_my_cards(_round_id) c;

  return jsonb_build_object('state', v_state, 'myCards', coalesce(v_cards, '[]'::jsonb));
end;
$$;

revoke all on function public.get_round_snapshot(uuid) from public;
grant execute on function public.get_round_snapshot(uuid) to authenticated;