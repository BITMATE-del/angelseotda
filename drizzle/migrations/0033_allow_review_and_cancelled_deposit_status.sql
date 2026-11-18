-- 미매칭 확인중(REVIEW) 신청 상태와 관리자 취소(CANCELLED) 입금 상태 허용
ALTER TABLE public.crypto_charge_requests DROP CONSTRAINT IF EXISTS crypto_charge_requests_status_chk;
ALTER TABLE public.crypto_charge_requests ADD CONSTRAINT crypto_charge_requests_status_chk
  CHECK (status = ANY (ARRAY['PENDING','MATCHED','CONFIRMING','CREDITING','CREDITED','REVIEW','EXPIRED','CANCELLED','ERROR']));

ALTER TABLE public.chain_deposits DROP CONSTRAINT IF EXISTS chain_deposits_status_chk;
ALTER TABLE public.chain_deposits ADD CONSTRAINT chain_deposits_status_chk
  CHECK (status = ANY (ARRAY['DETECTED','MATCHED','CREDITED','UNMATCHED','EXPIRED_MATCH','DUPLICATE','CANCELLED','ERROR']));
