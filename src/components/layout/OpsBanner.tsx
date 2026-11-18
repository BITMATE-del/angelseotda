import { useOpsStatus } from "@/hooks/useOpsStatus";

/**
 * 점검 모드 · 게임 잠금 · TEST 모드 안내 배너.
 * 실제 차단은 서버 RPC에서 수행되며 이 배너는 안내 전용이다.
 */
export function OpsBanner() {
  const { data } = useOpsStatus();
  if (!data) return null;

  const notices: { tone: "warn" | "info"; text: string }[] = [];
  if (data.maintenance) notices.push({ tone: "warn", text: data.maintenanceMessage });
  if (!data.maintenance && data.gameLock)
    notices.push({
      tone: "warn",
      text: "일시적으로 새로운 판 시작이 제한되어 있습니다. 진행 중인 게임은 정상 종료됩니다.",
    });
  if (data.maintenance && data.blockCharge)
    notices.push({ tone: "info", text: "점검 중에는 충전 신청을 받지 않습니다." });
  if (data.maintenance && data.blockWithdraw)
    notices.push({ tone: "info", text: "점검 중에는 출금 신청을 받지 않습니다." });
  if (data.appMode !== "PRODUCTION")
    notices.push({
      tone: "info",
      text: `${data.appMode} 모드로 운영 중입니다. 테스트 계정 기록은 운영 통계와 랭킹에 반영되지 않습니다.`,
    });

  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((n, i) => (
        <div
          key={i}
          role="status"
          className={
            n.tone === "warn"
              ? "rounded-xl border border-destructive/40 bg-destructive/12 px-4 py-3 text-xs text-destructive-foreground"
              : "rounded-xl border border-gold/30 bg-gold/8 px-4 py-3 text-xs text-gold"
          }
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}
