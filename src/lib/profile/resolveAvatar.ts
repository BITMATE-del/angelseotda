import { useCustomProfileImage } from "./useCustomProfileImage";

/**
 * 프로필(아바타) 이미지 공통 resolver.
 *
 * 모든 화면(나의 프로필 · 섯다/도리 HUD · 랭킹 · 채팅 · 프로필 팝업)은
 * 이 우선순위 하나만 사용한다.
 *
 * 1) 활성 커스텀 프로필 (서버 custom_profile_images 판정 — active/기간/해제 반영)
 * 2) 장착 캐릭터 / 장착 프로필
 * 3) 기본 프로필 이미지
 * 4) fallback
 *
 * 커스텀 프로필이 활성인 동안에도 장착 캐릭터 데이터는 그대로 유지되며,
 * 만료되면 서버 판정이 빠지므로 자동으로 2순위(장착 캐릭터)로 복귀한다.
 */
export interface AvatarSources {
  /** 활성 커스텀 프로필 URL (서버 판정 결과만 전달) */
  customProfileUrl?: string | null;
  /** 장착 캐릭터 / 장착 프로필 URL */
  equippedCharacterUrl?: string | null;
  /** 기본 프로필 이미지 */
  defaultProfileUrl?: string | null;
  /** 최종 fallback */
  fallbackUrl?: string | null;
}

function firstUsable(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/** 순수 함수 — 우선순위 판정만 담당한다. */
export function resolveAvatarUrl(sources: AvatarSources): string | null {
  return firstUsable(
    sources.customProfileUrl,
    sources.equippedCharacterUrl,
    sources.defaultProfileUrl,
    sources.fallbackUrl,
  );
}

/**
 * 화면용 resolver — userId 의 활성 커스텀 프로필을 서버에서 확인한 뒤
 * resolveAvatarUrl 우선순위로 최종 이미지를 반환한다.
 */
export function useResolvedAvatar(
  userId: string | null | undefined,
  sources: Omit<AvatarSources, "customProfileUrl"> = {},
): string | null {
  const customProfileUrl = useCustomProfileImage(userId);
  return resolveAvatarUrl({ ...sources, customProfileUrl });
}
