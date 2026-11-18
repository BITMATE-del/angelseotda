-- 커미션 status 표기가 'accrued' / 'UNSETTLED' / 'SETTLED' 등 대소문자·명칭이 혼재되어
-- 요약 집계(미정산/정산완료)가 항상 0으로 표시되던 문제 수정. 집계 기준만 정규화한다.
CREATE OR REPLACE FUNCTION public.affiliate_commission_is_settled(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT upper(coalesce(_status,'')) = 'SETTLED'
$$;

CREATE OR REPLACE FUNCTION public.affiliate_commission_is_unsettled(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT upper(coalesce(_status,'')) IN ('PENDING','UNSETTLED','ACCRUED')
$$;

GRANT EXECUTE ON FUNCTION public.affiliate_commission_is_settled(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_commission_is_unsettled(text) TO authenticated, anon, service_role;
