DO $do$
DECLARE
  _src text;
  _old text := $old$    CASE WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                           WHERE p.round_id=_round_id AND p.hand_code LIKE 'gusa%' AND p.folded=false)
             THEN 'GUSA' ELSE 'DRAW' END ELSE NULL END,$old$;
  _new text := $new$    CASE
          WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                        WHERE p.round_id=_round_id AND p.hand_code = 'gusa_meongteong' AND p.folded=false)
            THEN 'GUSA_MEONGTEONG'
          WHEN EXISTS (SELECT 1 FROM public.game_round_players p
                        WHERE p.round_id=_round_id AND p.hand_code = 'gusa' AND p.folded=false)
            THEN 'GUSA'
          ELSE 'DRAW' END ELSE NULL END,$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_round_state';
  IF position(_old in _src) = 0 THEN
    RAISE EXCEPTION 'rematchReason block not found';
  END IF;
  EXECUTE replace(_src, _old, _new);
END $do$;