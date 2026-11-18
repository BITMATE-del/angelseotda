import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * 상점 상품 이미지 경로 해석.
 * DB(items.asset_url)에는 storage 경로만 저장하고, 표시 시점에 조회 URL을 생성한다.
 * (만료되는 URL을 DB에 저장하지 않는다.)
 */

const SHOP_BUCKET = "shop-assets";
const TTL_SECONDS = 60 * 60 * 24 * 7;
const cache = new Map<string, Promise<string | null>>();

/** 브라우저 임시 URL / 로컬 URL / 저장된 signed URL 등 재업로드가 필요한 값 */
export function needsReupload(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  return (
    v.startsWith("blob:") ||
    v.startsWith("data:") ||
    v.startsWith("file:") ||
    /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(v) ||
    /\/object\/sign\//.test(v) ||
    /[?&]token=/.test(v)
  );
}

/** storage 경로인지 (외부 URL·번들 에셋 경로가 아닌지) */
export function isStoragePath(value: string): boolean {
  return !/^(https?:|blob:|data:|file:|\/)/i.test(value.trim());
}

/** storage 경로 → 조회 가능한 URL (동일 경로는 캐시) */
export function shopImageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return Promise.resolve(null);
  const value = pathOrUrl.trim();
  if (needsReupload(value)) return Promise.resolve(null);
  if (!isStoragePath(value)) return Promise.resolve(value);

  const cached = cache.get(value);
  if (cached) return cached;
  const task = supabase.storage
    .from(SHOP_BUCKET)
    .createSignedUrl(value, TTL_SECONDS)
    .then(({ data, error }) => (error ? null : (data?.signedUrl ?? null)))
    .catch(() => null);
  cache.set(value, task);
  return task;
}

/** 상점 이미지 표시용 훅 — 실패 시 null을 돌려 placeholder를 쓰게 한다. */
export function useShopImage(pathOrUrl: string | null | undefined) {
  const value = pathOrUrl?.trim() || null;
  const [url, setUrl] = useState<string | null>(() =>
    value && !isStoragePath(value) && !needsReupload(value) ? value : null,
  );
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    setBroken(false);
    if (!value) {
      setUrl(null);
      return;
    }
    void shopImageUrl(value).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [value]);

  return {
    url: broken ? null : url,
    pending: Boolean(value) && !url && !broken,
    onError: () => setBroken(true),
  };
}
