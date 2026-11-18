-- 1) 다른 회원이 읽을 수 있는 컬럼을 권한 수준에서 제한한다 (RLS 로 컬럼은 못 가리므로 column-level GRANT 사용)
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, nickname, avatar_url, level, exp, game_points, locked_points, rank_points,
  wins, losses, gwangttaeng_count, current_streak, max_streak, status,
  created_at, last_seen_at, username, referred_by_affiliate_id, rank,
  total_charge_amount, total_charge_count, attendance_count, is_test_user,
  suspended_until, chat_banned_until
) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 2) 본인 전체 프로필 조회 전용 함수 (민감 정보 포함, 본인만)
CREATE OR REPLACE FUNCTION public.my_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.* FROM public.profiles p WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_profile() TO authenticated;