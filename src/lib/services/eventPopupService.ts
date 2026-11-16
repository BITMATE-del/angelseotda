/**
 * eventPopupService — 이벤트 팝업 (관리자 CRUD + 사용자 노출).
 *
 * 노출 여부는 서버 RLS(active + 기간)가 1차로 결정하고,
 * "오늘 다시 보지 않기"는 KST 날짜 기준으로 브라우저에 저장한다.
 */
import { supabase } from "@/integrations/supabase/client";

export type PopupCtaType = "NONE" | "INTERNAL" | "EXTERNAL" | "SUPPORT";
export type PopupPlacement = "LOBBY" | "ALL" | "GAME_ROOM";

export const CTA_TYPE_LABEL: Record<PopupCtaType, string> = {
  NONE: "버튼 없음",
  INTERNAL: "내부 페이지",
  EXTERNAL: "외부 링크",
  SUPPORT: "고객센터(Telegram)",
};

export const PLACEMENT_LABEL: Record<PopupPlacement, string> = {
  LOBBY: "로비",
  ALL: "전체 페이지",
  GAME_ROOM: "게임방",
};

export interface EventPopup {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  cta_label: string | null;
  cta_type: PopupCtaType;
  cta_link: string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  placement: PopupPlacement;
  created_at: string;
  updated_at: string;
}

export type EventPopupInput = Omit<EventPopup, "id" | "created_at" | "updated_at"> & { id?: string };

const DISMISS_PREFIX = "angel-popup-dismissed:";

/** KST(UTC+9) 기준 오늘 날짜 (YYYY-MM-DD) */
export function kstDateKey(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function isDismissedToday(popupId: string, now: Date = new Date()): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(DISMISS_PREFIX + popupId) === kstDateKey(now);
}

export function dismissForToday(popupId: string, now: Date = new Date()): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DISMISS_PREFIX + popupId, kstDateKey(now));
}

/** 사용자 노출용 활성 팝업 목록 (RLS가 기간/활성 필터를 보장) */
export async function fetchActivePopups(placement: PopupPlacement): Promise<EventPopup[]> {
  const { data, error } = await supabase
    .from("event_popups")
    .select("*")
    .in("placement", [placement, "ALL"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventPopup[];
}

/** 관리자 목록 (비활성/기간 외 포함) */
export async function fetchAllPopups(): Promise<EventPopup[]> {
  const { data, error } = await supabase
    .from("event_popups")
    .select("*")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventPopup[];
}

export async function savePopup(input: EventPopupInput): Promise<void> {
  const row = {
    title: input.title,
    body: input.body,
    image_url: input.image_url,
    cta_label: input.cta_label,
    cta_type: input.cta_type,
    cta_link: input.cta_type === "EXTERNAL" || input.cta_type === "INTERNAL" ? input.cta_link : null,
    active: input.active,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    priority: input.priority,
    placement: input.placement,
  };
  if (input.id) {
    const { error } = await supabase.from("event_popups").update(row).eq("id", input.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("event_popups").insert(row);
  if (error) throw error;
}

export async function setPopupActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("event_popups").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deletePopup(id: string): Promise<void> {
  const { error } = await supabase.from("event_popups").delete().eq("id", id);
  if (error) throw error;
}

export const POPUP_BUCKET = "shop-assets";

/**
 * 팝업 이미지 업로드 → storage 경로 반환.
 * DB에는 만료되는 signed URL / blob URL을 저장하지 않고 경로만 저장한다.
 * (업로드가 실패하면 throw → 팝업 저장도 진행되지 않는다.)
 */
export async function uploadPopupImage(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
  const path = `popups/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(POPUP_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** 저장된 값에서 storage 경로만 추출 (과거에 저장된 public/signed URL도 복구한다) */
export function popupImagePath(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (/^(blob:|data:|file:)/i.test(v)) return null;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(v)) return null;
  const match = v.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  if (/^https?:/i.test(v)) return null;
  return v.replace(/^\/+/, "");
}

/** 외부 이미지 주소인지 (그대로 사용) */
export function popupExternalUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || !/^https?:/i.test(v)) return null;
  if (/\/storage\/v1\/object\//.test(v)) return null;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(v)) return null;
  return v;
}

/** 팝업 이미지 표시용 주소 (경로는 조회 URL로 변환, 실패 시 null → fallback 표시) */
export async function popupImageUrl(value: string | null | undefined): Promise<string | null> {
  const external = popupExternalUrl(value);
  if (external) return external;
  const path = popupImagePath(value);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(POPUP_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) return null;
  return data?.signedUrl ?? null;
}


/** 팝업 CTA가 실제로 열어야 하는 주소 (고객센터 타입은 현재 설정 링크 사용) */
export function resolveCtaLink(popup: EventPopup, supportLink: string): string {
  if (popup.cta_type === "SUPPORT") return supportLink;
  return popup.cta_link ?? "";
}
