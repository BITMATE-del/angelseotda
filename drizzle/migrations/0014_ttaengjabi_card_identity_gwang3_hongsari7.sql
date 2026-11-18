CREATE OR REPLACE FUNCTION public.sutda_special_cards()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM public.app_settings WHERE key='special_cards'),
    jsonb_build_object('amhaeng', jsonb_build_array('04-a','07-a'),
                       'ttaengjabi', jsonb_build_array('03-gwang','07-a'),
                       'gusa_meongteong', jsonb_build_array('04-a','09-a')));
$$;