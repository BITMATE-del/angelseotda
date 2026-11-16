INSERT INTO public.app_settings (key, value)
VALUES ('support_telegram_url', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.support_center_link()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(trim(both '"' from (value)::text), ''), '')
  FROM public.app_settings WHERE key = 'support_telegram_url'
$$;

GRANT EXECUTE ON FUNCTION public.support_center_link() TO anon, authenticated;

CREATE TABLE public.event_popups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  image_url text,
  cta_label text,
  cta_type text NOT NULL DEFAULT 'NONE' CHECK (cta_type IN ('NONE','INTERNAL','EXTERNAL','SUPPORT')),
  cta_link text,
  active boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer NOT NULL DEFAULT 0,
  placement text NOT NULL DEFAULT 'LOBBY' CHECK (placement IN ('LOBBY','ALL','GAME_ROOM')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.event_popups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_popups TO authenticated;
GRANT ALL ON public.event_popups TO service_role;

ALTER TABLE public.event_popups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_popups_public_read_active" ON public.event_popups
FOR SELECT TO anon, authenticated
USING (
  active = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at IS NULL OR ends_at >= now())
);

CREATE POLICY "event_popups_admin_read" ON public.event_popups
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "event_popups_admin_insert" ON public.event_popups
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "event_popups_admin_update" ON public.event_popups
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "event_popups_admin_delete" ON public.event_popups
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER event_popups_set_updated_at
BEFORE UPDATE ON public.event_popups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();