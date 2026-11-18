INSERT INTO public.app_settings (key, value)
VALUES ('official_channel_url', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.official_channel_link()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(trim(both '"' from (value)::text), '')
  FROM public.app_settings
  WHERE key = 'official_channel_url'
$$;

GRANT EXECUTE ON FUNCTION public.official_channel_link() TO anon, authenticated;