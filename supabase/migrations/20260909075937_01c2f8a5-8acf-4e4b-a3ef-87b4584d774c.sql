ALTER TABLE public.dori_actions DROP CONSTRAINT dori_actions_type_chk;
ALTER TABLE public.dori_actions ADD CONSTRAINT dori_actions_type_chk CHECK (action_type = ANY (ARRAY[
  'ANTE','CHECK','CALL','DIE','PING','TTADANG','QUARTER','HALF','ALL_IN',
  'BET','RAISE','FOLD'
]));