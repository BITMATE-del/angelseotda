DO $do$
DECLARE
  _src text;
  _old text := $x$'winnerId',_r.winner_id,'settlementStatus',_r.settlement_status,$x$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='dori_room_state';
  IF position(_old in _src) = 0 THEN
    RAISE EXCEPTION 'dori_room_state round payload not found';
  END IF;
  EXECUTE replace(_src, _old,
    $x$'winnerId',_r.winner_id,'settlementStatus',_r.settlement_status,
      'rematchReason',_r.rematch_reason,$x$);
END $do$;