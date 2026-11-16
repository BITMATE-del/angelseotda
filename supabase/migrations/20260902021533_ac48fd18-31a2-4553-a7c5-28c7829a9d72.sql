ALTER TABLE public.items ADD COLUMN IF NOT EXISTS rarity text NOT NULL DEFAULT 'NORMAL';

-- RARE = 전 서버 1개 한정
CREATE OR REPLACE FUNCTION public.purchase_item(_item_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price bigint; _balance bigint; _for_sale boolean; _rarity text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT price, for_sale, rarity INTO _price, _for_sale, _rarity
    FROM items WHERE id = _item_id AND enabled = true FOR UPDATE;
  IF _price IS NULL THEN RAISE EXCEPTION '판매 중인 아이템이 아닙니다.'; END IF;
  IF NOT _for_sale THEN RAISE EXCEPTION '계급 전용 아이템은 구매할 수 없습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM user_items WHERE user_id = _uid AND item_id = _item_id) THEN
    RAISE EXCEPTION '이미 보유한 아이템입니다.'; END IF;
  IF _rarity = 'RARE' AND EXISTS (SELECT 1 FROM user_items WHERE item_id = _item_id) THEN
    RAISE EXCEPTION 'RARE 아이템은 전 서버 1명만 소유할 수 있습니다. 이미 주인이 있습니다.'; END IF;
  UPDATE profiles SET game_points = game_points - _price
   WHERE id = _uid AND game_points - locked_points >= _price RETURNING game_points INTO _balance;
  IF _balance IS NULL THEN RAISE EXCEPTION '포인트가 부족합니다.'; END IF;
  INSERT INTO user_items (user_id, item_id, source_type) VALUES (_uid, _item_id, 'SHOP');
  INSERT INTO point_transactions (user_id, type, amount, balance_before, balance_after, locked_before, locked_after, reference_type, reference_id, memo)
  SELECT _uid, 'item_purchase', -_price, _balance + _price, _balance, p.locked_points, p.locked_points, 'item', _item_id, '상점 아이템 구매'
    FROM profiles p WHERE p.id = _uid;
END; $function$;

-- 같은 카테고리 내 단일 장착
CREATE OR REPLACE FUNCTION public.equip_item(_item_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _cat text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT category INTO _cat FROM public.items WHERE id = _item_id;
  IF _cat IS NULL THEN RAISE EXCEPTION '아이템을 찾을 수 없습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_items WHERE user_id=_uid AND item_id=_item_id) THEN
    RAISE EXCEPTION '보유하지 않은 아이템입니다.'; END IF;
  UPDATE public.user_items ui SET equipped = false, equipped_at = NULL
    FROM public.items it
   WHERE ui.item_id = it.id AND ui.user_id = _uid AND it.category = _cat AND ui.equipped;
  UPDATE public.user_items SET equipped = true, equipped_at = now()
   WHERE user_id = _uid AND item_id = _item_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.unequip_category(_category text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.user_items ui SET equipped = false, equipped_at = NULL
    FROM public.items it
   WHERE ui.item_id = it.id AND ui.user_id = auth.uid() AND it.category = _category AND ui.equipped;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.equip_item(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unequip_category(text) FROM anon;

-- ANGEL SUTDA 전용 캐릭터 8종
INSERT INTO public.items (category, name, description, asset_url, price, enabled, for_sale, source_type, rarity)
VALUES
 ('character','흑천사 타짜','검은 날개의 냉혹한 승부사','/characters/dark-angel.jpg',0,true,true,'SHOP','NORMAL'),
 ('character','황금천사','황금 날개의 수호 천사','/characters/golden-angel.jpg',300000,true,true,'SHOP','NORMAL'),
 ('character','월야 도박사','달빛 아래의 노름꾼','/characters/moon-gambler.jpg',250000,true,true,'SHOP','NORMAL'),
 ('character','홍련 승부사','붉은 연꽃의 승부사','/characters/crimson-lotus.jpg',250000,true,true,'SHOP','NORMAL'),
 ('character','백호 도사','백호를 부리는 도사','/characters/white-tiger.jpg',400000,true,true,'SHOP','NORMAL'),
 ('character','청룡 승부사','청룡의 기운을 품은 승부사','/characters/azure-dragon.jpg',400000,true,true,'SHOP','NORMAL'),
 ('character','여우 신선','구미호 신선','/characters/fox-immortal.jpg',1000000,true,true,'SHOP','RARE'),
 ('character','그림자 검사','그림자에서 나타나는 검사','/characters/shadow-blade.jpg',1000000,true,true,'SHOP','RARE');

UPDATE public.items SET asset_url = '/characters/angel-rookie.jpg', description = '기본 지급 캐릭터', price = 0, rarity='NORMAL'
 WHERE category='character' AND name='엔젤 마스터';