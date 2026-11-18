DO $mig$
DECLARE _def text; _old text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_round_state';

  _old := 'WHEN _r.game_mode=''sutda3'' AND p.open_card IS NOT NULL AND NOT p.folded THEN
          jsonb_build_array(p.open_card)';
  _new := _old || '
        WHEN _r.game_mode=''sutda2'' THEN
          COALESCE((SELECT jsonb_agg(c.card_code ORDER BY c.card_order) FROM public.game_cards c
             WHERE c.round_id=_round_id AND c.user_id=p.user_id AND c.card_order=1), ''[]''::jsonb)';

  IF position(_old in _def) = 0 THEN
    RAISE EXCEPTION 'get_round_state cards branch not found';
  END IF;

  _def := replace(_def, _old, _new);
  EXECUTE _def;
END $mig$;