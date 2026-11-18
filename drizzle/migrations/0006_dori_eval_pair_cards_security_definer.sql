-- 순수 족보 계산 함수. 섯다 evaluator(EXECUTE 제한)를 재사용하므로 정의자 권한으로 실행한다.
CREATE OR REPLACE FUNCTION public.dori_eval_pair_cards(_c1 text, _c2 text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  h jsonb; c text; cat text; sc int; typ text; code text; val int := 0;
BEGIN
  h := public.evaluate_sutda_hand(_c1, _c2);
  c := h->>'code'; cat := h->>'category'; sc := (h->>'score')::int;
  IF cat = 'kwangttaeng' THEN
    typ := 'GWANGDDAENG'; code := 'GWANG_' || replace(c, 'kwang', '');
  ELSIF cat = 'ttaeng' THEN
    typ := 'DDAENG'; val := replace(c, 'ttaeng', '')::int; code := 'DDAENG_' || val;
  ELSIF cat = 'special' THEN
    typ := 'SPECIAL'; code := upper(c);
  ELSIF cat = 'gusa' THEN
    typ := 'GUSA'; code := CASE WHEN c = 'gusa_meongteong' THEN 'MUNG_GUSA' ELSE 'GUSA' END;
  ELSIF cat = 'amhaeng' THEN
    typ := 'AMHAENG'; code := 'AMHAENG';
  ELSIF cat = 'ttaengjabi' THEN
    typ := 'TTAENGJABI'; code := 'TTAENGJABI';
  ELSE
    typ := 'GGUT'; val := replace(c, 'kkeut', '')::int; code := 'GGUT_' || val;
  END IF;
  RETURN jsonb_build_object('type', typ, 'value', val, 'rank', sc,
                            'label', h->>'name', 'code', code, 'sutda_code', c);
END $$;

REVOKE ALL ON FUNCTION public.dori_eval_pair_cards(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dori_eval_pair_cards(text, text) TO authenticated, service_role;