import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CUSTOM_PROFILE_BUCKET } from "./customProfile";

/**
 * 활성 커스텀 프로필 이미지 조회 (표시 전용).
 *
 * - 어떤 회원이 "지금" 활성 커스텀 프로필을 쓰는지는 서버(custom_profile_images)가 판정한다.
 * - 만료/관리자 해제 상태는 서버에서 제외되므로 클라이언트는 기간 계산을 하지 않는다.
 * - 이미지는 private 버킷의 signed URL 로 표시한다.
 */

const SIGNED_TTL = 60 * 60 * 6;
const urlCache = new Map<string, Promise<string | null>>();
const pathCache = new Map<string, { value: string | null; at: number }>();
const inflight = new Map<string, Promise<string | null>>();
const PATH_TTL_MS = 60_000;

/** 캐시 세대 — 이미지가 바뀌면 올려서 마운트된 모든 화면이 즉시 다시 조회한다. */
let generation = 0;
const listeners = new Set<() => void>();

function signedUrl(path: string): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  const task = supabase.storage
    .from(CUSTOM_PROFILE_BUCKET)
    .createSignedUrl(path, SIGNED_TTL)
    .then(({ data, error }) => (error ? null : (data?.signedUrl ?? null)))
    .catch(() => null);
  urlCache.set(path, task);
  return task;
}

async function fetchPath(userId: string): Promise<string | null> {
  const cached = pathCache.get(userId);
  if (cached && Date.now() - cached.at < PATH_TTL_MS) return cached.value;
  const running = inflight.get(userId);
  if (running) return running;

  const task = (async (): Promise<string | null> => {
    let value: string | null = null;
    try {
      const { data, error } = await supabase.rpc("custom_profile_images", {
        _user_ids: [userId],
      });
      if (!error) {
        const map = (data ?? {}) as Record<string, string | null>;
        value = map[userId] ?? null;
      }
    } catch {
      value = null;
    }
    pathCache.set(userId, { value, at: Date.now() });
    inflight.delete(userId);
    return value;
  })();
  inflight.set(userId, task);
  return task;
}

/**
 * 내 이미지가 방금 바뀐 경우 즉시 반영되도록 캐시를 비우고,
 * 이미 마운트된 화면(나의 프로필 · HUD 등)에 재조회를 알린다.
 */
export function resetCustomProfileImageCache(): void {
  pathCache.clear();
  inflight.clear();
  urlCache.clear();
  generation += 1;
  for (const fn of [...listeners]) fn();
}

/**
 * userId 의 활성 커스텀 프로필 이미지 URL (없으면 null).
 * null 이면 호출부는 기존 우선순위(장착 캐릭터 → 기본 프로필)를 그대로 사용한다.
 */
export function useCustomProfileImage(userId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [gen, setGen] = useState(generation);

  useEffect(() => {
    const notify = () => setGen(generation);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!userId) return;
    void fetchPath(userId).then((path) => {
      if (!alive || !path) return;
      void signedUrl(path).then((u) => {
        if (alive) setUrl(u);
      });
    });
    return () => {
      alive = false;
    };
  }, [userId, gen]);

  return url;
}
