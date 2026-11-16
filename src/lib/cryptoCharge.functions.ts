import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 자동충전 안내 정보 + 서버 환율 스냅샷 (회원 화면 전용, 민감정보 없음) */
export const getCryptoChargeInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .in("key", [
        "crypto_charge_enabled",
        "crypto_deposit_address",
        "crypto_request_ttl_minutes",
        "crypto_min_krw",
        "crypto_max_krw",
        "charge_fee_rate",
        "points_per_won",
      ]);
    const map = new Map((data ?? []).map((r) => [r.key, r.value as unknown]));
    const num = (k: string, d: number) => {
      const v = Number(map.get(k));
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    const enabled = map.get("crypto_charge_enabled") === true || map.get("crypto_charge_enabled") === "true";

    let rate: number | null = null;
    let rateSource: "sheet" | "cache" | null = null;
    let rateAt: string | null = null;
    let rateError: string | null = null;
    try {
      const { getRateSnapshot } = await import("@/lib/crypto/rate.server");
      const snap = await getRateSnapshot();
      rate = snap.rate;
      rateSource = snap.source;
      rateAt = snap.fetchedAt;
    } catch (e) {
      rateError = (e as Error).message;
    }

    return {
      enabled,
      depositAddress: String(map.get("crypto_deposit_address") ?? ""),
      network: "TRC20",
      asset: "USDT",
      ttlMinutes: num("crypto_request_ttl_minutes", 30),
      minKrw: num("crypto_min_krw", 10000),
      maxKrw: num("crypto_max_krw", 5000000),
      feeRate: num("charge_fee_rate", 0.07),
      pointsPerWon: num("points_per_won", 1),
      rate,
      rateSource,
      rateAt,
      rateError,
    };
  });

/** 자동충전 신청 생성 — 환율/고유금액/만료는 100% 서버가 결정한다. */
export const createCryptoCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { krw: number }) => {
    const krw = Math.floor(Number(input?.krw));
    if (!Number.isFinite(krw) || krw <= 0) throw new Error("충전 금액을 확인해 주세요.");
    return { krw };
  })
  .handler(async ({ data, context }) => {
    const { getRateSnapshot } = await import("@/lib/crypto/rate.server");
    const snap = await getRateSnapshot();
    const { data: res, error } = await context.supabase.rpc("create_crypto_charge_request", {
      _krw: data.krw,
      _rate: snap.rate,
    });
    if (error) throw new Error(error.message);
    return { ...(res as Record<string, unknown>), rate: snap.rate, rateSource: snap.source };
  });

/** 관리자 수동 감시기 실행 (최고관리자 전용) */
export const runCryptoWatcher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ok } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
    if (!ok) throw new Error("최고관리자만 실행할 수 있습니다.");
    const { runCryptoWatcherGuarded } = await import("@/lib/crypto/watcher.server");
    return await runCryptoWatcherGuarded();
  });

/** 관리자 운영 준비 상태 점검 (서버에서 실제 조회까지 수행) */
export const cryptoPreflight = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("권한이 없습니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: db } = await supabaseAdmin.rpc("crypto_preflight_db");
    const state = (db ?? {}) as Record<string, unknown>;

    // TRON provider 상태 (TronGrid 인증 포함)
    const { isTronGridKeyConfigured, tronGridDiagnostics } = await import(
      "@/lib/crypto/trongrid.server"
    );
    const diag = await tronGridDiagnostics(String(state["deposit_address"] ?? "") || null);
    const tronOk = diag.auth_ok;
    const tronBlock = diag.block;
    const tronError = diag.auth_ok ? null : (diag.error_kind ?? "UNKNOWN");

    const secretPresent = !!process.env["LOVABLE_CRON_SECRET"];
    const { data: sched } = await supabaseAdmin.rpc("crypto_scheduler_status" as never);
    const schedule = (sched ?? null) as {
      job_name?: string;
      schedule?: string;
      active?: boolean;
      runs_total?: number;
      runs_succeeded?: number;
      last_run_at?: string | null;
      last_status?: string | null;
    } | null;
    const successAt = state["watcher_last_success_at"] as string | null;
    const ageMs = successAt ? Date.now() - new Date(successAt).getTime() : null;
    const health =
      ageMs === null ? "OFFLINE" : ageMs < 120_000 ? "ONLINE" : ageMs < 300_000 ? "DEGRADED" : "OFFLINE";

    return {
      ...state,
      tron_ok: tronOk,
      tron_block: tronBlock,
      tron_error: tronError,
      trongrid_key_configured: isTronGridKeyConfigured(),
      trongrid_auth_ok: diag.auth_ok,
      trongrid_latency_ms: diag.latency_ms,
      trongrid_error_kind: diag.error_kind,
      trongrid_error_status: diag.error_status,
      trongrid_address_query_ok: diag.address_query_ok,
      cron_secret_present: secretPresent,
      scheduler_job_name: schedule?.job_name ?? null,
      scheduler_schedule: schedule?.schedule ?? null,
      scheduler_active: !!schedule?.active,
      scheduler_runs_total: schedule?.runs_total ?? 0,
      scheduler_runs_succeeded: schedule?.runs_succeeded ?? 0,
      scheduler_last_run_at: schedule?.last_run_at ?? null,
      scheduler_last_status: schedule?.last_status ?? null,
      watcher_health: health,
      watcher_age_ms: ageMs,
    };
  });

/** 환율 테스트 — 실제 Google Sheets 조회 (최고관리자 전용) */
export const testCryptoRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ok } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
    if (!ok) throw new Error("최고관리자만 실행할 수 있습니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .in("key", ["crypto_rate_sheet_id", "crypto_rate_sheet_gid", "crypto_rate_cell"]);
    const map = new Map((rows ?? []).map((r) => [r.key, r.value as unknown]));
    const sheetId = String(map.get("crypto_rate_sheet_id") ?? "");
    if (!sheetId) return { ok: false, error: "SHEET_NOT_CONFIGURED" };

    try {
      const { fetchSheetRate } = await import("@/lib/crypto/rate.server");
      const rate = await fetchSheetRate(
        sheetId,
        String(map.get("crypto_rate_sheet_gid") ?? "0"),
        String(map.get("crypto_rate_cell") ?? "A1"),
      );
      const now = new Date().toISOString();
      await supabaseAdmin.from("app_settings").upsert(
        [
          { key: "crypto_rate_cache", value: rate as never, updated_at: now },
          { key: "crypto_rate_cached_at", value: now as never, updated_at: now },
          { key: "crypto_rate_error", value: null as never, updated_at: now },
        ],
        { onConflict: "key" },
      );
      await context.supabase.rpc("admin_log_event", {
        _action: "FX_TEST",
        _metadata: { ok: true, rate } as never,
      });
      return { ok: true, rate, fetchedAt: now };
    } catch (e) {
      const message = (e as Error).message;
      await context.supabase.rpc("admin_log_event", {
        _action: "FX_TEST",
        _metadata: { ok: false, error: message } as never,
      });
      return { ok: false, error: message };
    }
  });

/** 관리자 TRON 조회 테스트 — 실제 TronGrid Mainnet 요청 (관리자 전용, 키값 미노출) */
export const testTronConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("권한이 없습니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .eq("key", "crypto_deposit_address");
    const address = String((rows ?? [])[0]?.value ?? "");

    const { tronGridDiagnostics } = await import("@/lib/crypto/trongrid.server");
    const diag = await tronGridDiagnostics(address || null);
    await context.supabase.rpc("admin_log_event", {
      _action: "TRON_TEST",
      _metadata: {
        ok: diag.auth_ok,
        block: diag.block,
        latency_ms: diag.latency_ms,
        error_kind: diag.error_kind,
      } as never,
    });
    return diag;
  });

/**
 * 자동충전 설정 저장 (서버 경유) — production ON 전에 TronGrid 인증까지 서버가 검증한다.
 * 기존 DB RPC의 preflight/감사 로그는 그대로 사용한다.
 */
export const saveCryptoSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { patch: Record<string, unknown>; reason: string }) => {
    if (!input?.patch || typeof input.patch !== "object") throw new Error("잘못된 요청입니다.");
    if (!input.reason || input.reason.trim().length < 2) throw new Error("변경 사유를 입력해 주세요.");
    return { patch: input.patch, reason: input.reason.trim() };
  })
  .handler(async ({ data, context }) => {
    const enabling = data.patch["crypto_charge_enabled"] === true;
    const production = data.patch["crypto_test_mode"] === false;
    if (enabling) {
      const { isTronGridKeyConfigured, tronGridDiagnostics } = await import(
        "@/lib/crypto/trongrid.server"
      );
      if (!isTronGridKeyConfigured()) {
        return {
          ok: false,
          code: "PREFLIGHT_FAILED",
          detail: "TRONGRID_API_KEY_NOT_CONFIGURED",
          missing: [] as string[],
        };
      }
      if (production) {
        const diag = await tronGridDiagnostics(null);
        if (!diag.auth_ok) {
          return {
            ok: false,
            code: "PREFLIGHT_FAILED",
            detail: "TRONGRID_AUTH_FAILED",
            missing: [] as string[],
          };
        }
      }
    }
    const { data: res, error } = await context.supabase.rpc("admin_update_crypto_settings", {
      _patch: data.patch as never,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    const out = (res ?? {}) as { ok?: boolean; code?: string; missing?: string[] };
    return {
      ok: out.ok !== false,
      code: out.code ?? null,
      detail: null as string | null,
      missing: out.missing ?? [],
    };
  });
