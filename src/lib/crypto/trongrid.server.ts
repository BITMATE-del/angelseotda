/**
 * TronGrid Mainnet 공용 클라이언트 — 서버 전용.
 * - 모든 TRON 조회는 이 파일을 통해서만 수행한다(API Key 누락 방지).
 * - API Key는 서버 Secret(TRONGRID_API_KEY)에서만 읽고 응답/로그에 남기지 않는다.
 * - 429는 지수 backoff, 그 외 오류는 종류만 분류해 노출한다.
 */

export const TRONGRID_BASE = "https://api.trongrid.io";

const TIMEOUT_MS = 12_000;
const MAX_RETRY = 4; // 1s → 2s → 4s → 8s

export type TronErrorKind =
  | "AUTH" // 401/403
  | "RATE_LIMIT" // 429
  | "SERVER" // 5xx
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_PAYLOAD";

export class TronGridError extends Error {
  kind: TronErrorKind;
  status: number | undefined;
  constructor(kind: TronErrorKind, status?: number) {
    super(status ? `TRONGRID_${kind}_${status}` : `TRONGRID_${kind}`);
    this.kind = kind;
    this.status = status;
  }
}

/** API Key 설정 여부만 노출한다(값은 절대 반환하지 않는다). */
export function isTronGridKeyConfigured(): boolean {
  return !!process.env["TRONGRID_API_KEY"];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** TronGrid 공용 요청 — API Key 헤더/timeout/backoff를 항상 적용한다. */
export async function tronGridFetch<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const apiKey = process.env["TRONGRID_API_KEY"];
  const url = path.startsWith("http") ? path : `${TRONGRID_BASE}${path}`;

  let lastError: TronGridError = new TronGridError("NETWORK");
  for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (apiKey) headers["TRON-PRO-API-KEY"] = apiKey;
      if (init?.body !== undefined) headers["content-type"] = "application/json";

      const res = await fetch(url, {
        method: init?.method ?? "GET",
        headers,
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) throw new TronGridError("AUTH", res.status);
      if (res.status === 429) {
        lastError = new TronGridError("RATE_LIMIT", 429);
        if (attempt === MAX_RETRY) break;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.status >= 500) {
        lastError = new TronGridError("SERVER", res.status);
        if (attempt === MAX_RETRY) break;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new TronGridError("INVALID_PAYLOAD", res.status);

      try {
        return (await res.json()) as T;
      } catch {
        throw new TronGridError("INVALID_PAYLOAD", res.status);
      }
    } catch (e) {
      if (e instanceof TronGridError) {
        if (e.kind === "AUTH" || e.kind === "INVALID_PAYLOAD") throw e;
        lastError = e;
      } else if ((e as Error)?.name === "AbortError") {
        lastError = new TronGridError("TIMEOUT");
      } else {
        lastError = new TronGridError("NETWORK");
      }
      if (attempt === MAX_RETRY) break;
      await sleep(1000 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** 현재 블록 번호 */
export async function tronNowBlock(): Promise<number> {
  const json = await tronGridFetch<{ block_header?: { raw_data?: { number?: number } } }>(
    "/wallet/getnowblock",
    { method: "POST", body: {} },
  );
  const n = json.block_header?.raw_data?.number ?? 0;
  if (!n) throw new TronGridError("INVALID_PAYLOAD");
  return n;
}

export interface TronDiagnostics {
  key_configured: boolean;
  auth_ok: boolean;
  block: number | null;
  latency_ms: number | null;
  address_query_ok: boolean;
  error_kind: TronErrorKind | null;
  error_status: number | null;
}

/** 관리자 [TRON 조회 테스트] — 실제 Mainnet 요청으로 인증/블록/주소조회를 확인한다. */
export async function tronGridDiagnostics(address?: string | null): Promise<TronDiagnostics> {
  const out: TronDiagnostics = {
    key_configured: isTronGridKeyConfigured(),
    auth_ok: false,
    block: null,
    latency_ms: null,
    address_query_ok: false,
    error_kind: null,
    error_status: null,
  };
  const started = Date.now();
  try {
    out.block = await tronNowBlock();
    out.auth_ok = true;
    out.latency_ms = Date.now() - started;
  } catch (e) {
    out.latency_ms = Date.now() - started;
    if (e instanceof TronGridError) {
      out.error_kind = e.kind;
      out.error_status = e.status ?? null;
    } else {
      out.error_kind = "NETWORK";
    }
    return out;
  }

  if (address) {
    try {
      await tronGridFetch(
        `/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?only_to=true&limit=1`,
      );
      out.address_query_ok = true;
    } catch (e) {
      if (e instanceof TronGridError) {
        out.error_kind = e.kind;
        out.error_status = e.status ?? null;
      }
    }
  }
  return out;
}
