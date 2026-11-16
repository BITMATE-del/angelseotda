import { supabase } from "@/integrations/supabase/client";

/** 커스텀 칭호 정책 (서버 purchase_custom_title 과 동일) */
export const CUSTOM_TITLE_PRICE = 25_000;
export const CUSTOM_TITLE_DAYS = 7;
export const CUSTOM_TITLE_MAX_LEN = 6;

export interface MyCustomTitle {
  id: string;
  title_text: string;
  status: string;
  equipped: boolean;
  price: number;
  purchased_at: string;
  expires_at: string;
  disabled_reason: string | null;
}

export interface AdminCustomTitle {
  id: string;
  userId: string;
  nickname: string | null;
  username: string | null;
  title: string;
  status: string;
  equipped: boolean;
  price: number;
  purchasedAt: string;
  expiresAt: string;
  disabledReason: string | null;
}

export interface AvailabilityResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/** 클라이언트 1차 검증 (서버가 최종 검증) */
export function checkCustomTitleLocal(raw: string): AvailabilityResult {
  const clean = raw.trim();
  if (clean.length === 0) return { ok: false, code: "EMPTY", message: "칭호명을 입력해 주세요." };
  if (clean.length > CUSTOM_TITLE_MAX_LEN) {
    return { ok: false, code: "TOO_LONG", message: `칭호명은 1~${CUSTOM_TITLE_MAX_LEN}글자만 가능합니다.` };
  }
  if (!/^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+$/.test(clean)) {
    return { ok: false, code: "INVALID_CHAR", message: "한글/영문/숫자만 사용할 수 있습니다." };
  }
  return { ok: true };
}

export async function checkCustomTitleAvailable(title: string): Promise<AvailabilityResult> {
  const local = checkCustomTitleLocal(title);
  if (!local.ok) return local;
  const { data, error } = await supabase.rpc("custom_title_available", { _title: title.trim() });
  if (error) throw error;
  return (data ?? { ok: false }) as unknown as AvailabilityResult;
}

export async function purchaseCustomTitle(title: string, requestId: string): Promise<void> {
  const { error } = await supabase.rpc("purchase_custom_title", {
    _title: title.trim(),
    _request_id: requestId,
  });
  if (error) throw error;
}

export async function fetchMyCustomTitles(): Promise<MyCustomTitle[]> {
  const { data, error } = await supabase.rpc("my_custom_titles");
  if (error) throw error;
  return (data ?? []) as MyCustomTitle[];
}

export async function equipCustomTitle(id: string): Promise<void> {
  const { error } = await supabase.rpc("equip_custom_title", { _id: id });
  if (error) throw error;
}

export async function adminListCustomTitles(status?: string): Promise<AdminCustomTitle[]> {
  const { data, error } = await supabase.rpc(
    "admin_list_custom_titles",
    status ? { _status: status } : {},
  );
  if (error) throw error;
  return (data ?? []) as unknown as AdminCustomTitle[];
}

export async function adminDisableCustomTitle(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("admin_disable_custom_title", { _id: id, _reason: reason });
  if (error) throw error;
}

/** 남은 기간 표시: "6일 14시간" */
export function remainLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "만료";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}일 ${hours}시간`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}시간 ${minutes}분`;
}

/**
 * 현재 장착 중인 칭호 1개 (공통 조회).
 *
 * 일반(SYSTEM/RANKING) 칭호와 커스텀 칭호를 서버에서 한 번에 판정하므로
 * 인벤토리 / 프리뷰 / 프로필 / 게임방 HUD 가 서로 다른 값을 표시하지 않는다.
 */
export interface EquippedTitle {
  type: "SYSTEM" | "RANKING" | "CUSTOM" | null;
  titleText: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

export async function fetchEquippedTitle(): Promise<EquippedTitle> {
  const { data, error } = await supabase.rpc("my_equipped_title");
  if (error) throw error;
  const row = (data ?? {}) as Partial<EquippedTitle>;
  return {
    type: row.type ?? null,
    titleText: row.titleText ?? null,
    expiresAt: row.expiresAt ?? null,
    isActive: !!row.isActive,
  };
}
