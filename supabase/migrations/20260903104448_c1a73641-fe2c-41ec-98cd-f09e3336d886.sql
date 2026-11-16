CREATE OR REPLACE FUNCTION public.bet_additional_amount(_action_type text, _pot bigint, _current_bet bigint, _base_bet bigint, _stage_bet bigint, _balance bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _owed bigint;
  _eff_pot bigint;
  _amount bigint := 0;
  _target bigint;
BEGIN
  _owed := GREATEST(COALESCE(_current_bet,0) - COALESCE(_stage_bet,0), 0);
  -- 버튼을 누르기 직전의 서버 유효 POT. 콜 금액을 POT 에 먼저 더하지 않는다.
  _eff_pot := COALESCE(_pot,0);

  IF _action_type IN ('die','jjol','check') THEN
    _amount := 0;
  ELSIF _action_type = 'call' THEN
    _amount := _owed;
  ELSIF _action_type = 'ping' THEN
    _amount := _owed + _base_bet;
  ELSIF _action_type = 'ttadang' THEN
    _target := GREATEST(COALESCE(_current_bet,0), _base_bet) * 2;
    _amount := GREATEST(_target - COALESCE(_stage_bet,0), _owed + _base_bet);
  ELSIF _action_type = 'half' THEN
    _amount := _owed + GREATEST(_eff_pot / 2, _base_bet);
  ELSIF _action_type = 'quarter' THEN
    _amount := _owed + GREATEST(_eff_pot / 4, _base_bet);
  ELSIF _action_type = 'all_in' THEN
    _amount := GREATEST(COALESCE(_balance,0), 0);
  ELSE
    RETURN NULL;
  END IF;

  IF _amount > COALESCE(_balance,0) THEN _amount := GREATEST(COALESCE(_balance,0),0); END IF;
  RETURN GREATEST(_amount, 0);
END $function$;

CREATE OR REPLACE FUNCTION public.equip_item(_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _cat text; _exp timestamptz; _has boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  SELECT category INTO _cat FROM public.items WHERE id = _item_id;
  IF _cat IS NULL THEN RAISE EXCEPTION '아이템을 찾을 수 없습니다.'; END IF;
  SELECT true, ui.expires_at INTO _has, _exp
    FROM public.user_items ui WHERE ui.user_id = _uid AND ui.item_id = _item_id;
  IF _has IS NOT TRUE THEN RAISE EXCEPTION '보유하지 않은 아이템입니다.'; END IF;
  IF _exp IS NOT NULL AND _exp <= now() THEN RAISE EXCEPTION '유효기간이 만료된 아이템입니다.'; END IF;
  UPDATE public.user_items ui SET equipped = false, equipped_at = NULL
    FROM public.items it
   WHERE ui.item_id = it.id AND ui.user_id = _uid AND it.category = _cat AND ui.equipped;
  -- 칭호는 1개만 장착: 일반 칭호를 장착하면 커스텀 칭호는 해제한다.
  IF _cat = 'title' THEN
    UPDATE public.custom_titles SET equipped = false WHERE user_id = _uid AND equipped;
  END IF;
  UPDATE public.user_items SET equipped = true, equipped_at = now()
   WHERE user_id = _uid AND item_id = _item_id;
END $function$;

CREATE OR REPLACE FUNCTION public.my_equipped_title()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _r jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
  PERFORM public.expire_custom_titles();

  SELECT jsonb_build_object(
           'type', 'CUSTOM', 'titleText', c.title_text,
           'expiresAt', c.expires_at, 'isActive', true
         )
    INTO _r
    FROM public.custom_titles c
   WHERE c.user_id = _uid AND c.equipped = true AND c.status = 'ACTIVE' AND c.expires_at > now()
   LIMIT 1;
  IF _r IS NOT NULL THEN RETURN _r; END IF;

  SELECT jsonb_build_object(
           'type', CASE WHEN ui.source_type = 'RANKING' THEN 'RANKING' ELSE 'SYSTEM' END,
           'titleText', i.name, 'expiresAt', ui.expires_at, 'isActive', true
         )
    INTO _r
    FROM public.user_items ui JOIN public.items i ON i.id = ui.item_id
   WHERE ui.user_id = _uid AND ui.equipped = true AND i.category = 'title'
     AND (ui.expires_at IS NULL OR ui.expires_at > now())
   ORDER BY ui.equipped_at DESC NULLS LAST
   LIMIT 1;

  RETURN COALESCE(_r, jsonb_build_object('type', NULL, 'titleText', NULL, 'expiresAt', NULL, 'isActive', false));
END $function$;

GRANT EXECUTE ON FUNCTION public.my_equipped_title() TO authenticated;