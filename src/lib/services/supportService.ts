/**
 * supportService — 고객센터(Telegram) 링크.
 *
 * 링크 값은 app_settings.support_telegram_url (서버가 source of truth)에 저장되고,
 * 수정은 admin_update_setting RPC(admin/super_admin 전용)로만 가능하다.
 * 공개 조회는 support_center_link() SECURITY DEFINER 함수로 링크 값만 내려간다.
 */
import { supabase } from "@/integrations/supabase/client";

export const SUPPORT_SETTING_KEY = "support_telegram_url";
/** 공식채널 입장 링크 (app_settings.official_channel_url) */
export const OFFICIAL_CHANNEL_SETTING_KEY = "official_channel_url";

const TG_HOST = "https://t.me/";
const USERNAME_RE = /^[a-zA-Z0-9_]{4,32}$/;

export interface NormalizeResult {
  ok: boolean;
  url: string;
  reason?: string;
}

/**
 * 관리자 입력값을 정규화한다.
 * - 공백 제거
 * - "@id" / "id" → https://t.me/id
 * - "t.me/id" / "http(s)://t.me/id" → https://t.me/id
 * - 빈 값은 "미설정"으로 허용(ok)
 * - 그 외 형식은 저장 차단
 */
export function normalizeTelegramLink(input: string): NormalizeResult {
  const raw = (input ?? "").replace(/\s+/g, "");
  if (!raw) return { ok: true, url: "" };

  let handle = raw;
  const lower = raw.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("t.me/")) {
    const withoutScheme = raw.replace(/^https?:\/\//i, "");
    if (!/^t\.me\//i.test(withoutScheme)) {
      return { ok: false, url: "", reason: "텔레그램 t.me 주소만 사용할 수 있습니다." };
    }
    handle = withoutScheme.slice("t.me/".length);
  }
  handle = handle.replace(/^@/, "").replace(/\/+$/, "");

  if (!handle) return { ok: false, url: "", reason: "텔레그램 아이디가 비어 있습니다." };
  if (!USERNAME_RE.test(handle)) {
    return {
      ok: false,
      url: "",
      reason: "텔레그램 아이디는 영문·숫자·밑줄 4~32자여야 합니다. (예: @angel_support)",
    };
  }
  return { ok: true, url: `${TG_HOST}${handle}` };
}

/** 공개 고객센터 링크 조회 (미설정이면 빈 문자열) */
export async function fetchSupportLink(): Promise<string> {
  const { data, error } = await supabase.rpc("support_center_link");
  if (error) throw error;
  const value = typeof data === "string" ? data : "";
  const normalized = normalizeTelegramLink(value);
  return normalized.ok ? normalized.url : "";
}

/** 공개 공식채널 링크 조회 (미설정이면 빈 문자열) */
export async function fetchOfficialChannelLink(): Promise<string> {
  const { data, error } = await supabase.rpc("official_channel_link");
  if (error) throw error;
  const value = typeof data === "string" ? data : "";
  const normalized = normalizeTelegramLink(value);
  return normalized.ok ? normalized.url : "";
}
