-- #100220 BUG 2/3/4: actionable_betting_count 가 "응답 의무가 남은 플레이어"를 무시해
-- 올인 직후 상대 응답 없이 street 가 종료되거나, 유일 actionable 플레이어의 액션이
-- '추가 베팅할 상대가 없습니다.' 로 거부되던 문제를 helper 단계에서 교정한다.
-- 정식 betting completion invariant(모든 non-fold/non-all-in 플레이어 acted + contribution 일치)와 동일하게 동작:
--   아직 응답 의무(acted=false 또는 stage 기여금 < current_bet)가 남아 있으면 >= 2 를 반환해
--   street 를 종료하지 않고 해당 플레이어에게 정상 턴/액션 기회를 준다.
--   응답이 끝나면 실제 actionable 수를 반환해 기존 자동 진행 로직이 그대로 동작한다.

CREATE OR REPLACE FUNCTION public.actionable_betting_count(_round_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (SELECT stage, current_bet FROM public.game_rounds WHERE id = _round_id),
  a AS (
    SELECT p.user_id, p.acted,
           COALESCE((SELECT sum(x.amount) FROM public.game_actions x
                      WHERE x.round_id = _round_id AND x.user_id = p.user_id
                        AND x.turn_number = (SELECT stage FROM r)), 0) AS staged
      FROM public.game_round_players p
     WHERE p.round_id = _round_id AND p.folded = false AND p.is_all_in = false
  )
  SELECT GREATEST(
    (SELECT count(*) FROM a)::int,
    CASE WHEN EXISTS (
      SELECT 1 FROM a
       WHERE a.acted = false
          OR a.staged < COALESCE((SELECT current_bet FROM r), 0)
    ) THEN 2 ELSE 0 END
  )
$$;

CREATE OR REPLACE FUNCTION public.dori_actionable_betting_count(_round_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (SELECT current_bet FROM public.dori_rounds WHERE id = _round_id),
  a AS (
    SELECT p.acted, p.round_bet
      FROM public.dori_round_players p
     WHERE p.round_id = _round_id AND p.folded = false AND p.is_all_in = false
  )
  SELECT GREATEST(
    (SELECT count(*) FROM a)::int,
    CASE WHEN EXISTS (
      SELECT 1 FROM a
       WHERE a.acted = false
          OR a.round_bet < COALESCE((SELECT current_bet FROM r), 0)
    ) THEN 2 ELSE 0 END
  )
$$;

REVOKE ALL ON FUNCTION public.actionable_betting_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dori_actionable_betting_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actionable_betting_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dori_actionable_betting_count(uuid) TO authenticated, service_role;
