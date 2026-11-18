-- =========================================================
-- ANGEL SUTDA : 주간 랭킹 + 계급 + 계급 전용 아이템/이펙트
-- 기존 충전 7% / 출금 0% 정책과 게임/총판 로직은 변경하지 않는다.
-- =========================================================

CREATE TYPE public.app_rank AS ENUM ('UNRANKED','BRONZE','SILVER','GOLD','DIAMOND','CHALLENGER');

-- ---------- 1. 주간 시즌 ----------
CREATE TABLE public.weekly_ranking_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key text NOT NULL UNIQUE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  total_charge_amount numeric NOT NULL DEFAULT 0,
  deposit_participants integer NOT NULL DEFAULT 0,
  gwang_participants integer NOT NULL DEFAULT 0,
  profit_participants integer NOT NULL DEFAULT 0,
  reward_rate numeric NOT NULL DEFAULT 0.01,
  finalized_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.weekly_ranking_seasons TO authenticated, anon;
GRANT ALL ON public.weekly_ranking_seasons TO service_role;
ALTER TABLE public.weekly_ranking_seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "시즌 조회는 누구나" ON public.weekly_ranking_seasons FOR SELECT USING (true);
CREATE TRIGGER weekly_seasons_updated_at BEFORE UPDATE ON public.weekly_ranking_seasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 2. 주간 랭킹 스냅샷 ----------
CREATE TABLE public.weekly_deposit_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.weekly_ranking_seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  charge_amount numeric NOT NULL DEFAULT 0,
  withdraw_amount numeric NOT NULL DEFAULT 0,
  net_deposit numeric NOT NULL DEFAULT 0,
  charge_count integer NOT NULL DEFAULT 0,
  rank_position integer,
  last_event_at timestamptz,
  UNIQUE (season_id, user_id)
);
CREATE TABLE public.weekly_gwang_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.weekly_ranking_seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  gwang38_wins integer NOT NULL DEFAULT 0,
  gwang18_wins integer NOT NULL DEFAULT 0,
  gwang13_wins integer NOT NULL DEFAULT 0,
  total_gwang_wins integer NOT NULL DEFAULT 0,
  games_played integer NOT NULL DEFAULT 0,
  rank_position integer,
  last_gwang_at timestamptz,
  UNIQUE (season_id, user_id)
);
CREATE TABLE public.weekly_profit_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.weekly_ranking_seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  win_points bigint NOT NULL DEFAULT 0,
  win_count integer NOT NULL DEFAULT 0,
  games_played integer NOT NULL DEFAULT 0,
  rank_position integer,
  last_win_at timestamptz,
  UNIQUE (season_id, user_id)
);
GRANT SELECT ON public.weekly_deposit_stats, public.weekly_gwang_stats, public.weekly_profit_stats TO authenticated;
GRANT ALL ON public.weekly_deposit_stats, public.weekly_gwang_stats, public.weekly_profit_stats TO service_role;
ALTER TABLE public.weekly_deposit_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_gwang_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_profit_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "입금 스냅샷 조회" ON public.weekly_deposit_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "광땡 스냅샷 조회" ON public.weekly_gwang_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "수익 스냅샷 조회" ON public.weekly_profit_stats FOR SELECT TO authenticated USING (true);

-- ---------- 3. 랭킹 상금 (중복 지급 금지) ----------
CREATE TABLE public.ranking_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.weekly_ranking_seasons(id) ON DELETE CASCADE,
  ranking_type text NOT NULL,
  user_id uuid NOT NULL,
  rank_position integer NOT NULL,
  reward_type text NOT NULL,
  reward_amount numeric NOT NULL DEFAULT 0,
  reward_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PAID',
  paid_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, ranking_type, rank_position)
);
GRANT SELECT ON public.ranking_rewards TO authenticated;
GRANT ALL ON public.ranking_rewards TO service_role;
ALTER TABLE public.ranking_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "상금 내역 조회" ON public.ranking_rewards FOR SELECT TO authenticated USING (true);

-- ---------- 4. 계급 ----------
ALTER TABLE public.profiles
  ADD COLUMN rank public.app_rank NOT NULL DEFAULT 'UNRANKED',
  ADD COLUMN total_charge_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN total_charge_count integer NOT NULL DEFAULT 0,
  ADD COLUMN attendance_count integer NOT NULL DEFAULT 0;

CREATE TABLE public.rank_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rank public.app_rank NOT NULL,
  points_reward bigint NOT NULL DEFAULT 0,
  items_reward jsonb NOT NULL DEFAULT '[]'::jsonb,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rank)
);
CREATE TABLE public.rank_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  from_rank public.app_rank NOT NULL,
  to_rank public.app_rank NOT NULL,
  charge_amount_at numeric NOT NULL DEFAULT 0,
  charge_count_at integer NOT NULL DEFAULT 0,
  attendance_at integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  attend_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, attend_date)
);
GRANT SELECT ON public.rank_reward_claims, public.rank_promotions, public.user_attendance TO authenticated;
GRANT ALL ON public.rank_reward_claims, public.rank_promotions, public.user_attendance TO service_role;
ALTER TABLE public.rank_reward_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rank_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "계급 보상 본인/관리자" ON public.rank_reward_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "승급 이력 본인/관리자" ON public.rank_promotions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "출석 본인/관리자" ON public.user_attendance FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- ---------- 5. 충전 레이크 면제권 ----------
CREATE TABLE public.rake_free_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'RANKING_REWARD',
  source_ref uuid,
  status text NOT NULL DEFAULT 'ISSUED',
  charge_request_id uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  reserved_at timestamptz,
  used_at timestamptz
);
CREATE UNIQUE INDEX rake_ticket_one_charge ON public.rake_free_tickets(charge_request_id)
  WHERE charge_request_id IS NOT NULL;
GRANT SELECT ON public.rake_free_tickets TO authenticated;
GRANT ALL ON public.rake_free_tickets TO service_role;
ALTER TABLE public.rake_free_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "면제권 본인/관리자" ON public.rake_free_tickets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

ALTER TABLE public.charge_requests
  ADD COLUMN rake_free_ticket_used boolean NOT NULL DEFAULT false,
  ADD COLUMN rake_free_ticket_id uuid;

-- ---------- 6. 아이템 확장 (계급 전용 / 판매 금지) ----------
ALTER TABLE public.items
  ADD COLUMN for_sale boolean NOT NULL DEFAULT true,
  ADD COLUMN source_type text NOT NULL DEFAULT 'SHOP',
  ADD COLUMN rank_required public.app_rank,
  ADD COLUMN effect_key text;

ALTER TABLE public.user_items
  ADD COLUMN source_type text NOT NULL DEFAULT 'SHOP',
  ADD COLUMN source_rank public.app_rank,
  ADD COLUMN equipped_at timestamptz;

-- 계급 전용 아이템은 상점 구매 금지
CREATE OR REPLACE FUNCTION public.purchase_item(_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _price bigint; _balance bigint; _for_sale boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT price, for_sale INTO _price, _for_sale FROM items WHERE id = _item_id AND enabled = true;
  IF _price IS NULL THEN RAISE EXCEPTION '판매 중인 아이템이 아닙니다.'; END IF;
  IF NOT _for_sale THEN RAISE EXCEPTION '계급 전용 아이템은 구매할 수 없습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM user_items WHERE user_id = _uid AND item_id = _item_id) THEN
    RAISE EXCEPTION '이미 보유한 아이템입니다.'; END IF;
  UPDATE profiles SET game_points = game_points - _price
   WHERE id = _uid AND game_points - locked_points >= _price RETURNING game_points INTO _balance;
  IF _balance IS NULL THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;
  INSERT INTO user_items (user_id, item_id, source_type) VALUES (_uid, _item_id, 'SHOP');
  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, memo)
  SELECT _uid, 'item_purchase', -_price, _balance + _price, _balance, p.locked_points, p.locked_points, 'item', _item_id, '상점 아이템 구매'
    FROM profiles p WHERE p.id = _uid;
END; $$;
REVOKE ALL ON FUNCTION public.purchase_item(uuid) FROM anon;

-- ---------- 7. 이펙트 ON/OFF 설정 ----------
CREATE TABLE public.user_effect_settings (
  user_id uuid PRIMARY KEY,
  entry_effect boolean NOT NULL DEFAULT true,
  win_effect boolean NOT NULL DEFAULT true,
  showdown_effect boolean NOT NULL DEFAULT true,
  name_effect boolean NOT NULL DEFAULT true,
  reduce_others boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_effect_settings TO authenticated;
GRANT ALL ON public.user_effect_settings TO service_role;
ALTER TABLE public.user_effect_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "이펙트 설정 본인" ON public.user_effect_settings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "이펙트 설정 생성" ON public.user_effect_settings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "이펙트 설정 수정" ON public.user_effect_settings FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER user_effect_settings_updated_at BEFORE UPDATE ON public.user_effect_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();