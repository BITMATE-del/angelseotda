/**
 * 커스텀 프로필 (30,000P / 7일) — 순수 정책/검증 헬퍼.
 *
 * 서버(purchase_custom_profile / set_custom_profile_image)가 최종 판정하며
 * 이 파일은 동일 기준의 클라이언트 1차 검증 + 표시 문구만 담당한다.
 */

export const CUSTOM_PROFILE_PRICE = 30_000;
export const CUSTOM_PROFILE_DAYS = 7;

/** 업로드 제한 (서버 set_custom_profile_image 와 동일) */
export const CUSTOM_PROFILE_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOM_PROFILE_MIN_PX = 400;
export const CUSTOM_PROFILE_MAX_PX = 2000;
/** 저장 규격 — 정사각형 800×800 WEBP */
export const CUSTOM_PROFILE_TARGET_PX = 800;
export const CUSTOM_PROFILE_WEBP_QUALITY = 0.88;

export const CUSTOM_PROFILE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const CUSTOM_PROFILE_ACCEPT = "image/png,image/jpeg,image/webp";
export const CUSTOM_PROFILE_BUCKET = "custom-profiles";

export interface CheckResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/** 파일 형식 / 용량 1차 검증 */
export function validateProfileFile(file: { name: string; type: string; size: number }): CheckResult {
  const mime = (file.type || "").toLowerCase();
  const extOk = /\.(jpg|jpeg|png|webp)$/i.test(file.name);
  if (!CUSTOM_PROFILE_ALLOWED_MIME.includes(mime as (typeof CUSTOM_PROFILE_ALLOWED_MIME)[number]) || !extOk) {
    return {
      ok: false,
      code: "MIME",
      message: "JPG, PNG, WEBP 이미지만 사용할 수 있습니다.",
    };
  }
  if (file.size <= 0 || file.size > CUSTOM_PROFILE_MAX_BYTES) {
    return {
      ok: false,
      code: "SIZE",
      message: "이미지 용량은 최대 5MB까지 사용할 수 있습니다.",
    };
  }
  return { ok: true };
}

/** 해상도 1차 검증 */
export function validateProfileDimensions(width: number, height: number): CheckResult {
  if (width < CUSTOM_PROFILE_MIN_PX || height < CUSTOM_PROFILE_MIN_PX) {
    return {
      ok: false,
      code: "TOO_SMALL",
      message: "프로필 이미지는 최소 400×400px 이상이어야 합니다.",
    };
  }
  if (width > CUSTOM_PROFILE_MAX_PX || height > CUSTOM_PROFILE_MAX_PX) {
    return {
      ok: false,
      code: "TOO_LARGE",
      message: "프로필 이미지는 최대 2000×2000px까지 사용할 수 있습니다.",
    };
  }
  return { ok: true };
}

/**
 * object-fit: cover 와 동일한 중앙 크롭 영역.
 * 가로 이미지는 좌우를, 세로 이미지는 위아래를 잘라 정사각형으로 맞춘다.
 */
export function coverCropRect(sourceWidth: number, sourceHeight: number) {
  const side = Math.min(sourceWidth, sourceHeight);
  return {
    sx: Math.round((sourceWidth - side) / 2),
    sy: Math.round((sourceHeight - side) / 2),
    size: side,
  };
}

/** 파일 용량 표기: 1.2 MB */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type CustomProfileStatus = "NONE" | "ACTIVE" | "EXPIRED" | "DISABLED";

/** 상태 문구 — 만료 24시간 이내는 "만료 예정" */
export function customProfileStatusLabel(
  status: string,
  active: boolean,
  expiresAt: string | null,
  now: number = Date.now(),
): string {
  if (status === "DISABLED") return "관리자 해제";
  if (!active) return status === "EXPIRED" ? "만료됨" : "미구매";
  if (expiresAt) {
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 24 * 3_600_000) return "만료 예정";
  }
  return "사용중";
}

/** 남은 기간 표기: "6일 14시간" */
export function customProfileRemainLabel(
  expiresAt: string | null,
  now: number = Date.now(),
): string {
  if (!expiresAt) return "-";
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "만료";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}일 ${hours}시간`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}시간 ${minutes}분`;
}
