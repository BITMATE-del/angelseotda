ALTER TABLE public.dori_hand_submissions DROP CONSTRAINT IF EXISTS dori_hand_type_chk;
ALTER TABLE public.dori_hand_submissions ADD CONSTRAINT dori_hand_type_chk
  CHECK (hand_type = ANY (ARRAY['DDAENG'::text,'GGUT'::text,'TTAENGJABI'::text,'GUSA'::text]));