-- 1) 회원 자기수정 가드: 클라이언트 직접 UPDATE만 차단 (서버 정의자 함수는 통과)
CREATE OR REPLACE FUNCTION public.profiles_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- 서버 함수(SECURITY DEFINER, 소유자 권한) 실행 컨텍스트는 통과
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF public.is_admin(auth.uid()) OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.username IS DISTINCT FROM OLD.username
     OR NEW.telegram_id IS DISTINCT FROM OLD.telegram_id
     OR NEW.wallet_address IS DISTINCT FROM OLD.wallet_address THEN
    RAISE EXCEPTION '아이디 · 텔레그램 아이디 · 지갑주소는 고객센터 문의로만 변경할 수 있습니다.';
  END IF;
  IF NEW.game_points IS DISTINCT FROM OLD.game_points
     OR NEW.locked_points IS DISTINCT FROM OLD.locked_points
     OR NEW.rank_points IS DISTINCT FROM OLD.rank_points
     OR NEW.rank IS DISTINCT FROM OLD.rank
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.referred_by_affiliate_id IS DISTINCT FROM OLD.referred_by_affiliate_id
     OR NEW.total_charge_amount IS DISTINCT FROM OLD.total_charge_amount
     OR NEW.total_charge_count IS DISTINCT FROM OLD.total_charge_count
     OR NEW.attendance_count IS DISTINCT FROM OLD.attendance_count THEN
    RAISE EXCEPTION '해당 항목은 변경할 수 없습니다.';
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) 신규 가입: 기본 포인트 0 + 가입 보상 10,000P (거래내역 기록, 중복 방지)
ALTER TABLE public.profiles ALTER COLUMN game_points SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  _username text := NULLIF(trim(COALESCE(_meta->>'username', '')), '');
  _code text := NULLIF(trim(COALESCE(_meta->>'signup_code', '')), '');
  _aff public.affiliates;
  _items jsonb;
  _reward bigint;
BEGIN
  IF _username IS NULL THEN
    _username := split_part(COALESCE(NEW.email, 'angel'), '@', 1);
  END IF;

  IF _code IS NOT NULL THEN
    SELECT * INTO _aff FROM public.affiliates
     WHERE upper(affiliate_code) = upper(_code) AND status = 'active';
  END IF;

  INSERT INTO public.profiles (id, email, username, nickname, telegram_id, wallet_address,
                               signup_code_used, referred_by_affiliate_id, game_points)
  VALUES (NEW.id, NEW.email, _username,
          COALESCE(NULLIF(trim(COALESCE(_meta->>'nickname','')), ''), _username),
          NULLIF(trim(COALESCE(_meta->>'telegram_id','')), ''),
          NULLIF(trim(COALESCE(_meta->>'wallet_address','')), ''),
          _code, _aff.id, 0)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  IF _aff.id IS NOT NULL THEN
    INSERT INTO public.affiliate_members (affiliate_id, member_user_id)
    VALUES (_aff.id, NEW.id) ON CONFLICT (member_user_id) DO NOTHING;
  END IF;

  -- 언랭크(가입) 보상: 포인트 + 계급 전용 아이템, 중복 지급 방지
  SELECT points_reward INTO _reward FROM public.rank_requirements WHERE rank = 'UNRANKED';
  _reward := COALESCE(_reward, 10000);

  INSERT INTO public.user_items (user_id, item_id, source_type, source_rank)
  SELECT NEW.id, i.id, 'RANK_REWARD', 'UNRANKED' FROM public.items i
   WHERE i.rank_required = 'UNRANKED' AND i.enabled = true
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category)), '[]'::jsonb)
    INTO _items FROM public.items i WHERE i.rank_required = 'UNRANKED' AND i.enabled = true;

  INSERT INTO public.rank_reward_claims (user_id, rank, points_reward, items_reward)
  VALUES (NEW.id, 'UNRANKED', _reward, COALESCE(_items, '[]'::jsonb))
  ON CONFLICT (user_id, rank) DO NOTHING;

  IF FOUND THEN
    PERFORM public.grant_points_internal(NEW.id, _reward, 'rank_reward', '언랭크 가입 보상', 'rank', NULL, NULL);
  END IF;

  RETURN NEW;
END;
$function$;