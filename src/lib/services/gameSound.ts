/**
 * GameSoundManager — 게임 사운드 단일 진입점.
 *
 * 원칙
 * - 모든 음원은 ANGEL SUTDA 자체 제작(합성) 에셋이다. 외부 게임 음원을 복사하지 않는다.
 *   (생성 스크립트: scripts/generate-game-audio.mjs)
 * - 컴포넌트는 절대 new Audio()를 직접 만들지 않고 playAction / playHand / playEvent 만 호출한다.
 * - 서버 액션이 "확정"된 뒤에만 호출한다 (실패한 베팅에서 소리가 나면 안 된다).
 * - 같은 event key는 dedupe되어 realtime refetch/재연결로 중복 재생되지 않는다.
 * - 동시에 여러 이벤트가 발생하면 우선순위가 낮은 보이스는 재생하지 않는다.
 */

/* ─────────── 에셋 키 ─────────── */

/** 효과음(SFX) — 짧은 UI/임팩트 사운드 */
export type SfxKey =
  | "bet-call"
  | "bet-bbing"
  | "bet-ddadang"
  | "bet-quarter"
  | "bet-half"
  | "bet-allin"
  | "bet-fold"
  | "bet-check"
  | "card-deal"
  | "round-start"
  | "peel-start"
  | "hand-submit"
  | "turn-start"
  | "side-pot"
  | "showdown"
  | "winner"
  | "rematch"
  | "gusa"
  | "pot-impact"
  | "pot-win"
  | "gwang-38"
  | "gwang-18"
  | "gwang-13";

/** 보이스(한국어) — 액션/족보 음성 */
export type VoiceKey =
  | "voice-check"
  | "voice-bbing"
  | "voice-call"
  | "voice-ddadang"
  | "voice-quarter"
  | "voice-half"
  | "voice-allin"
  | "voice-die"
  | "voice-jjol"
  | "voice-gwang38"
  | "voice-gwang18"
  | "voice-gwang13"
  | "voice-ddaeng10"
  | "voice-ddaeng9"
  | "voice-ddaeng8"
  | "voice-ddaeng7"
  | "voice-ddaeng6"
  | "voice-ddaeng5"
  | "voice-ddaeng4"
  | "voice-ddaeng3"
  | "voice-ddaeng2"
  | "voice-ddaeng1"
  | "voice-ali"
  | "voice-doksa"
  | "voice-gubing"
  | "voice-jangbing"
  | "voice-jangsa"
  | "voice-seryuk"
  | "voice-gapo"
  | "voice-mangtong"
  | "voice-amhaeng"
  | "voice-ddaengjabi"
  | "voice-gusa"
  | "voice-meongtong-gusa"
  | "voice-rematch"
  | "voice-winner"
  | "voice-showdown"
  /** 내 턴 / 선택 단계 알림 (UX 전용) */
  | "voice-your-turn"
  | "voice-select-open-card"
  | "voice-select-final-hand"
  | "voice-select-dori-hand"
  | "voice-time-warning";

export type GameSoundKey = SfxKey | VoiceKey;

/** 기존 호출 호환용 alias */
export type LegacySoundKey = GameSoundKey;

/* ─────────── 설정 (localStorage 유지) ─────────── */

const ENABLED_KEY = "angel-sutda.sound.enabled";
const MASTER_KEY = "angel-sutda.sound.volume"; // 전체 음량 (기존 키 재사용)
const SFX_KEY = "angel-sutda.sound.sfxVolume";
const VOICE_KEY = "angel-sutda.sound.voiceVolume";
const DEFAULT_VOLUME = 0.7;

function readVolume(key: string, fallback = DEFAULT_VOLUME) {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored === null || stored.trim() === "") return fallback;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
}
function writeVolume(key: string, v: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, String(Math.min(1, Math.max(0, v))));
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) !== "off";
}
export function setSoundEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
}

/** 전체 음량 */
export const getSoundVolume = () => readVolume(MASTER_KEY);
export const setSoundVolume = (v: number) => writeVolume(MASTER_KEY, v);
/** 효과음 음량 */
export const getSfxVolume = () => readVolume(SFX_KEY, 1);
export const setSfxVolume = (v: number) => writeVolume(SFX_KEY, v);
/** 보이스 음량 */
export const getVoiceVolume = () => readVolume(VOICE_KEY, 1);
export const setVoiceVolume = (v: number) => writeVolume(VOICE_KEY, v);

/* ─────────── 재생 코어 ─────────── */

const cache = new Map<GameSoundKey, HTMLAudioElement>();
const isVoice = (key: GameSoundKey) => key.startsWith("voice-");

/**
 * 보이스 체감 음량 보정 — 효과음보다 확실히 들리도록 1.6배.
 * (음원 자체는 피크 -2dBFS 로 정규화되어 있어 clipping 이 발생하지 않는다)
 */
const VOICE_GAIN = 1.6;
/** 보이스 재생 중 효과음 살짝 줄이기 (ducking) */
const SFX_DUCK = 0.75;

/** Audio 객체 재사용 — 클릭마다 new Audio()/네트워크 fetch 를 하지 않는다 */
function getAudio(key: GameSoundKey): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let audio = cache.get(key);
  if (!audio) {
    audio = new Audio(`/audio/game/${key}.mp3`);
    audio.preload = "auto";
    cache.set(key, audio);
    try {
      audio.load();
    } catch {
      /* ignore */
    }
  }
  return audio;
}

function play(key: GameSoundKey) {
  if (typeof window === "undefined" || !isSoundEnabled()) return;
  try {
    const audio = getAudio(key);
    if (!audio) return;
    const voice = isVoice(key);
    const channel = voice
      ? getVoiceVolume() * VOICE_GAIN
      : getSfxVolume() * (Date.now() < voiceBusyUntil ? SFX_DUCK : 1);
    audio.volume = Math.min(1, Math.max(0, getSoundVolume() * channel));
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    /* 사운드 실패는 게임 흐름에 영향을 주지 않는다 */
  }
}

/** 기존 코드 호환용 단순 재생 */
export function playGameSound(key: GameSoundKey) {
  play(key);
}

/* ─────────── preload · autoplay unlock ─────────── */

/** 게임방에서 가장 자주 쓰는 음원 (클릭 즉시 재생 대상) */
const PRELOAD_KEYS: GameSoundKey[] = [
  "voice-check",
  "voice-call",
  "voice-bbing",
  "voice-ddadang",
  "voice-quarter",
  "voice-half",
  "voice-allin",
  "voice-die",
  "voice-your-turn",
  "bet-check",
  "bet-call",
  "bet-bbing",
  "bet-ddadang",
  "bet-quarter",
  "bet-half",
  "bet-allin",
  "bet-fold",
  "turn-start",
  "card-deal",
];

let preloaded = false;

/** 게임방 입장 시 1회 호출 — 클릭 후 첫 fetch 지연을 없앤다 */
export function preloadGameSounds(extra: GameSoundKey[] = []) {
  if (typeof window === "undefined" || preloaded) return;
  preloaded = true;
  for (const key of [...PRELOAD_KEYS, ...extra]) getAudio(key);
}

let unlocked = false;

/**
 * 첫 사용자 제스처에서 autoplay 정책을 해제한다.
 * (무음으로 한 번 재생 → 이후 첫 액션 음성이 늦거나 실패하지 않는다)
 */
export function unlockAudioPlayback() {
  if (typeof window === "undefined" || unlocked) return;
  unlocked = true;
  preloadGameSounds();
  for (const key of ["voice-check", "bet-check"] as GameSoundKey[]) {
    const audio = getAudio(key);
    if (!audio) continue;
    const vol = audio.volume;
    audio.volume = 0;
    void audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = vol;
      })
      .catch(() => {
        audio.volume = vol;
      });
  }
}

/* ─────────── 우선순위 · 중복 방지 ─────────── */

/**
 * 보이스 우선순위 (높을수록 우선).
 * 특수/상위 족보 > WINNER > ALL-IN > 일반 베팅 액션
 */
const PRIORITY: Record<string, number> = {
  hand: 40,
  winner: 30,
  /**
   * 내 턴 알림 — 직전에 재생된 상대 액션 보이스(action/allin)보다 우선한다.
   * 같은 tier 로 두면 "상대 액션 → 내 턴" 전환에서 항상 억제되어 알림이 들리지 않는다.
   */
  turn: 25,
  allin: 20,
  action: 10,
  event: 5,
};

let voiceBusyUntil = 0;
let voiceBusyPriority = 0;
const played = new Set<string>();

/** 이벤트 dedupe — 같은 key는 한 번만 재생된다 */
function once(key: string | null | undefined): boolean {
  if (!key) return true;
  if (played.has(key)) return false;
  played.add(key);
  if (played.size > 800) {
    // 오래된 key 정리 (라운드가 계속 진행되어도 메모리가 늘지 않게)
    for (const k of [...played].slice(0, 400)) played.delete(k);
  }
  return true;
}

/** 라운드 전환 시 dedupe 캐시 초기화 (선택) */
export function resetSoundDedupe(prefix?: string) {
  if (!prefix) {
    played.clear();
    return;
  }
  for (const k of [...played]) if (k.startsWith(prefix)) played.delete(k);
}

function playVoice(key: VoiceKey, tier: keyof typeof PRIORITY, delayMs = 0) {
  const priority = PRIORITY[tier] ?? 0;
  const now = Date.now();
  // 이미 더 중요한 보이스가 재생 중이면 겹쳐서 재생하지 않는다
  if (now < voiceBusyUntil && priority <= voiceBusyPriority) return;
  voiceBusyUntil = now + delayMs + 1100;
  voiceBusyPriority = priority;
  if (delayMs > 0) window.setTimeout(() => play(key), delayMs);
  else play(key);
}

/* ─────────── 액션 사운드 ─────────── */

type ActionCode =
  | "check"
  | "call"
  | "ping"
  | "ttadang"
  | "quarter"
  | "half"
  | "all_in"
  | "die"
  | "jjol"
  | "ante";

const ACTION_SFX: Record<string, SfxKey> = {
  call: "bet-call",
  ping: "bet-bbing",
  ttadang: "bet-ddadang",
  quarter: "bet-quarter",
  half: "bet-half",
  all_in: "bet-allin",
  die: "bet-fold",
  jjol: "bet-fold",
  check: "bet-check",
  ante: "card-deal",
};

const ACTION_VOICE: Record<string, VoiceKey> = {
  call: "voice-call",
  ping: "voice-bbing",
  ttadang: "voice-ddadang",
  quarter: "voice-quarter",
  half: "voice-half",
  all_in: "voice-allin",
  die: "voice-die",
  jjol: "voice-jjol",
  check: "voice-check",
};

/** 기존 코드 호환 (action → 효과음 키) */
export const ACTION_SOUND = ACTION_SFX;

/**
 * 내 클릭으로 이미 재생한 액션 — 같은 액션의 서버 확정 사운드를 1회 흡수한다.
 * (클릭 1회 + Realtime 1회 = 2번 들리는 문제 방지)
 */
const selfPlayed = new Map<string, number>();
const SELF_WINDOW_MS = 6000;

/**
 * 버튼 클릭 즉시 재생 (RPC 호출 전).
 * 호출 조건: 버튼이 활성 상태이고 클라이언트 검증을 통과한 정상 클릭일 때만.
 * 서버 확정 후의 playAction 은 같은 액션 1건을 건너뛴다.
 */
export function playActionLocal(action: string) {
  const code = action.toLowerCase();
  if (!ACTION_VOICE[code] && !ACTION_SFX[code]) return;
  selfPlayed.set(code, Date.now() + SELF_WINDOW_MS);
  const sfx = ACTION_SFX[code];
  if (sfx) play(sfx);
  const voice = ACTION_VOICE[code];
  if (voice) playVoice(voice, code === "all_in" ? "allin" : "action", 0);
}

/**
 * 서버에서 확정된 베팅 액션 1건 재생.
 * @param eventId 서버 action id — 같은 id는 다시 재생되지 않는다.
 */
export function playAction(action: string, eventId?: string, isMine = true) {
  const code = action.toLowerCase() as ActionCode;
  if (!once(eventId ? `action:${eventId}` : null)) return;
  // 내 액션일 때만 클릭 즉시 재생분을 흡수한다 (상대 같은 액션 소리는 그대로 재생)
  const selfUntil = isMine ? selfPlayed.get(code) : undefined;
  if (selfUntil !== undefined) {
    selfPlayed.delete(code);
    if (Date.now() < selfUntil) return;
  }
  const sfx = ACTION_SFX[code];
  if (sfx) play(sfx);
  const voice = ACTION_VOICE[code];
  if (voice) playVoice(voice, code === "all_in" ? "allin" : "action", 90);
}

/* ─────────── 족보 보이스 ─────────── */

/** 서버 hand_code → 보이스 (프론트가 카드 그래픽으로 판단하지 않는다) */
const HAND_VOICE: Record<string, VoiceKey> = {
  kwang38: "voice-gwang38",
  kwang18: "voice-gwang18",
  kwang13: "voice-gwang13",
  ttaeng10: "voice-ddaeng10",
  ttaeng9: "voice-ddaeng9",
  ttaeng8: "voice-ddaeng8",
  ttaeng7: "voice-ddaeng7",
  ttaeng6: "voice-ddaeng6",
  ttaeng5: "voice-ddaeng5",
  ttaeng4: "voice-ddaeng4",
  ttaeng3: "voice-ddaeng3",
  ttaeng2: "voice-ddaeng2",
  ttaeng1: "voice-ddaeng1",
  ali: "voice-ali",
  doksa: "voice-doksa",
  gupping: "voice-gubing",
  jangping: "voice-jangbing",
  jangsa: "voice-jangsa",
  seryuk: "voice-seryuk",
  kkeut9: "voice-gapo",
  kkeut0: "voice-mangtong",
  gusa: "voice-gusa",
  gusa_meong: "voice-meongtong-gusa",
  gusa_meongteong: "voice-meongtong-gusa",
  mung_gusa: "voice-meongtong-gusa",
  ttaengjabi: "voice-ddaengjabi",
  amhaeng: "voice-amhaeng",
  amhaengeosa: "voice-amhaeng",
  ddaengjabi: "voice-ddaengjabi",
  jabi: "voice-ddaengjabi",
};

/** 광땡 전용 임팩트 효과음 (기존 호출 호환) */
export function gwangSound(handCode: string | null | undefined): SfxKey | null {
  switch (handCode) {
    case "kwang38":
      return "gwang-38";
    case "kwang18":
      return "gwang-18";
    case "kwang13":
      return "gwang-13";
    default:
      return null;
  }
}

/**
 * 서버 판정 결과(hand_code) 기준 족보 보이스.
 * @param eventId 라운드 id 등 dedupe key
 */
export function playHand(handCode: string | null | undefined, eventId?: string) {
  if (!handCode) return;
  const code = handCode.toLowerCase();
  const voice =
    HAND_VOICE[code] ??
    (code.startsWith("gusa_meong") || code.startsWith("mung_gusa")
      ? "voice-meongtong-gusa"
      : code.startsWith("gusa") ? "voice-gusa" : code.startsWith("amhaeng") ? "voice-amhaeng" : null);
  if (!voice) return;
  if (!once(eventId ? `hand:${eventId}:${code}` : null)) return;
  const impact = gwangSound(code);
  if (impact) play(impact);
  playVoice(voice, "hand", impact ? 260 : 60);
}

/* ─────────── 특수 이벤트 ─────────── */

export type GameEvent =
  | "ROUND_START"
  | "CARD_DEAL"
  | "CARD_FIRST"
  | "CARD_SECOND"
  /** 3장 섯다 — 세 번째 패 지급 */
  | "CARD_THIRD"
  | "PEEL_START"
  | "TURN_START"
  /** 3장 섯다 — 최종 승부패 선택 단계 진입 */
  | "FINAL_SELECT"
  | "HAND_SUBMIT"
  | "SHOWDOWN"
  | "WINNER"
  | "ROUND_LOSE"
  | "REMATCH"
  | "SIDE_POT"
  | "POT_WIN"
  | "POT_INCREASE"
  | "POT_IMPACT";

const EVENT_SFX: Record<GameEvent, SfxKey> = {
  ROUND_START: "round-start",
  CARD_DEAL: "card-deal",
  CARD_FIRST: "card-deal",
  CARD_SECOND: "card-deal",
  CARD_THIRD: "card-deal",
  PEEL_START: "peel-start",
  TURN_START: "turn-start",
  FINAL_SELECT: "turn-start",
  HAND_SUBMIT: "hand-submit",
  SHOWDOWN: "showdown",
  WINNER: "winner",
  ROUND_LOSE: "bet-fold",
  REMATCH: "rematch",
  SIDE_POT: "side-pot",
  POT_WIN: "pot-win",
  POT_INCREASE: "pot-impact",
  POT_IMPACT: "pot-impact",
};

const EVENT_VOICE: Partial<Record<GameEvent, VoiceKey>> = {
  REMATCH: "voice-rematch",
  WINNER: "voice-winner",
  SHOWDOWN: "voice-showdown",
};

export function playEvent(event: GameEvent, eventId?: string, delayMs = 0) {
  if (!once(eventId ? `event:${event}:${eventId}` : null)) return;
  const sfx = EVENT_SFX[event];
  if (sfx) {
    if (delayMs > 0) window.setTimeout(() => play(sfx), delayMs);
    else play(sfx);
  }
  const voice = EVENT_VOICE[event];
  if (voice) playVoice(voice, event === "WINNER" ? "winner" : "event", delayMs + 220);
}

/** 사운드 ON 토글 시 확인용 짧은 재생 */
export function playSoundPreview() {
  play("bet-check");
}

/* ─────────── 내 턴 알림 (UX 전용 · 게임 로직과 무관) ─────────── */

export type TurnAlertKind = "TURN" | "OPEN_CARD" | "MAKE" | "DORI_MAKE";

const TURN_ALERT_VOICE: Record<TurnAlertKind, VoiceKey> = {
  TURN: "voice-your-turn",
  OPEN_CARD: "voice-select-open-card",
  /** 3장 섯다 최종 승부패 선택 */
  MAKE: "voice-select-final-hand",
  /** 도리짓고땡 짓기 선택 */
  DORI_MAKE: "voice-select-dori-hand",
};

/**
 * 내 턴(또는 내 선택 단계) 시작 알림.
 * @param turnKey 서버 turn 식별자 (round/phase/deadline 조합) — 같은 turn 에서는 1회만 재생된다.
 *
 * 직전 상대 액션 보이스가 재생 중이면 그 뒤로 밀어서 겹치지 않게 재생한다.
 * (같은 tier 로 두면 상대 액션 → 내 턴 전환에서 항상 억제된다)
 */
export function playTurnAlert(kind: TurnAlertKind, turnKey: string) {
  if (!once(`turn-alert:${kind}:${turnKey}`)) return;
  play("turn-start");
  const wait = voiceBusyUntil - Date.now();
  const delay = Math.min(1400, Math.max(120, wait > 0 ? wait + 60 : 120));
  playVoice(TURN_ALERT_VOICE[kind], "turn", delay);
}
