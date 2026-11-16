-- 자동/수동 지급이 단일 canonical 정산 함수만 사용하도록 구버전 오버로드 제거
DROP FUNCTION IF EXISTS public.credit_crypto_charge(uuid, uuid);
