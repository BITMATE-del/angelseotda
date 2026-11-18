/**
 * USDT/KRW 환율 조회 (Google Sheets 공개 시트 기준).
 * - 시트 값을 읽어 서버에서만 스냅샷을 만들고 app_settings에 캐시한다.
 * - 회원 화면은 절대 환율을 직접 만들지 않는다. (서버 스냅샷만 사용)
 */

export interface RateSnapshot {
  rate: number;
  source: "sheet" | "cache";
  fetchedAt: string;
}

/** 정상 환율 허용 범위 — 비정상적으로 작거나 큰 값은 절대 저장하지 않는다. */
export const RATE_MIN = 100;
export const RATE_MAX = 100_000;

export function parseRate(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < RATE_MIN || n > RATE_MAX) return null;
  return n;
}

/** Google Sheets gviz 엔드포인트에서 지정 셀 값을 읽는다. */
export async function fetchSheetRate(
  sheetId: string,
  gid: string,
  cell: string,
): Promise<number> {
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq` +
    `?gid=${encodeURIComponent(gid || "0")}&tq=${encodeURIComponent(`select * limit 50`)}`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`SHEET_HTTP_${res.status}`);
  const text = await res.text();
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as {
    table?: { rows?: { c?: ({ v?: unknown; f?: string } | null)[] }[] };
  };
  const rows = parsed.table?.rows ?? [];

  const m = /^([A-Za-z]+)(\d+)$/.exec(cell.trim() || "A1");
  const colLetters = (m?.[1] ?? "A").toUpperCase();
  const rowNumber = Number(m?.[2] ?? "1");
  let col = 0;
  for (const ch of colLetters) col = col * 26 + (ch.charCodeAt(0) - 64);
  col -= 1;

  const target = rows[rowNumber - 1]?.c?.[col];
  const rawValue = target?.v ?? target?.f;
  if (rawValue === undefined || rawValue === null) throw new Error("SHEET_CELL_EMPTY");
  const rate =
    typeof rawValue === "number" ? parseRate(String(rawValue)) : parseRate(String(rawValue));
  if (!rate || rate < RATE_MIN || rate > RATE_MAX) throw new Error("SHEET_RATE_INVALID");
  return rate;
}

/**
 * 환율 스냅샷을 만든다. 시트 조회 실패 시 최근 정상 캐시를 사용한다.
 * 캐시도 없으면 신청을 만들지 않기 위해 예외를 던진다.
 */
export async function getRateSnapshot(): Promise<RateSnapshot> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "crypto_rate_sheet_id",
      "crypto_rate_sheet_gid",
      "crypto_rate_cell",
      "crypto_rate_cache",
      "crypto_rate_cached_at",
    ]);
  const map = new Map((data ?? []).map((r) => [r.key, r.value as unknown]));
  const sheetId = String(map.get("crypto_rate_sheet_id") ?? "");
  const gid = String(map.get("crypto_rate_sheet_gid") ?? "0");
  const cell = String(map.get("crypto_rate_cell") ?? "A1");
  const cached = Number(map.get("crypto_rate_cache") ?? 0);
  const cachedAt = map.get("crypto_rate_cached_at");

  if (sheetId) {
    try {
      const rate = await fetchSheetRate(sheetId, gid, cell);
      const now = new Date().toISOString();
      await supabaseAdmin.from("app_settings").upsert(
        [
          { key: "crypto_rate_cache", value: rate as never, updated_at: now },
          { key: "crypto_rate_cached_at", value: now as never, updated_at: now },
          { key: "crypto_rate_error", value: null as never, updated_at: now },
        ],
        { onConflict: "key" },
      );
      return { rate, source: "sheet", fetchedAt: now };
    } catch (e) {
      const now = new Date().toISOString();
      await supabaseAdmin.from("app_settings").upsert(
        [{ key: "crypto_rate_error", value: String((e as Error).message) as never, updated_at: now }],
        { onConflict: "key" },
      );
    }
  }

  if (cached >= RATE_MIN && cached <= RATE_MAX) {
    return {
      rate: cached,
      source: "cache",
      fetchedAt: typeof cachedAt === "string" ? cachedAt : new Date().toISOString(),
    };
  }
  throw new Error("RATE_UNAVAILABLE");
}
