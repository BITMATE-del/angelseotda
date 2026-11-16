import { supabase } from "@/integrations/supabase/client";
import {
  CUSTOM_PROFILE_BUCKET,
  CUSTOM_PROFILE_TARGET_PX,
  CUSTOM_PROFILE_WEBP_QUALITY,
  coverCropRect,
  validateProfileDimensions,
  validateProfileFile,
} from "@/lib/profile/customProfile";

export interface MyCustomProfile {
  status: string;
  active: boolean;
  imagePath: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  disabledReason: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageBytes: number | null;
}

const EMPTY: MyCustomProfile = {
  status: "NONE",
  active: false,
  imagePath: null,
  startedAt: null,
  expiresAt: null,
  disabledReason: null,
  imageWidth: null,
  imageHeight: null,
  imageBytes: null,
};

export async function fetchMyCustomProfile(): Promise<MyCustomProfile> {
  const { data, error } = await supabase.rpc("my_custom_profile");
  if (error) throw error;
  return { ...EMPTY, ...((data ?? {}) as Partial<MyCustomProfile>) };
}

/** 구매 — 가격/기간은 서버 고정값. requestId 로 연타 중복 차감을 막는다. */
export async function purchaseCustomProfile(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("purchase_custom_profile", { _request_id: requestId });
  if (error) throw error;
}

/** 선택한 파일의 원본 해상도 읽기 */
export async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 정사각형 800×800 WEBP 로 중앙 크롭 후 변환한다.
 * 원본 대용량 이미지를 그대로 HUD 에서 불러오지 않기 위한 처리다.
 */
export async function toSquareWebp(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
      el.src = url;
    });
    const crop = coverCropRect(img.naturalWidth, img.naturalHeight);
    const side = Math.min(CUSTOM_PROFILE_TARGET_PX, crop.size);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지 변환을 지원하지 않는 브라우저입니다.");
    ctx.drawImage(img, crop.sx, crop.sy, crop.size, crop.size, 0, 0, side, side);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", CUSTOM_PROFILE_WEBP_QUALITY),
    );
    if (!blob) throw new Error("이미지 변환에 실패했습니다.");
    return { blob, width: side, height: side };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 업로드 + 서버 등록.
 * 경로는 회원별 폴더로 분리한다: custom-profiles/{user_id}/{timestamp}.webp
 */
export async function uploadCustomProfileImage(file: File): Promise<string> {
  const basic = validateProfileFile({ name: file.name, type: file.type, size: file.size });
  if (!basic.ok) throw new Error(basic.message ?? "사용할 수 없는 이미지입니다.");

  const size = await readImageSize(file);
  const dim = validateProfileDimensions(size.width, size.height);
  if (!dim.ok) throw new Error(dim.message ?? "사용할 수 없는 이미지입니다.");

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("로그인이 필요합니다.");

  const converted = await toSquareWebp(file);
  const path = `${uid}/${Date.now()}.webp`;

  const up = await supabase.storage.from(CUSTOM_PROFILE_BUCKET).upload(path, converted.blob, {
    contentType: "image/webp",
    upsert: false,
  });
  if (up.error) throw new Error("이미지 업로드에 실패했습니다. 다시 시도해주세요.");

  const { error } = await supabase.rpc("set_custom_profile_image", {
    _path: path,
    _mime: "image/webp",
    _bytes: converted.blob.size,
    _width: converted.width,
    _height: converted.height,
  });
  if (error) throw error;
  return path;
}

/** 관리자 — 목록 / 강제 해제 / 만료일 수정 */
export interface AdminCustomProfile {
  userId: string;
  nickname: string | null;
  username: string | null;
  status: string;
  active: boolean;
  imagePath: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  disabledReason: string | null;
  purchaseCount: number;
  paidTotal: number;
  /** 현재 실제 적용중인 프로필 (서버 판정: 커스텀 → 장착 캐릭터 → 기본) */
  currentProfile?: "CUSTOM" | "CHARACTER" | "DEFAULT";
  hasCharacter?: boolean;
}

export async function adminListCustomProfiles(status?: string): Promise<AdminCustomProfile[]> {
  const { data, error } = await supabase.rpc(
    "admin_list_custom_profiles",
    status ? { _status: status } : {},
  );
  if (error) throw error;
  return (data ?? []) as unknown as AdminCustomProfile[];
}

export async function adminDisableCustomProfile(userId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_disable_custom_profile", {
    _user_id: userId,
    _reason: reason,
  });
  if (error) throw error;
}

export async function adminSetCustomProfileExpiry(
  userId: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await supabase.rpc("admin_set_custom_profile_expiry", {
    _user_id: userId,
    _expires_at: expiresAt,
  });
  if (error) throw error;
}

/** private 버킷 이미지 표시용 signed URL */
export async function customProfileSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CUSTOM_PROFILE_BUCKET)
    .createSignedUrl(path, 60 * 60 * 6);
  if (error) return null;
  return data?.signedUrl ?? null;
}
