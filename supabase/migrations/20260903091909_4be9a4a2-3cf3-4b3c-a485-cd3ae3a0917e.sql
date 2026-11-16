-- 상점 상품 이미지(shop-assets)는 공개 상품 에셋이므로 비로그인 조회도 허용한다.
DROP POLICY IF EXISTS "shop assets readable by anon" ON storage.objects;
CREATE POLICY "shop assets readable by anon"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'shop-assets');