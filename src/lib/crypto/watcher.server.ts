/**
 * TRON(TRC20) 입금 감시기 — 서버 전용.
 * - 공용 입금주소로 들어온 USDT 전송만 조회한다.
 * - 토큰 컨트랙트 / 수신주소 / 컨펌 수를 서버가 재검증한 뒤 DB RPC로 기록·매칭·지급한다.
 * - 마지막 확인 지점(cursor)을 저장해 재시작 시 누락 없이 이어서 확인한다.
 */

import { tronGridFetch, tronNowBlock } from "./trongrid.server";

export { tronNowBlock };

interface TronTransfer {
  transaction_id: string;
  block_timestamp: number;
  from: string;
  to: string;
  value: string;
  token_info?: { address?: string; decimals?: number };
}

export interface WatcherResult {
  ok: boolean;
  scanned: number;
  ingested: number;
  credited: number;
  unmatched: number;
  skipped: number;
  error?: string;
}

/** 감시기 1회 실행 */
export async function runCryptoWatcherOnce(): Promise<WatcherResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();
  const result: WatcherResult = {
    ok: true,
    scanned: 0,
    ingested: 0,
    credited: 0,
    unmatched: 0,
    skipped: 0,
  };

  const { data: settingRows } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "crypto_charge_enabled",
      "crypto_deposit_address",
      "crypto_usdt_contract",
      "crypto_watcher_last_cursor",
    ]);
  const map = new Map((settingRows ?? []).map((r) => [r.key, r.value as unknown]));
  const enabled = map.get("crypto_charge_enabled") === true || map.get("crypto_charge_enabled") === "true";
  const address = String(map.get("crypto_deposit_address") ?? "");
  const contract = String(map.get("crypto_usdt_contract") ?? "");
  const cursorRaw = map.get("crypto_watcher_last_cursor");
  const cursor = typeof cursorRaw === "number" ? cursorRaw : Number(cursorRaw ?? 0) || 0;

  const finish = async (patch: Record<string, unknown>) => {
    await supabaseAdmin.from("app_settings").upsert(
      Object.entries(patch).map(([key, value]) => ({
        key,
        value: value as never,
        updated_at: nowIso,
      })),
      { onConflict: "key" },
    );
  };

  // 만료 처리는 자동충전 사용 여부와 무관하게 항상 수행한다.
  await supabaseAdmin.rpc("expire_crypto_charge_requests");

  if (!enabled || !address || !contract) {
    result.ok = false;
    result.error = !enabled ? "DISABLED" : "MISSING_SETTINGS";
    // 자동충전 OFF / 설정 미완료는 장애가 아니므로 오류로 기록하지 않는다.
    await finish({
      crypto_watcher_last_run: nowIso,
      crypto_watcher_last_error: null,
      crypto_watcher_last_skip: result.error,
    });
    return result;
  }

  try {
    const nowBlock = await tronNowBlock();
    const minTimestamp = cursor > 0 ? cursor : Date.now() - 6 * 60 * 60 * 1000;
    const url =
      `/v1/accounts/${encodeURIComponent(address)}/transactions/trc20` +
      `?only_to=true&limit=100&order_by=block_timestamp,asc` +
      `&contract_address=${encodeURIComponent(contract)}&min_timestamp=${minTimestamp}`;

    const json = await tronGridFetch<{ data?: TronTransfer[] }>(url);
    const transfers = json.data ?? [];
    result.scanned = transfers.length;

    let maxTs = cursor;
    for (const t of transfers) {
      maxTs = Math.max(maxTs, t.block_timestamp ?? 0);
      const tokenAddress = t.token_info?.address ?? "";
      const decimals = t.token_info?.decimals ?? 6;
      if (tokenAddress.toLowerCase() !== contract.toLowerCase() || decimals !== 6) {
        result.skipped += 1;
        continue;
      }
      if ((t.to ?? "").toLowerCase() !== address.toLowerCase()) {
        result.skipped += 1;
        continue;
      }
      const amountAtomic = Number(t.value);
      if (!Number.isFinite(amountAtomic) || amountAtomic <= 0) {
        result.skipped += 1;
        continue;
      }

      // 컨펌 수: 정확한 블록 번호는 트랜잭션 상세 조회로 확인한다.
      let blockNumber: number | null = null;
      let confirmations = 0;
      try {
        const info = await tronGridFetch<{ blockNumber?: number }>(
          "/wallet/gettransactioninfobyid",
          { method: "POST", body: { value: t.transaction_id } },
        );
        if (info.blockNumber) {
          blockNumber = info.blockNumber;
          confirmations = Math.max(0, nowBlock - info.blockNumber);
        }
      } catch {
        confirmations = 0;
      }

      const { data: ingest, error } = await supabaseAdmin.rpc("ingest_chain_deposit", {
        _txid: t.transaction_id,
        _to_address: t.to,
        _from_address: t.from ?? "",
        _token_contract: tokenAddress,
        _amount_atomic: amountAtomic,
        _confirmations: confirmations,
        _block_number: blockNumber ?? 0,
        _block_timestamp: new Date(t.block_timestamp ?? Date.now()).toISOString(),
      });
      if (error) {
        result.skipped += 1;
        continue;
      }
      result.ingested += 1;
      const payload = (ingest ?? {}) as { ok?: boolean; code?: string; points?: number };
      if (payload.points) result.credited += 1;
      if (payload.code === "UNMATCHED") result.unmatched += 1;
    }

    await finish({
      crypto_watcher_last_run: nowIso,
      crypto_watcher_last_error: null,
      crypto_watcher_last_skip: null,
      // 마지막 처리 시각에서 5분 겹쳐서 다시 확인 → 누락 방지
      crypto_watcher_last_cursor: Math.max(0, (maxTs || minTimestamp) - 5 * 60 * 1000),
    });
    return result;
  } catch (e) {
    result.ok = false;
    result.error = (e as Error).message;
    await finish({ crypto_watcher_last_run: nowIso, crypto_watcher_last_error: result.error });
    return result;
  }
}

/**
 * Cron/관리자 공용 실행 래퍼.
 * - DB 락으로 중복 실행을 막고(RUNNING) 실행 통계를 저장한다.
 * - 감시 로직 자체는 변경하지 않는다.
 */
export async function runCryptoWatcherGuarded(): Promise<WatcherResult & { locked?: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: lock } = await supabaseAdmin.rpc("crypto_watcher_begin", { _stale_seconds: 300 });
  const lockRes = (lock ?? {}) as { ok?: boolean; code?: string };
  if (!lockRes.ok) {
    return {
      ok: true,
      locked: true,
      scanned: 0,
      ingested: 0,
      credited: 0,
      unmatched: 0,
      skipped: 0,
      error: "LOCKED",
    };
  }

  const startedAt = Date.now();
  let result: WatcherResult;
  try {
    result = await runCryptoWatcherOnce();
  } catch (e) {
    result = {
      ok: false,
      scanned: 0,
      ingested: 0,
      credited: 0,
      unmatched: 0,
      skipped: 0,
      error: (e as Error).message,
    };
  }

  // 자동충전 OFF / 설정 미완료는 장애가 아니므로 실패 카운트를 올리지 않는다.
  const notFailure = result.error === "DISABLED" || result.error === "MISSING_SETTINGS";
  await supabaseAdmin.rpc("crypto_watcher_finish", {
    _stats: {
      ok: result.ok || notFailure,
      duration_ms: Date.now() - startedAt,
      detected: result.scanned,
      matched: result.ingested,
      credited: result.credited,
    } as never,
  });
  return result;
}
