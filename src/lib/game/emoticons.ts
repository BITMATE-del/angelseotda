/**
 * ANGEL SUTDA 전용 이모티콘 / 퀵 리액션 카탈로그.
 * - NORMAL: 전원 기본 제공
 * - RARE: 상점/보유형 확장 대비 (ownedCodes로 필터링 가능)
 * 채팅 테이블에는 kind='emote', message=code 로 저장한다.
 */
export type EmoticonTier = "NORMAL" | "RARE";

export interface Emoticon {
  code: string;
  label: string;
  glyph: string;
  tier: EmoticonTier;
  /** 퀵 리액션 바에 노출할지 */
  quick?: boolean;
}

export const EMOTICONS: Emoticon[] = [
  { code: "kk", label: "ㅋㅋ", glyph: "ㅋㅋ", tier: "NORMAL", quick: true },
  { code: "tt", label: "ㅠㅠ", glyph: "ㅠㅠ", tier: "NORMAL", quick: true },
  { code: "good", label: "굿", glyph: "👍", tier: "NORMAL", quick: true },
  { code: "call", label: "콜?", glyph: "🤔", tier: "NORMAL", quick: true },
  { code: "ddadang", label: "따당!", glyph: "⚡", tier: "NORMAL", quick: true },
  { code: "allin", label: "올인!", glyph: "🔥", tier: "NORMAL", quick: true },
  { code: "nice", label: "나이스", glyph: "✨", tier: "NORMAL", quick: true },
  { code: "heok", label: "헉", glyph: "😱", tier: "NORMAL" },
  { code: "meltdown", label: "멘붕", glyph: "💥", tier: "NORMAL" },
  { code: "seungbu", label: "승부", glyph: "⚔️", tier: "NORMAL" },
  { code: "clap", label: "박수", glyph: "👏", tier: "NORMAL" },
  { code: "gwang", label: "광땡", glyph: "🌕", tier: "RARE" },
  { code: "angel-heart", label: "천사하트", glyph: "💗", tier: "RARE" },
  { code: "wing", label: "날개", glyph: "🕊️", tier: "RARE" },
  { code: "flame", label: "불꽃", glyph: "🔥", tier: "RARE" },
  { code: "money", label: "돈다발", glyph: "💰", tier: "RARE" },
];

const BY_CODE = new Map(EMOTICONS.map((e) => [e.code, e]));

export function getEmoticon(code: string): Emoticon | null {
  return BY_CODE.get(code) ?? null;
}

/** 보유 목록 기준 사용 가능한 이모티콘 (RARE 확장 대비 · 기본은 전체 허용) */
export function availableEmoticons(ownedCodes?: readonly string[]): Emoticon[] {
  if (!ownedCodes) return EMOTICONS;
  return EMOTICONS.filter((e) => e.tier === "NORMAL" || ownedCodes.includes(e.code));
}

export const AUTO_WIN_REACTION_KEY = "angel-sutda.reaction.autoWin";
export const AUTO_WIN_REACTION_CODE = "nice";

export function isAutoWinReactionOn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_WIN_REACTION_KEY) === "on";
}

export function setAutoWinReaction(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTO_WIN_REACTION_KEY, on ? "on" : "off");
}
