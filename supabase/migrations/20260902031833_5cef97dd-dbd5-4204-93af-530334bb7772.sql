DROP POLICY IF EXISTS "shop assets readable by members" ON storage.objects;
CREATE POLICY "shop assets readable by members" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'shop-assets');

DROP POLICY IF EXISTS "shop assets insert admin" ON storage.objects;
CREATE POLICY "shop assets insert admin" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'shop-assets' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "shop assets update admin" ON storage.objects;
CREATE POLICY "shop assets update admin" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'shop-assets' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'shop-assets' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "shop assets delete admin" ON storage.objects;
CREATE POLICY "shop assets delete admin" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'shop-assets' AND public.is_admin(auth.uid()));