/**
 * opsService — 운영 안전장치(APP MODE · 점검 모드 · 게임 잠금) 클라이언트.
 *
 * 모든 값은 서버(app_settings)가 source of truth이며, 클라이언트는 표시/안내만 담당한다.
 * 실제 차단은 DB RPC(join_room, start_game_round, request_charge_with_ticket, request_withdrawal)에서 수행된다.
 */
import { supabase } from "@/integrations/supabase/client";

export type AppMode = "DEVELOPMENT" | "TEST" | "PRODUCTION";

export interface OpsStatus {
  appMode: AppMode;
  maintenance: boolean;
  maintenanceMessage: string;
  gameLock: boolean;
  blockCharge: boolean;
  blockWithdraw: boolean;
  blockLogin: boolean;
  chargeEnabled: boolean;
  withdrawEnabled: boolean;
}

export const DEFAULT_MAINTENANCE_MESSAGE =
  "현재 서버 점검 중입니다. 진행 중인 게임은 정상 종료되며 새로운 게임 입장은 잠시 제한됩니다.";

export const OPS_KEYS = {
  appMode: "app_mode",
  maintenance: "maintenance_enabled",
  maintenanceMessage: "maintenance_message",
  gameLock: "game_lock",
  blockCharge: "maintenance_block_charge",
  blockWithdraw: "maintenance_block_withdraw",
  blockLogin: "maintenance_block_login",
  chargeEnabled: "charge_enabled",
  withdrawEnabled: "withdraw_enabled",
} as const;

function asBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return fallback;
}

/** 운영 상태 조회 (비로그인 사용자도 조회 가능) */
export async function fetchOpsStatus(): Promise<OpsStatus> {
  const { data, error } = await supabase.rpc("ops_status");
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  const mode = String(raw[OPS_KEYS.appMode] ?? "PRODUCTION").toUpperCase();
  return {
    appMode: (["DEVELOPMENT", "TEST", "PRODUCTION"].includes(mode) ? mode : "PRODUCTION") as AppMode,
    maintenance: asBool(raw[OPS_KEYS.maintenance]),
    maintenanceMessage:
      typeof raw[OPS_KEYS.maintenanceMessage] === "string" && raw[OPS_KEYS.maintenanceMessage]
        ? String(raw[OPS_KEYS.maintenanceMessage])
        : DEFAULT_MAINTENANCE_MESSAGE,
    gameLock: asBool(raw[OPS_KEYS.gameLock]),
    blockCharge: asBool(raw[OPS_KEYS.blockCharge]),
    blockWithdraw: asBool(raw[OPS_KEYS.blockWithdraw]),
    blockLogin: asBool(raw[OPS_KEYS.blockLogin]),
    chargeEnabled: asBool(raw[OPS_KEYS.chargeEnabled], true),
    withdrawEnabled: asBool(raw[OPS_KEYS.withdrawEnabled], true),
  };
}

/** 오류 심각도 — 정상 거부(사용자 입력)와 실제 시스템 오류를 구분한다. */
export type GameErrorSeverity = "EXPECTED_REJECTION" | "SYSTEM_ERROR";

export interface NormalizedGameError {
  /** 서버/RPC가 준 code 또는 메시지에서 판별한 구조적 code */
  code: string;
  /** 사람이 읽을 수 있는 원문 메시지 (절대 "[object Object]"가 되지 않는다) */
  message: string;
  severity: GameErrorSeverity;
  /** DB 부가 정보 (PostgrestError details/hint 등) */
  details?: string | null;
  hint?: string | null;
}

/** 서버가 의도적으로 던지는 정상 거부 메시지 → 구조적 code */
const EXPECTED_REJECTIONS: [RegExp, string][] = [
  [/차례가 아닙니다|당신의 차례|turn/i, "NOT_YOUR_TURN"],
  [/이미 처리|중복|duplicate key value|already exists/i, "DUPLICATE_ACTION"],
  [/포인트가 부족|잔액이 부족|insufficient/i, "INSUFFICIENT_POINTS"],
  [
    /진행 중인 (판|라운드)가 아닙니다|이미 종료된 (판|라운드)|라운드를 찾을 수 없|round not found|round already (finished|ended)/i,
    "ROUND_NOT_ACTIVE",
  ],
  [/좌석|착석|관전/i, "SEAT_STATE_INVALID"],
  [/선택할 수 없|허용되지 않는|가능한 행동이 아닙니다|잘못된 행동/i, "ACTION_NOT_ALLOWED"],
  [/점검 중|게임이 잠(겨|금)/i, "OPS_LOCKED"],
  [/시간이 초과|deadline/i, "TURN_EXPIRED"],
  // 다른 참가자가 먼저 단계를 넘긴 뒤 도착한 요청 — 서버가 상태를 지킨 정상 거부
  [/^INVALID_PHASE_TRANSITION$|INVALID_PHASE_TRANSITION/i, "PHASE_ALREADY_ADVANCED"],
  // 서버(RPC)가 대문자 코드 문자열로 던지는 정상 거부들
  [/ALREADY_IN_ANOTHER_ROOM/i, "ALREADY_IN_ANOTHER_ROOM"],
  [/ROUND_NOT_ACTIVE|ROUND_NOT_FOUND|ROUND_ALREADY_FINISHED/i, "ROUND_NOT_ACTIVE"],
  [/SEAT_TAKEN|ALREADY_SEATED|NOT_SEATED|ROOM_FULL|INVALID_SEAT/i, "SEAT_STATE_INVALID"],
  [/ALREADY_SUBMITTED|INVALID_MAKE|MAKE_NOT_ALLOWED|BET_NOT_ALLOWED|RAISE_LIMIT/i,
    "ACTION_NOT_ALLOWED"],
  [/WRONG_PASSWORD|MIN_POINTS_REQUIRED|ROOM_CLOSED|ROOM_NOT_FOUND/i, "ENTRY_REJECTED"],
];

function pickString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * 어떤 형태의 오류(Error · PostgrestError · 문자열 · 임의 객체)든
 * code / message / severity 로 구조화한다.
 * 객체를 String()·템플릿 문자열로 직렬화하지 않으므로 "[object Object]"가 생기지 않는다.
 */
export function normalizeGameError(error: unknown): NormalizedGameError {
  let code: string | null = null;
  let message: string | null = null;
  let details: string | null = null;
  let hint: string | null = null;

  if (typeof error === "string") {
    message = error.trim() || null;
  } else if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    message = pickString(obj, "message");
    code = pickString(obj, "code");
    details = pickString(obj, "details");
    hint = pickString(obj, "hint");
    if (!message) message = pickString(obj, "error_description") ?? pickString(obj, "error");
    if (!message) {
      // 알려진 필드가 없을 때만 JSON으로 보존한다 (String(obj) 금지)
      try {
        const json = JSON.stringify(obj);
        if (json && json !== "{}") message = json;
      } catch {
        /* 순환 참조 등은 무시 */
      }
    }
  } else if (typeof error === "number" || typeof error === "boolean") {
    message = String(error);
  }

  if (!message) message = "알 수 없는 오류가 발생했습니다.";

  const haystack = [message, details, hint].filter(Boolean).join(" ｜ ");
  let severity: GameErrorSeverity = "SYSTEM_ERROR";
  for (const [pattern, rejectionCode] of EXPECTED_REJECTIONS) {
    if (pattern.test(haystack)) {
      severity = "EXPECTED_REJECTION";
      // PostgREST의 일반 코드(P0001/23505 등)보다 의미 있는 code를 우선한다.
      if (!code || /^(P0001|23505|PGRST\d+)$/i.test(code)) code = rejectionCode;
      break;
    }
  }

  return { code: code ?? (severity === "EXPECTED_REJECTION" ? "EXPECTED_REJECTION" : "SYSTEM_ERROR"), message, severity, details, hint };
}

/**
 * 게임 RPC 실패 기록 — 원문 오류는 관리자 로그에만 남는다.
 * `error`를 넘기면 code/message/severity가 자동으로 구조화된다.
 */
export async function logGameError(input: {
  fn: string;
  error?: unknown;
  message?: string;
  code?: string | null;
  severity?: GameErrorSeverity;
  roundId?: string | null;
  roomId?: string | null;
  phase?: string | null;
  action?: string | null;
  retried?: boolean;
  metadata?: Record<string, unknown>;
}) {
  try {
    const normalized =
      input.error !== undefined
        ? normalizeGameError(input.error)
        : normalizeGameError(input.message ?? null);
    const message = (input.message && input.error === undefined ? input.message : normalized.message).slice(0, 2000);
    const code = input.code ?? normalized.code;
    const severity = input.severity ?? normalized.severity;
    const args: Record<string, unknown> = {
      _fn: input.fn,
      _error_message: message,
      _retried: input.retried ?? false,
      _metadata: {
        severity,
        ...(normalized.details ? { details: normalized.details } : {}),
        ...(normalized.hint ? { hint: normalized.hint } : {}),
        ...(input.metadata ?? {}),
      },
    };
    if (code) args["_error_code"] = code;
    if (input.roundId) args["_round_id"] = input.roundId;
    if (input.roomId) args["_room_id"] = input.roomId;
    if (input.phase) args["_phase"] = input.phase;
    if (input.action) args["_action"] = input.action;
    await supabase.rpc("log_game_error", args as never);
  } catch {
    /* 로그 실패가 게임 흐름을 막지 않는다 */
  }
}


const FRIENDLY_PATTERNS: [RegExp, string][] = [
  // 내부 코드가 그대로 사용자 화면에 뜨지 않도록 안내 문구로 변환한다.
  [/NOT_YOUR_TURN/i, "현재 차례가 아닙니다."],
  [/INSUFFICIENT_(BALANCE|POINTS)|NOT_ENOUGH_POINTS/i, "보유 포인트가 부족합니다."],
  [/ALREADY_PEELED/i, "이미 확인한 패입니다."],
  [/ROUND_NOT_ACTIVE|ROUND_NOT_FOUND|ROUND_ALREADY_FINISHED/i, "진행 중인 판이 아닙니다."],
  [/ROUND_PAUSED|CARD_INTEGRITY/i, "판이 일시 중지되었습니다. 관리자에게 문의해 주세요."],
  [/NOT_A_PARTICIPANT|NOT_IN_ROOM/i, "이 방의 참가자가 아닙니다."],
  [/SEAT_(TAKEN|OCCUPIED)|SEAT_UNAVAILABLE/i, "이미 사용 중인 자리입니다."],
  [/LEAVE_PENDING|LONG_ABSENCE/i, "퇴장 처리가 진행 중입니다."],
  [/INVALID_(PHASE_TRANSITION|BET|AMOUNT)|STALE_ACTION|ROUND_PHASE_CHANGED/i,
    "요청을 처리할 수 없습니다. 화면을 새로 고쳐 주세요."],
  [/MIN_ENTRY|BELOW_MIN_ENTRY/i, "이 방의 최소 입장 포인트가 부족합니다."],
  [/duplicate key value|already exists/i, "이미 처리된 요청입니다."],
  [/permission denied|violates row-level security/i, "권한이 없는 요청입니다."],
  [/deadlock detected|could not serialize/i, "잠시 후 다시 시도해 주세요."],
  [/violates (check|not-null|foreign key) constraint/i, "요청 값을 다시 확인해 주세요."],
  [/JWT|token is expired|invalid claim/i, "로그인이 만료되었습니다. 다시 로그인해 주세요."],
  [/fetch failed|NetworkError|Failed to fetch|timeout/i, "서버와 통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요."],
];

/** DB 원문 오류를 사용자 안내 문구로 변환 (원문은 서버 로그에만 남는다) */
export function friendlyErrorMessage(error: unknown, fallback = "요청을 처리할 수 없습니다.") {
  if (error === null || error === undefined) return fallback;
  const raw = normalizeGameError(error).message;
  if (!raw || raw === "알 수 없는 오류가 발생했습니다.") return fallback;

  for (const [pattern, message] of FRIENDLY_PATTERNS) {
    if (pattern.test(raw)) return message;
  }
  // 서버에서 의도적으로 한국어 안내 문구를 던진 경우는 그대로 노출한다.
  if (/[가-힣]/.test(raw)) return raw;
  return fallback;
}
