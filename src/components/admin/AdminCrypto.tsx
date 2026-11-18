import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  cryptoPreflight,
  runCryptoWatcher,
  testCryptoRate,
  testTronConnection,
  saveCryptoSettings,
} from "@/lib/cryptoCharge.functions";
import {
  CRYPTO_STATUS_LABEL,
  fetchChainDeposits,
  fetchCryptoFeed,
  fetchCryptoOverview,
  fetchCryptoRequests,
  maskAddress,
  type CryptoPreflight,
} from "@/lib/services/cryptoChargeService";
import { formatPoints, formatWon } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";
import { AdminUnmatchedDeposits } from "@/components/admin/AdminUnmatchedDeposits";


function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel-surface rounded-2xl p-5">
      <h2 className="font-display text-base text-gold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kpi({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-black/30 px-3 py-2">
      <p className="text-[10px] tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("font-display text-lg", warn ? "text-crimson" : "text-gold")}>{value}</p>
    </div>
  );
}

/** USDT(TRC20) 자동충전 운영 콘솔 — 민감한 서버 키는 노출하지 않는다. */
export function AdminCrypto({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const queryClient = useQueryClient();
  const watcherFn = useServerFn(runCryptoWatcher);
  const preflightFn = useServerFn(cryptoPreflight);
  const fxTestFn = useServerFn(testCryptoRate);
  const tronTestFn = useServerFn(testTronConnection);
  const saveSettingsFn = useServerFn(saveCryptoSettings);
  const [reqStatus, setReqStatus] = useState("");
  const [depStatus, setDepStatus] = useState("");

  const overview = useQuery({
    queryKey: ["crypto-overview"],
    queryFn: fetchCryptoOverview,
    refetchInterval: 10_000,
  });
  const requests = useQuery({
    queryKey: ["crypto-requests", reqStatus],
    queryFn: () => fetchCryptoRequests(reqStatus || undefined),
    refetchInterval: 10_000,
  });
  const preflight = useQuery({
    queryKey: ["crypto-preflight"],
    queryFn: () => preflightFn() as unknown as Promise<CryptoPreflight>,
    refetchInterval: 20_000,
  });
  const feed = useQuery({
    queryKey: ["crypto-feed"],
    queryFn: () => fetchCryptoFeed(40),
    refetchInterval: 15_000,
  });
  const deposits = useQuery({
    queryKey: ["chain-deposits", depStatus],
    queryFn: () => fetchChainDeposits(depStatus || undefined),
    refetchInterval: 10_000,
  });

  const [form, setForm] = useState({
    enabled: false,
    testMode: true,
    address: "",
    contract: "",
    confirmations: "19",
    ttl: "30",
    minKrw: "10000",
    maxKrw: "5000000",
    sheetId: "",
    sheetGid: "0",
    cell: "A1",
  });
  const [reason, setReason] = useState("");

  useEffect(() => {
    const o = overview.data;
    if (!o) return;
    setForm({
      enabled: !!o.enabled,
      testMode: o.test_mode !== false,
      address: o.deposit_address ?? "",
      contract: o.usdt_contract ?? "",
      confirmations: o.required_confirmations ?? "19",
      ttl: o.ttl_minutes ?? "30",
      minKrw: o.min_krw ?? "10000",
      maxKrw: o.max_krw ?? "5000000",
      sheetId: o.sheet_id ?? "",
      sheetGid: o.sheet_gid ?? "0",
      cell: o.rate_cell ?? "A1",
    });
  }, [overview.data]);

  const saveSettingsSecure = async (patch: Record<string, unknown>, why: string) => {
    const res = (await saveSettingsFn({ data: { patch, reason: why } })) as unknown as {
      ok?: boolean;
      code?: string;
      detail?: string;
      missing?: string[];
    };
    if (res?.ok === false) {
      if (res.code === "PREFLIGHT_FAILED") {
        throw new Error(`운영 준비 미완료: ${res.detail ?? (res.missing ?? []).join(", ")}`);
      }
      throw new Error("설정 저장에 실패했습니다.");
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 2) throw new Error("변경 사유를 입력해 주세요.");
      const minKrw = Number(form.minKrw);
      const maxKrw = Number(form.maxKrw);
      if (!Number.isFinite(minKrw) || minKrw < 1000)
        throw new Error("최소 충전금액은 1,000원 이상으로 설정해 주세요.");
      if (!Number.isFinite(maxKrw) || maxKrw <= minKrw)
        throw new Error("최대 충전금액은 최소 충전금액보다 커야 합니다.");
      await saveSettingsSecure(
        {
          crypto_charge_enabled: form.enabled,
          crypto_test_mode: form.testMode,
          crypto_deposit_address: form.address.trim(),
          crypto_usdt_contract: form.contract.trim(),
          crypto_required_confirmations: Number(form.confirmations),
          crypto_request_ttl_minutes: Number(form.ttl),
          crypto_min_krw: Number(form.minKrw),
          crypto_max_krw: Number(form.maxKrw),
          crypto_rate_sheet_id: form.sheetId.trim(),
          crypto_rate_sheet_gid: form.sheetGid.trim(),
          crypto_rate_cell: form.cell.trim(),
        },
        reason.trim(),
      );
    },
    onSuccess: () => {
      toast.success("자동충전 설정이 저장되었습니다.");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["crypto-overview"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "저장 실패"),
  });

  const fxTest = useMutation({
    mutationFn: () => fxTestFn() as Promise<{ ok: boolean; rate?: number; error?: string }>,
    onSuccess: (r) => {
      if (r.ok) toast.success(`환율 조회 성공 · ${r.rate?.toLocaleString("ko-KR")} 원/USDT`);
      else toast.error(`환율 조회 실패: ${r.error ?? "알 수 없음"}`);
      void queryClient.invalidateQueries({ queryKey: ["crypto-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["crypto-preflight"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "환율 테스트 실패"),
  });

  const tronTest = useMutation({
    mutationFn: () =>
      tronTestFn() as unknown as Promise<{
        auth_ok: boolean;
        block: number | null;
        latency_ms: number | null;
        error_kind: string | null;
        error_status: number | null;
      }>,
    onSuccess: (r) => {
      if (r.auth_ok)
        toast.success(`TRON 조회 OK · 블록 ${r.block} · ${r.latency_ms}ms`);
      else
        toast.error(
          `TRON 조회 실패: ${r.error_kind ?? "UNKNOWN"}${r.error_status ? ` (${r.error_status})` : ""}`,
        );
      void queryClient.invalidateQueries({ queryKey: ["crypto-preflight"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "TRON 조회 실패"),
  });

  const watch = useMutation({
    mutationFn: () => watcherFn(),
    onSuccess: (r) => {
      const res = r as { ok: boolean; scanned: number; credited: number; error?: string };
      if (res.ok)
        toast.success(`감시기 실행 완료 · 조회 ${res.scanned}건 · 지급 ${res.credited}건`);
      else toast.error(`감시기 오류: ${res.error ?? "알 수 없음"}`);
      void queryClient.invalidateQueries({ queryKey: ["crypto-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["chain-deposits"] });
      void queryClient.invalidateQueries({ queryKey: ["crypto-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["crypto-preflight"] });
      void queryClient.invalidateQueries({ queryKey: ["crypto-feed"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "실행 실패"),
  });

  const o = overview.data;
  const pf = preflight.data;
  const checks: { label: string; ok: boolean; detail: string }[] = pf
    ? [
        {
          label: "입금 주소 (TRC20)",
          ok: !!pf.address_ok,
          detail: maskAddress(pf.deposit_address),
        },
        {
          label: "USDT 컨트랙트",
          ok: !!pf.contract_ok,
          detail: maskAddress(pf.usdt_contract),
        },
        {
          label: "환율 시트 설정",
          ok: !!pf.sheet_id,
          detail: pf.sheet_id ? `셀 ${pf.rate_cell ?? "-"}` : "미설정",
        },
        {
          label: "최근 정상 환율",
          ok: Number(pf.rate_cache ?? 0) > 0,
          detail: pf.rate_cache ? `${Number(pf.rate_cache).toLocaleString("ko-KR")} 원/USDT` : "없음",
        },
        {
          label: "TRON 조회",
          ok: pf.tron_ok,
          detail: pf.tron_ok ? `블록 ${pf.tron_block}` : (pf.tron_error ?? "실패"),
        },
        {
          label: "TronGrid API Key",
          ok: !!pf.trongrid_key_configured,
          detail: pf.trongrid_key_configured ? "설정됨" : "미설정",
        },
        {
          label: "TronGrid 인증",
          ok: !!pf.trongrid_auth_ok,
          detail: pf.trongrid_auth_ok
            ? `정상 · ${pf.trongrid_latency_ms ?? 0}ms`
            : `${pf.trongrid_error_kind ?? "실패"}${
                pf.trongrid_error_status ? ` (${pf.trongrid_error_status})` : ""
              }`,
        },
        {
          label: "스케줄러 비밀키",
          ok: pf.cron_secret_present,
          detail: pf.cron_secret_present ? "설정됨" : "미설정",
        },
        {
          label: "스케줄러",
          ok: !!pf.scheduler_active && pf.scheduler_schedule === "* * * * *",
          detail: pf.scheduler_active
            ? `${pf.scheduler_schedule === "* * * * *" ? "1분" : pf.scheduler_schedule} · 실행 ${
                pf.scheduler_runs_succeeded
              }/${pf.scheduler_runs_total}`
            : "미등록",
        },
        {
          label: "감시기 상태",
          ok: pf.watcher_health === "ONLINE",
          detail: `${pf.watcher_health}${
            pf.watcher_age_ms !== null ? ` · ${Math.round(pf.watcher_age_ms / 1000)}초 전` : ""
          }`,
        },
      ]
    : [];
  const readyToEnable = checks.length > 0 && checks.every((c) => c.ok);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="자동충전" value={o?.enabled ? "가동" : "중지"} warn={!o?.enabled} />
        <Kpi label="입금 대기" value={String(o?.pending ?? 0)} />
        <Kpi label="확인/지급 중" value={String(o?.confirming ?? 0)} />
        <Kpi label="오늘 지급건" value={String(o?.credited_today ?? 0)} />
        <Kpi label="오늘 충전액" value={formatWon(Number(o?.credited_today_krw ?? 0))} />
        <Kpi label="미매칭 입금" value={String(o?.unmatched ?? 0)} warn={(o?.unmatched ?? 0) > 0} />
      </div>

      <AdminUnmatchedDeposits />



      <Box title="운영 활성화 준비 상태">
        <div className="grid gap-2 sm:grid-cols-2">
          {checks.length === 0 && <p className="text-xs text-muted-foreground">확인 중…</p>}
          {checks.map((c) => (
            <div
              key={c.label}
              className="flex items-center justify-between rounded-lg border border-border bg-black/30 px-3 py-2 text-xs"
            >
              <span className="text-muted-foreground">{c.label}</span>
              <span className={cn("font-display", c.ok ? "text-gold" : "text-crimson")}>
                {c.ok ? "OK" : "미완료"} · {c.detail}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-display",
              readyToEnable ? "bg-gold/15 text-gold" : "bg-crimson/15 text-crimson",
            )}
          >
            {readyToEnable ? "PREFLIGHT READY" : "NOT READY"}
          </span>
          <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] text-muted-foreground">
            SYSTEM {readyToEnable ? "TEST READY" : "NOT READY"} · PRODUCTION{" "}
            {pf?.test_mode === false && pf?.enabled ? "READY" : "NOT READY (실입금 E2E 대기)"}
          </span>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-[11px]",
              pf?.test_mode === false ? "bg-crimson/15 text-crimson" : "bg-black/40 text-muted-foreground",
            )}
          >
            {pf?.test_mode === false ? "실운영 모드" : "테스트 모드 (테스트 계정만 신청 가능)"}
          </span>
          <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] text-muted-foreground">
            락 상태 {pf?.watcher_lock_status ?? "-"} · 연속 실패 {pf?.watcher_fail_streak ?? 0}
          </span>
        </div>
        <Button
          variant="table"
          size="sm"
          className="mt-3"
          disabled={!isSuperAdmin || fxTest.isPending}
          onClick={() => fxTest.mutate()}
        >
          {fxTest.isPending ? "환율 조회 중…" : "환율 테스트 실행"}
        </Button>
        <Button
          variant="table"
          size="sm"
          className="mt-3 ml-2"
          disabled={tronTest.isPending}
          onClick={() => tronTest.mutate()}
        >
          {tronTest.isPending ? "TRON 조회 중…" : "TRON 조회 테스트"}
        </Button>
      </Box>

      <Box title="감시기 · 환율 상태">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <p className="text-muted-foreground">
            마지막 감시 실행{" "}
            <span className="text-foreground">
              {o?.watcher_last_run ? new Date(o.watcher_last_run).toLocaleString("ko-KR") : "기록 없음"}
            </span>
          </p>
          <p className="text-muted-foreground">
            감시기 오류{" "}
            <span className={o?.watcher_last_error ? "text-crimson" : "text-foreground"}>
              {o?.watcher_last_error ?? "없음"}
            </span>
          </p>
          <p className="text-muted-foreground">
            최근 환율 <span className="text-gold">{o?.rate_cache ?? "없음"}</span> 원/USDT
            {o?.rate_cached_at && (
              <span className="ml-1">({new Date(o.rate_cached_at).toLocaleString("ko-KR")})</span>
            )}
          </p>
          <p className="text-muted-foreground">
            최근 실행 결과{" "}
            <span className="text-foreground">
              감지 {pf?.watcher_detected_count ?? 0} · 기록 {pf?.watcher_matched_count ?? 0} · 지급{" "}
              {pf?.watcher_credited_count ?? 0} · {pf?.watcher_duration_ms ?? 0}ms
            </span>
          </p>
          <p className="text-muted-foreground">
            환율 조회 오류{" "}
            <span className={o?.rate_error ? "text-crimson" : "text-foreground"}>
              {o?.rate_error ?? "없음"}
            </span>
          </p>
        </div>
        <Button
          variant="gold"
          size="sm"
          className="mt-3"
          disabled={!isSuperAdmin || watch.isPending}
          onClick={() => watch.mutate()}
        >
          {watch.isPending ? "확인 중…" : "지금 입금 확인 실행"}
        </Button>
        {!isSuperAdmin && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            감시기 수동 실행과 설정 변경은 최고관리자만 가능합니다.
          </p>
        )}
      </Box>

      <Box title="자동충전 설정">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-lg border border-border bg-black/30 px-3 py-2 text-sm">
            <span>자동충전 사용</span>
            <Switch
              checked={form.enabled}
              disabled={!isSuperAdmin || (!form.enabled && !readyToEnable)}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-border bg-black/30 px-3 py-2 text-sm">
            <span>테스트 모드 (테스트 계정만 신청)</span>
            <Switch
              checked={form.testMode}
              disabled={!isSuperAdmin}
              onCheckedChange={(v) => setForm((f) => ({ ...f, testMode: v }))}
            />
          </label>
          <div className="space-y-1.5">
            <Label>입금 주소 (TRC20)</Label>
            <Input
              value={form.address}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>USDT 컨트랙트</Label>
            <Input
              value={form.contract}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, contract: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>필요 컨펌 수</Label>
            <Input
              type="number"
              value={form.confirmations}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, confirmations: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>신청 유효시간 (분)</Label>
            <Input
              type="number"
              value={form.ttl}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, ttl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>최소 충전금액 (원)</Label>
            <Input
              type="number"
              step={1000}
              value={form.minKrw}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, minKrw: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">
              회원 자동충전 화면에 표시되고 서버 신청 생성 시에도 검증됩니다.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>최대 충전금액 (원)</Label>
            <Input
              type="number"
              step={10000}
              value={form.maxKrw}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, maxKrw: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>환율 시트 ID</Label>
            <Input
              value={form.sheetId}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, sheetId: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>시트 GID</Label>
            <Input
              value={form.sheetGid}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, sheetGid: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>환율 셀 (예: B2)</Label>
            <Input
              value={form.cell}
              disabled={!isSuperAdmin}
              onChange={(e) => setForm((f) => ({ ...f, cell: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>변경 사유 (필수)</Label>
            <Input
              value={reason}
              maxLength={200}
              disabled={!isSuperAdmin}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <Button
          variant="gold"
          size="sm"
          className="mt-3"
          disabled={!isSuperAdmin || save.isPending}
          onClick={() => save.mutate()}
        >
          설정 저장
        </Button>
      </Box>

      <Box title="최근 자동충전 활동">
        <div className="max-h-[280px] overflow-y-auto text-xs">
          {(feed.data ?? []).length === 0 && <p className="text-muted-foreground">활동이 없습니다.</p>}
          {(feed.data ?? []).map((f, i) => (
            <div
              key={`${f.kind}-${f.txid ?? i}-${f.at}`}
              className="grid grid-cols-2 gap-1 border-b border-border/60 py-2 sm:grid-cols-5"
            >
              <span className="text-gold-soft">{f.kind}</span>
              <span className="text-foreground">{f.nickname ?? "-"}</span>
              <span className="text-muted-foreground">
                {f.amount_usdt !== null ? `${Number(f.amount_usdt).toFixed(6)} USDT` : "-"}
              </span>
              <span className="text-muted-foreground">
                {f.points ? `+${formatPoints(f.points)}` : f.krw ? formatWon(f.krw) : "-"}
              </span>
              <span className="text-muted-foreground">
                {f.at ? new Date(f.at).toLocaleString("ko-KR") : "-"}
              </span>
            </div>
          ))}
        </div>
      </Box>

      <Box title="자동충전 신청">
        <div className="mb-2 flex flex-wrap gap-2">
          {["", "PENDING", "CONFIRMING", "REVIEW", "CREDITED", "CANCELLED", "EXPIRED", "ERROR"].map((s) => (
            <Button
              key={s || "all"}
              size="sm"
              variant={reqStatus === s ? "gold" : "table"}
              onClick={() => setReqStatus(s)}
            >
              {s ? (CRYPTO_STATUS_LABEL[s] ?? s) : "전체"}
            </Button>
          ))}
        </div>
        <div className="max-h-[360px] overflow-y-auto text-xs">
          {(requests.data ?? []).length === 0 && (
            <p className="text-muted-foreground">데이터가 없습니다.</p>
          )}
          {(requests.data ?? []).map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-2 gap-1 border-b border-border/60 py-2 sm:grid-cols-6"
            >
              <span className="text-foreground">{formatWon(r.requested_krw)}</span>
              <span className="text-muted-foreground">{Number(r.expected_usdt).toFixed(6)}</span>
              <span className="text-gold-soft">{CRYPTO_STATUS_LABEL[r.status] ?? r.status}</span>
              <span className="text-muted-foreground">
                {r.credited_points ? `+${formatPoints(r.credited_points)}` : "-"}
              </span>
              <span className="break-all font-mono text-[10px] text-muted-foreground">
                {r.txid ?? "-"}
              </span>
              <span className="text-muted-foreground">
                {new Date(r.created_at).toLocaleString("ko-KR")}
              </span>
            </div>
          ))}
        </div>
      </Box>

      <Box title="블록체인 입금 감지 기록">
        <div className="mb-2 flex flex-wrap gap-2">
          {["", "DETECTED", "MATCHED", "CREDITED", "UNMATCHED", "EXPIRED_MATCH", "DUPLICATE", "CANCELLED"].map(
            (s) => (

              <Button
                key={s || "all"}
                size="sm"
                variant={depStatus === s ? "gold" : "table"}
                onClick={() => setDepStatus(s)}
              >
                {s || "전체"}
              </Button>
            ),
          )}
        </div>
        <div className="max-h-[360px] overflow-y-auto text-xs">
          {(deposits.data ?? []).length === 0 && (
            <p className="text-muted-foreground">데이터가 없습니다.</p>
          )}
          {(deposits.data ?? []).map((d) => (
            <div
              key={d.id}
              className="grid grid-cols-2 gap-1 border-b border-border/60 py-2 sm:grid-cols-5"
            >
              <span className="break-all font-mono text-[10px] text-muted-foreground">{d.txid}</span>
              <span className="text-foreground">{Number(d.amount_usdt).toFixed(6)} USDT</span>
              <span className={cn(d.confirmed ? "text-gold" : "text-crimson")}>
                {d.confirmations} 컨펌
              </span>
              <span className="text-gold-soft">{d.status}</span>
              <span className="text-muted-foreground">
                {new Date(d.detected_at).toLocaleString("ko-KR")}
              </span>
            </div>
          ))}
        </div>
      </Box>
    </div>
  );
}
