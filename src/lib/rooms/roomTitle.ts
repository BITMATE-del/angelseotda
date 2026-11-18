/**
 * 방 제목 클라이언트 정제/검증.
 * 서버(DB 트리거 angel_sanitize_room_title)에서 동일 규칙을 다시 적용한다.
 */

export const ROOM_TITLE_MAX = 20;

/** 제어문자·HTML 위험문자 제거 + 공백 정리 */
export function sanitizeRoomTitle(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>&"'`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ROOM_TITLE_MAX);
}

export function defaultRoomTitle(tierName: string, mode: "sutda2" | "sutda3"): string {
  return `${tierName} ${mode === "sutda3" ? "3장" : "2장"} 테이블`;
}

/** 입력값 검증: 비었으면 기본 제목으로 fallback */
export function resolveRoomTitle(
  raw: string,
  tierName: string,
  mode: "sutda2" | "sutda3",
): { ok: true; title: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, title: defaultRoomTitle(tierName, mode) };
  if (trimmed.length > ROOM_TITLE_MAX) {
    return { ok: false, message: `방 제목은 최대 ${ROOM_TITLE_MAX}글자까지 입력할 수 있습니다.` };
  }
  const clean = sanitizeRoomTitle(trimmed);
  if (clean.length === 0) {
    return { ok: false, message: "사용할 수 없는 방 제목입니다." };
  }
  return { ok: true, title: clean };
}
