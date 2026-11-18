CREATE TABLE public.rare_item_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  bidder_user_id uuid NOT NULL,
  offer_amount bigint NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  responded_at timestamptz,
  CONSTRAINT rare_item_offers_status_chk CHECK (status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')),
  CONSTRAINT rare_item_offers_amount_chk CHECK (offer_amount >= 1)
);

CREATE UNIQUE INDEX rare_item_offers_one_pending
  ON public.rare_item_offers (item_id, bidder_user_id)
  WHERE status = 'PENDING';
CREATE INDEX rare_item_offers_owner_idx ON public.rare_item_offers (owner_user_id, status);
CREATE INDEX rare_item_offers_bidder_idx ON public.rare_item_offers (bidder_user_id, status);

GRANT SELECT ON public.rare_item_offers TO authenticated;
GRANT ALL ON public.rare_item_offers TO service_role;

ALTER TABLE public.rare_item_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bidder or owner can read own offers"
  ON public.rare_item_offers FOR SELECT TO authenticated
  USING (auth.uid() = bidder_user_id OR auth.uid() = owner_user_id);

CREATE TRIGGER rare_item_offers_updated_at
  BEFORE UPDATE ON public.rare_item_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 현재 RARE 상품 소유 상태 (개인정보 없이 닉네임/본인여부만)
CREATE OR REPLACE FUNCTION public.rare_item_owners()
RETURNS TABLE (item_id uuid, owner_nickname text, owner_is_me boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ui.item_id,
         p.nickname,
         ui.user_id = auth.uid()
    FROM public.user_items ui
    JOIN public.items it ON it.id = ui.item_id
    LEFT JOIN public.profiles p ON p.id = ui.user_id
   WHERE it.rarity = 'RARE'
     AND (ui.expires_at IS NULL OR ui.expires_at > now())
$$;

GRANT EXECUTE ON FUNCTION public.rare_item_owners() TO authenticated, anon;

-- 만료 처리
CREATE OR REPLACE FUNCTION public.expire_rare_item_offers()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.rare_item_offers
     SET status = 'EXPIRED', updated_at = now()
   WHERE status = 'PENDING' AND expires_at <= now();
$$;

GRANT EXECUTE ON FUNCTION public.expire_rare_item_offers() TO authenticated;

-- 입찰 신청 (포인트 차감/잠금 없음)
CREATE OR REPLACE FUNCTION public.create_rare_offer(_item_id uuid, _offer_amount bigint, _message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _rarity text; _name text; _enabled boolean;
  _owner uuid; _avail bigint; _recent int; _last_cancel timestamptz; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_rare_item_offers();

  SELECT rarity, name, enabled INTO _rarity, _name, _enabled FROM public.items WHERE id = _item_id;
  IF _name IS NULL OR _enabled IS NOT TRUE THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.'; END IF;
  IF _rarity <> 'RARE' THEN RAISE EXCEPTION 'RARE 상품에만 입찰할 수 있습니다.'; END IF;

  SELECT ui.user_id INTO _owner
    FROM public.user_items ui
   WHERE ui.item_id = _item_id AND (ui.expires_at IS NULL OR ui.expires_at > now())
   ORDER BY ui.acquired_at DESC LIMIT 1;
  IF _owner IS NULL THEN RAISE EXCEPTION '아직 보유자가 없는 상품입니다. 바로 구매할 수 있습니다.'; END IF;
  IF _owner = _uid THEN RAISE EXCEPTION '본인이 보유한 상품에는 입찰할 수 없습니다.'; END IF;

  IF _offer_amount IS NULL OR _offer_amount < 1 THEN RAISE EXCEPTION '입찰 금액은 1P 이상이어야 합니다.'; END IF;
  SELECT game_points - locked_points INTO _avail FROM public.profiles WHERE id = _uid;
  IF _avail IS NULL OR _offer_amount > _avail THEN
    RAISE EXCEPTION '보유 포인트를 초과하는 금액은 입찰할 수 없습니다.'; END IF;

  IF EXISTS (SELECT 1 FROM public.rare_item_offers
              WHERE item_id = _item_id AND bidder_user_id = _uid AND status = 'PENDING') THEN
    RAISE EXCEPTION '이미 이 상품에 입찰을 신청했습니다.'; END IF;

  SELECT max(updated_at) INTO _last_cancel FROM public.rare_item_offers
   WHERE item_id = _item_id AND bidder_user_id = _uid AND status = 'CANCELLED';
  IF _last_cancel IS NOT NULL AND _last_cancel > now() - interval '60 seconds' THEN
    RAISE EXCEPTION '취소 후 60초가 지난 뒤에 다시 신청할 수 있습니다.'; END IF;

  SELECT count(*) INTO _recent FROM public.rare_item_offers
   WHERE bidder_user_id = _uid AND created_at > now() - interval '1 hour';
  IF _recent >= 5 THEN RAISE EXCEPTION '입찰 신청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'; END IF;

  INSERT INTO public.rare_item_offers (item_id, owner_user_id, bidder_user_id, offer_amount, message)
  VALUES (_item_id, _owner, _uid, _offer_amount, NULLIF(btrim(COALESCE(_message,'')), ''))
  RETURNING id INTO _id;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (_owner, 'rare_offer', 'RARE 상품 입찰 도착',
    format('보유 중인 [%s] 상품에 %sP 입찰이 도착했습니다.', _name, to_char(_offer_amount, 'FM999,999,999,999')));

  RETURN _id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_rare_offer(uuid, bigint, text) TO authenticated;

-- 입찰 취소 (입찰자)
CREATE OR REPLACE FUNCTION public.cancel_rare_offer(_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _rows int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  UPDATE public.rare_item_offers
     SET status = 'CANCELLED', updated_at = now()
   WHERE id = _offer_id AND bidder_user_id = _uid AND status = 'PENDING';
  GET DIAGNOSTICS _rows = ROW_COUNT;
  IF _rows = 0 THEN RAISE EXCEPTION '취소할 수 있는 입찰이 아닙니다.'; END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_rare_offer(uuid) TO authenticated;

-- 보유자 응답 (관심 있음 / 거절) — 소유권 이전은 하지 않는다
CREATE OR REPLACE FUNCTION public.respond_rare_offer(_offer_id uuid, _decision text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _item uuid; _bidder uuid; _amount bigint; _name text; _current_owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  IF _decision NOT IN ('ACCEPTED','DECLINED') THEN RAISE EXCEPTION '잘못된 요청입니다.'; END IF;

  SELECT o.item_id, o.bidder_user_id, o.offer_amount INTO _item, _bidder, _amount
    FROM public.rare_item_offers o
   WHERE o.id = _offer_id AND o.owner_user_id = _uid AND o.status = 'PENDING'
   FOR UPDATE;
  IF _item IS NULL THEN RAISE EXCEPTION '처리할 수 있는 입찰이 아닙니다.'; END IF;

  SELECT ui.user_id INTO _current_owner FROM public.user_items ui
   WHERE ui.item_id = _item AND (ui.expires_at IS NULL OR ui.expires_at > now())
   ORDER BY ui.acquired_at DESC LIMIT 1;
  IF _current_owner IS DISTINCT FROM _uid THEN
    UPDATE public.rare_item_offers SET status = 'EXPIRED', updated_at = now(), responded_at = now()
     WHERE id = _offer_id;
    RAISE EXCEPTION 'STALE_OWNER: 상품 보유자가 변경되어 처리할 수 없습니다.';
  END IF;

  SELECT name INTO _name FROM public.items WHERE id = _item;

  UPDATE public.rare_item_offers
     SET status = _decision, responded_at = now(), updated_at = now()
   WHERE id = _offer_id;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (_bidder, 'rare_offer',
    CASE WHEN _decision = 'ACCEPTED' THEN '입찰에 관심 표시' ELSE '입찰이 거절되었습니다' END,
    format('[%s] 상품 %sP 입찰이 %s 처리되었습니다.', _name,
           to_char(_amount, 'FM999,999,999,999'),
           CASE WHEN _decision = 'ACCEPTED' THEN '관심 있음으로' ELSE '거절로' END));
END $$;

GRANT EXECUTE ON FUNCTION public.respond_rare_offer(uuid, text) TO authenticated;

-- 내 입찰 목록 (입찰자)
CREATE OR REPLACE FUNCTION public.my_rare_offers()
RETURNS TABLE (id uuid, item_id uuid, item_name text, offer_amount bigint, message text,
               status text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  PERFORM public.expire_rare_item_offers();
  RETURN QUERY
    SELECT o.id, o.item_id, it.name, o.offer_amount, o.message, o.status,
           o.created_at, o.expires_at, o.responded_at
      FROM public.rare_item_offers o
      JOIN public.items it ON it.id = o.item_id
     WHERE o.bidder_user_id = auth.uid()
     ORDER BY o.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.my_rare_offers() TO authenticated;

-- 받은 입찰 목록 (보유자) — 입찰자 닉네임만 노출
CREATE OR REPLACE FUNCTION public.received_rare_offers()
RETURNS TABLE (id uuid, item_id uuid, item_name text, bidder_nickname text, offer_amount bigint,
               message text, status text, created_at timestamptz, expires_at timestamptz, responded_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  PERFORM public.expire_rare_item_offers();
  RETURN QUERY
    SELECT o.id, o.item_id, it.name, COALESCE(p.nickname, '알 수 없음'), o.offer_amount, o.message,
           o.status, o.created_at, o.expires_at, o.responded_at
      FROM public.rare_item_offers o
      JOIN public.items it ON it.id = o.item_id
      LEFT JOIN public.profiles p ON p.id = o.bidder_user_id
     WHERE o.owner_user_id = auth.uid()
     ORDER BY (o.status = 'PENDING') DESC, o.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.received_rare_offers() TO authenticated;