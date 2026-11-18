import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CRITICAL_ALERT_LABEL,
  FINDING_STATUS_LABEL,
  MONITOR_SCOPE_LABEL,
  cleanupTestData,
  fetchCriticalAlerts,
  fetchIntegrityFindings,
  fetchIntegrityReport,
  fetchServerStatus,
  fetchServiceReadiness,
  formatDateTime,
  scanIntegrityFindings,
  setFindingStatus,
  type ComponentStatus,
  type CriticalLevel,
  type FindingStatus,
  type MonitorScope,
} from "@/lib/services/adminService";

const ALERT_STYLE: Record<CriticalLevel, string> = {
  OK: "border-emerald-500/25 bg-emerald-500/8 text-emerald-300",
  WARN: "border-gold/30 bg-gold/10 text-gold",
  CRITICAL: "border-destructive/40 bg-destructive/12 text-destructive",
  OFF: "border-gold/12 bg-black/30 text-muted-foreground",
};
const ALERT_LABEL: Record<CriticalLevel, string> = {
  OK: "정상",
  WARN: "주의",
  CRITICAL: "긴급",
  OFF: "비활성",
};
const FINDING_STATUS_STYLE: Record<FindingStatus, string> = {
  OPEN: "bg-destructive/15 text-destructive",
  RESOLVED: "bg-emerald-500/12 text-emerald-300",
  IGNORED_TEST: "bg-gold/12 text-gold",
};
const SCOPES: MonitorScope[] = ["OPERATION", "TEST", "ALL"];
import { friendlyErrorMessage } from "@/lib/services/opsService";

const STATUS_STYLE: Record<ComponentStatus, string> = {
  ONLINE: "bg-emerald-500/12 text-emerald-300 border-emerald-500/30",
  DEGRADED: "bg-gold/12 text-gold border-gold/30",
  OFFLINE: "bg-destructive/15 text-destructive border-destructive/30",
};
const STATUS_LABEL: Record<ComponentStatus, string> = {
  ONLINE: "정상",
  DEGRADED: "지연",
  OFFLINE: "장애",
};

function StatusCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: ComponentStatus;
  detail: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${STATUS_STYLE[status] ?? STATUS_STYLE.OFFLINE}`}>
      <p className="text-[11px] opacity-80">{label}</p>
      <p className="font-display text-lg">{STATUS_LABEL[status] ?? status}</p>
      <p className="text-[11px] opacity-70">{detail}</p>
    </div>
  );
}

function IssueBlock({
  title,
  count,
  rows,
}: {
  title: string;
  count: number;
  rows: Record<string, unknown>[];
}) {
  const ok = count === 0;
  return (
    <div className="rounded-xl border border-gold/12 bg-black/30 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] ${
            ok ? "bg-emerald-500/12 text-emerald-300" : "bg-destructive/15 text-destructive"
          }`}
        >
          {ok ? "이상 없음" : `${count}건 확인 필요`}
        </span>
      </div>
      {!ok && (
        <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-black/50 p-3 text-[11px] text-muted-foreground">
          {JSON.stringify(rows.slice(0, 20), null, 2)}
        </pre>
      )}
    </div>
  );
}

/** 서버 상태 모니터 · 무결성 검사 · 테스트 데이터 정리 */
export function SystemHealthPanel() {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const [scope, setScope] = useState<MonitorScope>("OPERATION");

  const status = useQuery({
    queryKey: ["admin-server-status"],
    queryFn: fetchServerStatus,
    refetchInterval: 30_000,
  });
  const integrity = useQuery({
    queryKey: ["admin-integrity"],
    queryFn: fetchIntegrityReport,
  });
  const alerts = useQuery({
    queryKey: ["admin-critical-alerts", scope],
    queryFn: () => fetchCriticalAlerts(scope),
    refetchInterval: 30_000,
  });
  const readiness = useQuery({
    queryKey: ["admin-service-readiness"],
    queryFn: fetchServiceReadiness,
    refetchInterval: 60_000,
  });
  const findings = useQuery({
    queryKey: ["admin-integrity-findings", scope],
    queryFn: () => fetchIntegrityFindings(scope),
  });

  const scan = useMutation({
    mutationFn: scanIntegrityFindings,
    onSuccess: () => {
      toast.success("무결성 점검을 다시 실행했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-integrity-findings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-critical-alerts"] });
    },
    onError: (error) => toast.error(friendlyErrorMessage(error, "점검에 실패했습니다.")),
  });

  const changeStatus = useMutation({
    mutationFn: (input: { id: string; status: FindingStatus }) => {
      const input_reason = window.prompt("상태 변경 사유를 입력하세요.");
      if (!input_reason || !input_reason.trim()) {
        return Promise.reject(new Error("REASON_REQUIRED: 사유를 입력해야 합니다."));
      }
      return setFindingStatus(input.id, input.status, input_reason.trim());
    },
    onSuccess: () => {
      toast.success("상태를 변경했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-integrity-findings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-critical-alerts"] });
    },
    onError: (error) => toast.error(friendlyErrorMessage(error, "상태 변경에 실패했습니다.")),
  });


  const cleanup = useMutation({
    mutationFn: () => cleanupTestData(reason.trim()),
    onSuccess: (result) => {
      toast.success(
        result["skipped"]
          ? String(result["reason"] ?? "정리할 테스트 데이터가 없습니다.")
          : "테스트 데이터를 정리했습니다.",
      );
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin-integrity"] });
    },
    onError: (error) => toast.error(friendlyErrorMessage(error, "정리에 실패했습니다.")),
  });

  const s = status.data;
  const r = integrity.data;
  const a = alerts.data;
  const ready = readiness.data;
  const findingRows = findings.data ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl text-gold">서비스 운영 준비 상태</h2>
          <span className="text-[11px] text-muted-foreground">
            {ready
              ? `${formatDateTime(ready.checkedAt)} 기준 · 운영 긴급 ${ready.criticalCount}건`
              : "확인 중…"}
          </span>
          <Button
            variant="table"
            size="sm"
            className="ml-auto"
            onClick={() => void readiness.refetch()}
            disabled={readiness.isFetching}
          >
            새로고침
          </Button>
        </div>
        {ready && (
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            {ready.areas.map((area) => (
              <div
                key={area.key}
                className={`rounded-xl border px-4 py-3 ${
                  area.status === "READY"
                    ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
                    : "border-destructive/40 bg-destructive/12 text-destructive"
                }`}
              >
                <p className="text-[11px] opacity-80">{area.label}</p>
                <p className="font-display text-lg">
                  {area.status === "READY" ? "READY" : "NOT READY"}
                </p>
                <p className="mt-1 text-[11px] opacity-70">{area.detail}</p>
              </div>
            ))}
          </div>
        )}
        {readiness.isError && (
          <p className="text-xs text-destructive">
            {friendlyErrorMessage(readiness.error, "준비 상태를 불러올 수 없습니다.")}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl text-gold">운영 CRITICAL 경고</h2>
          <span className="text-[11px] text-muted-foreground">
            {a
              ? `${formatDateTime(a.checkedAt)} 기준 · 긴급 ${a.criticalCount}건 · 30초마다 자동 갱신`
              : "확인 중…"}
          </span>
          <div className="flex items-center gap-1 rounded-lg border border-gold/15 bg-black/30 p-1">
            {SCOPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setScope(option)}
                className={`rounded px-2.5 py-1 text-[11px] transition ${
                  scope === option ? "bg-gold/20 text-gold" : "text-muted-foreground"
                }`}
              >
                {MONITOR_SCOPE_LABEL[option]}
              </button>
            ))}
          </div>
          <Button
            variant="table"
            size="sm"
            className="ml-auto"
            onClick={() => void alerts.refetch()}
            disabled={alerts.isFetching}
          >
            새로고침
          </Button>
        </div>
        {a && (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            {a.alerts.map((alert) => (
              <div
                key={alert.code}
                className={`rounded-xl border px-4 py-3 ${ALERT_STYLE[alert.level] ?? ALERT_STYLE.OFF}`}
              >
                <p className="text-[11px] opacity-80">
                  {CRITICAL_ALERT_LABEL[alert.code] ?? alert.code}
                </p>
                <p className="font-display text-lg">
                  {ALERT_LABEL[alert.level] ?? alert.level}
                  {alert.count > 0 && alert.level !== "OK" ? ` · ${alert.count}건` : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] opacity-70">{alert.code}</p>
              </div>
            ))}
          </div>
        )}
        {a && (
          <p className="text-[11px] text-muted-foreground">
            집계 기준: 미해결(OPEN) · {MONITOR_SCOPE_LABEL[scope]} 범위 · 해결 {a.historical.resolved}건 ·
            테스트 이력 {a.historical.ignoredTest}건은 제외
          </p>
        )}
        {alerts.isError && (
          <p className="text-xs text-destructive">
            {friendlyErrorMessage(alerts.error, "운영 경고를 불러올 수 없습니다.")}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl text-gold">무결성 이력</h2>
          <span className="text-[11px] text-muted-foreground">
            삭제하지 않고 미해결 / 해결 / 테스트 이력으로 관리 · {MONITOR_SCOPE_LABEL[scope]} 범위 {findingRows.length}건
          </span>
          <Button
            variant="table"
            size="sm"
            className="ml-auto"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
          >
            다시 점검
          </Button>
        </div>
        <div className="space-y-2">
          {findingRows.length === 0 && (
            <p className="rounded-xl border border-gold/12 bg-black/30 px-4 py-6 text-center text-xs text-muted-foreground">
              해당 범위에 기록된 항목이 없습니다.
            </p>
          )}
          {findingRows.map((finding) => (
            <div
              key={finding.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/12 bg-black/30 px-4 py-3"
            >
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${FINDING_STATUS_STYLE[finding.status]}`}>
                {FINDING_STATUS_LABEL[finding.status]}
              </span>
              <span className="rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                {MONITOR_SCOPE_LABEL[finding.scope]}
              </span>
              <div className="min-w-0">
                <p className="text-sm">
                  {CRITICAL_ALERT_LABEL[finding.code] ?? finding.code} · {finding.subject_label ?? "-"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {formatDateTime(finding.occurred_at)} · {finding.subject_id ?? "-"}
                  {finding.reason ? ` · ${finding.reason}` : ""}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="table"
                  size="sm"
                  disabled={changeStatus.isPending || finding.status === "RESOLVED"}
                  onClick={() => changeStatus.mutate({ id: finding.id, status: "RESOLVED" })}
                >
                  해결 처리
                </Button>
                <Button
                  variant="table"
                  size="sm"
                  disabled={changeStatus.isPending || finding.status === "IGNORED_TEST"}
                  onClick={() => changeStatus.mutate({ id: finding.id, status: "IGNORED_TEST" })}
                >
                  테스트 이력
                </Button>
                <Button
                  variant="table"
                  size="sm"
                  disabled={changeStatus.isPending || finding.status === "OPEN"}
                  onClick={() => changeStatus.mutate({ id: finding.id, status: "OPEN" })}
                >
                  미해결 복원
                </Button>
              </div>
            </div>
          ))}
        </div>
        {findings.isError && (
          <p className="text-xs text-destructive">
            {friendlyErrorMessage(findings.error, "무결성 이력을 불러올 수 없습니다.")}
          </p>
        )}
      </section>


      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl text-gold">서버 상태</h2>
          <span className="text-[11px] text-muted-foreground">
            {s ? `${formatDateTime(s.checkedAt)} 기준 · 30초마다 자동 갱신` : "확인 중…"}
          </span>
          <Button
            variant="table"
            size="sm"
            className="ml-auto"
            onClick={() => void status.refetch()}
            disabled={status.isFetching}
          >
            새로고침
          </Button>
        </div>
        {s && (
          <>
            <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
              <StatusCard
                label="데이터베이스"
                status={s.database.status}
                detail={`${s.database.latencyMs ?? 0}ms`}
              />
              <StatusCard
                label="인증"
                status={s.auth.status}
                detail={`${s.auth.latencyMs ?? 0}ms · 계정 ${s.auth.users ?? 0}`}
              />
              <StatusCard
                label="실시간"
                status={s.realtime.status}
                detail={`구독 테이블 ${s.realtime.tables ?? 0}`}
              />
              <StatusCard
                label="게임 RPC"
                status={s.gameRpc.status}
                detail={`최근 오류 ${s.gameRpc.recentErrors ?? 0}`}
              />
              <StatusCard
                label="포인트 RPC"
                status={s.pointRpc.status}
                detail={`최근 오류 ${s.pointRpc.recentErrors ?? 0}`}
              />
              <StatusCard
                label="충전 RPC"
                status={s.chargeRpc.status}
                detail={`최근 오류 ${s.chargeRpc.recentErrors ?? 0}`}
              />
              <StatusCard
                label="출금 RPC"
                status={s.withdrawalRpc.status}
                detail={`최근 오류 ${s.withdrawalRpc.recentErrors ?? 0}`}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              운영 모드 {s.appMode} · 점검 {s.maintenance ? "ON" : "OFF"} · 게임잠금{" "}
              {s.gameLock ? "ON" : "OFF"} · 진행 중 라운드 {s.activeRounds}판 · 최근 15분 오류{" "}
              {s.recentErrorTotal}건
            </p>
          </>
        )}
        {status.isError && (
          <p className="text-xs text-destructive">
            {friendlyErrorMessage(status.error, "서버 상태를 불러올 수 없습니다.")}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl text-gold">무결성 검사</h2>
          <span className="text-[11px] text-muted-foreground">
            {r ? `${formatDateTime(r.checkedAt)} 기준` : "확인 중…"}
          </span>
          <Button
            variant="table"
            size="sm"
            className="ml-auto"
            onClick={() => void integrity.refetch()}
            disabled={integrity.isFetching}
          >
            다시 검사
          </Button>
        </div>
        {r && (
          <div className="grid gap-3 xl:grid-cols-2">
            <IssueBlock
              title="포인트 잔액 · 원장 불일치"
              count={r.pointMismatchCount}
              rows={r.pointMismatch}
            />
            <IssueBlock
              title="마이너스 잔액"
              count={r.negativeBalanceCount}
              rows={r.negativeBalances}
            />
            <IssueBlock title="POT 합계 불일치" count={r.potMismatchCount} rows={r.potMismatch} />
            <IssueBlock
              title="중복 정산"
              count={r.duplicateSettlementCount}
              rows={r.duplicateSettlement}
            />
            <IssueBlock title="카드 배분 오류" count={r.cardMismatchCount} rows={r.cardMismatch} />
            <IssueBlock
              title="정산 실패 라운드"
              count={r.failedSettlementCount}
              rows={r.failedSettlements}
            />
            <div className="rounded-xl border border-gold/12 bg-black/30 p-4 xl:col-span-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">광 카드 설정</p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                    r.cardConfig.valid
                      ? "bg-emerald-500/12 text-emerald-300"
                      : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {r.cardConfig.valid ? "정상 (38·18·13광)" : "설정 확인 필요"}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                광 카드 {r.cardConfig.gwang_codes.join(", ") || "없음"} · 전체 자산{" "}
                {r.cardConfig.total_assets}장
              </p>
            </div>
          </div>
        )}
        {integrity.isError && (
          <p className="text-xs text-destructive">
            {friendlyErrorMessage(integrity.error, "무결성 검사를 실행할 수 없습니다.")}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-crimson/25 bg-crimson/5 p-4">
        <h2 className="font-display text-lg text-crimson">테스트 데이터 정리</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          테스트 계정(is_test_user)과 테스트 방 기록만 삭제합니다. 실사용자 데이터와 운영 설정은
          변경되지 않으며 모든 실행은 운영 로그에 남습니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="실행 사유 (필수)"
            className="max-w-sm"
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={reason.trim().length < 2 || cleanup.isPending}
            onClick={() => cleanup.mutate()}
          >
            {cleanup.isPending ? "정리 중…" : "테스트 데이터 삭제"}
          </Button>
        </div>
      </section>
    </div>
  );
}
