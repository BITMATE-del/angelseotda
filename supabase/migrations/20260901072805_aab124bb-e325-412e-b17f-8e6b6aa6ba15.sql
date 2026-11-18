CREATE OR REPLACE FUNCTION public.purchase_item(_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _price bigint;
  _balance bigint;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  SELECT price INTO _price FROM public.items WHERE id = _item_id AND enabled = true;
  IF _price IS NULL THEN
    RAISE EXCEPTION '판매 중인 아이템이 아닙니다.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_items WHERE user_id = _uid AND item_id = _item_id) THEN
    RAISE EXCEPTION '이미 보유한 아이템입니다.';
  END IF;

  UPDATE public.profiles
     SET game_points = game_points - _price
   WHERE id = _uid AND game_points - locked_points >= _price
  RETURNING game_points INTO _balance;

  IF _balance IS NULL THEN
    RAISE EXCEPTION '포인트가 부족합니다.';
  END IF;

  INSERT INTO public.user_items (user_id, item_id) VALUES (_uid, _item_id);

  INSERT INTO public.point_transactions (user_id, type, amount, balance_after, memo, ref_id)
  VALUES (_uid, 'item_purchase', -_price, _balance, '상점 아이템 구매', _item_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_item(uuid) TO authenticated;