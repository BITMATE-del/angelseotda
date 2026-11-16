DO $do$
DECLARE
  _src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='dori_round_result';

  IF position($x$    'revealMode', _mode,$x$ in _src) = 0 THEN
    RAISE EXCEPTION 'dori_round_result payload block not found';
  END IF;
  _src := replace(_src, $x$    'revealMode', _mode,$x$,
                        $x$    'rematchReason', _r.rematch_reason,
    'revealMode', _mode,$x$);

  IF position($x$      'contribution', rp.contribution,$x$ in _src) = 0 THEN
    RAISE EXCEPTION 'dori_round_result player block not found';
  END IF;
  _src := replace(_src, $x$      'contribution', rp.contribution,$x$,
                        $x$      'handCode', case when rp.user_id = _uid or public.dori_seat_revealed(_mode, rp.folded, rp.result_type)
        then rp.hand_code else null end,
      'contribution', rp.contribution,$x$);

  EXECUTE _src;
END $do$;