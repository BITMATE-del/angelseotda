DROP FUNCTION IF EXISTS public.admin_upsert_item(uuid, text, text, text, bigint, text, text, jsonb, text, integer, text);

CREATE OR REPLACE FUNCTION public.admin_upsert_item(
  _id uuid, _category text, _name text, _description text, _price bigint, _rarity text,
  _asset_url text, _images jsonb, _status text, _sort_order integer,
  _duration_days integer DEFAULT 0, _reason text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _before jsonb; _new_id uuid; _sold boolean; _days int := GREATEST(COALESCE(_duration_days,0), 0);
BEGIN
  IF NOT is_admin(auth.uid()) THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
  IF _name IS NULL OR btrim(_name) = '' THEN RAISE EXCEPTION '상품명을 입력해 주세요.'; END IF;
  IF _price IS NULL OR _price < 0 THEN RAISE EXCEPTION '가격을 확인해 주세요.'; END IF;
  IF _rarity NOT IN ('NORMAL','RARE') THEN RAISE EXCEPTION '등급은 NORMAL 또는 RARE만 가능합니다.'; END IF;
  IF _status NOT IN ('DRAFT','ON_SALE','PAUSED','SOLD_OUT','HIDDEN') THEN RAISE EXCEPTION '잘못된 판매 상태입니다.'; END IF;
  IF _days > 3650 THEN RAISE EXCEPTION '기간제 유효 일수가 너무 큽니다.'; END IF;

  IF _id IS NOT NULL THEN
    SELECT to_jsonb(i) INTO _before FROM items i WHERE id = _id;
    IF _before IS NULL THEN RAISE EXCEPTION '상품을 찾을 수 없습니다.'; END IF;
    _sold := EXISTS (SELECT 1 FROM user_items WHERE item_id = _id);
    IF (_before->>'rarity') = 'RARE' AND _sold THEN
      IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION '판매 완료된 RARE 상품은 최고관리자만 수정할 수 있습니다.'; END IF;
      IF (_before->>'price')::bigint <> _price THEN RAISE EXCEPTION '판매 완료된 RARE 상품의 가격은 변경할 수 없습니다.'; END IF;
    END IF;
    UPDATE items SET
      category = _category, name = btrim(_name), description = _description, price = _price,
      rarity = _rarity, asset_url = _asset_url, images = COALESCE(_images, '[]'::jsonb),
      status = CASE WHEN _sold AND _rarity = 'RARE' THEN 'SOLD_OUT' ELSE _status END,
      sort_order = COALESCE(_sort_order, 0),
      duration_days = _days,
      enabled = (_status IN ('ON_SALE','SOLD_OUT')),
      for_sale = (_status = 'ON_SALE'),
      updated_at = now()
    WHERE id = _id;
    _new_id := _id;
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), 'ITEM_UPDATE', 'item', _id, _reason,
            jsonb_build_object('before', _before, 'after', (SELECT to_jsonb(i) FROM items i WHERE id = _id)));
  ELSE
    INSERT INTO items (category, name, description, price, rarity, asset_url, images, status, sort_order,
                       duration_days, enabled, for_sale, source_type)
    VALUES (_category, btrim(_name), _description, _price, _rarity, _asset_url, COALESCE(_images,'[]'::jsonb),
            _status, COALESCE(_sort_order,0), _days, _status IN ('ON_SALE','SOLD_OUT'), _status = 'ON_SALE', 'shop')
    RETURNING id INTO _new_id;
    INSERT INTO admin_logs (admin_id, action, target_type, target_id, reason, metadata)
    VALUES (auth.uid(), 'ITEM_CREATE', 'item', _new_id, _reason,
            jsonb_build_object('after', (SELECT to_jsonb(i) FROM items i WHERE id = _new_id)));
  END IF;
  RETURN _new_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_upsert_item(uuid, text, text, text, bigint, text, text, jsonb, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_item(uuid, text, text, text, bigint, text, text, jsonb, text, integer, integer, text) TO authenticated, service_role;