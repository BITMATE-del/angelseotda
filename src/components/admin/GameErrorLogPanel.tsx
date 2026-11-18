import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/services/adminService";
import { friendlyErrorMessage } from "@/lib/services/opsService";

const FILTERS = [
  { id: "all", label: "전체" },
  { id: "system", label: "시스템 오류" },
  { id: "expected", label: "정상 거부" },
  { id: "game", label: "게임" },
  { id: "charge", label: "충전" },
  { id: "withdraw", label: "출금" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

/** metadata.severity — 정상 거부(EXPECTED_REJECTION)는 운영 장애로 집계하지 않는다. */
function severityOf(metadata: unknown): "EXPECTED_REJECTION" | "SYSTEM_ERROR" {
  const value =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)["severity"]
      : null;
  return value === "EXPECTED_REJECTION" ? "EXPECTED_REJECTION" : "SYSTEM_ERROR";
}

/** 게임/정산 RPC 오류 로그 — 원문 오류는 관리자에게만 노출된다. */
export function GameErrorLogPanel() {
  const [filter, setFilter] = useState<FilterId>("all");

  const logs = useQuery({
    queryKey: ["admin-game-error-logs", filter],
    refetchInterval: 30_000,
    queryFn: async () => {
      let query = supabase
        .from("game_error_logs")
        .select(
          "id, occurred_at, fn, error_code, error_message, phase, action, retried, round_id, room_id, user_id, metadata",
        )
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (filter === "game") query = query.or("fn.ilike.%game%,fn.ilike.%round%,fn.ilike.%bet%,fn.ilike.%hand%");
      if (filter === "charge") query = query.ilike("fn", "%charge%");
      if (filter === "withdraw") query = query.ilike("fn", "%withdraw%");
      const { data, error } = await query;
      if (error) throw error;
      const rows = data ?? [];
      if (filter === "expected") return rows.filter((r) => severityOf(r.metadata) === "EXPECTED_REJECTION");
      if (filter === "system") return rows.filter((r) => severityOf(r.metadata) === "SYSTEM_ERROR");
      return rows;
    },
  });


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl text-gold">게임 오류 로그</h2>
        <span className="text-[11px] text-muted-foreground">최근 200건 · 30초마다 갱신</span>
        <div className="ml-auto flex gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              variant={filter === f.id ? "gold" : "table"}
              size="sm"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {logs.isError && (
        <p className="text-xs text-destructive">
          {friendlyErrorMessage(logs.error, "오류 로그를 불러올 수 없습니다.")}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gold/12 bg-black/30">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-gold/12 text-[11px] text-gold-soft/70">
            <tr>
              <th className="px-3 py-2">발생 시각</th>
              <th className="px-3 py-2">구분</th>
              <th className="px-3 py-2">함수</th>
              <th className="px-3 py-2">단계/행동</th>
              <th className="px-3 py-2">코드</th>
              <th className="px-3 py-2">메시지</th>
              <th className="px-3 py-2">재시도</th>
            </tr>
          </thead>
          <tbody>
            {(logs.data ?? []).map((row) => (
              <tr key={row.id} className="border-b border-white/5 align-top">
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {formatDateTime(row.occurred_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      severityOf(row.metadata) === "EXPECTED_REJECTION"
                        ? "text-muted-foreground"
                        : "text-destructive"
                    }
                  >
                    {severityOf(row.metadata) === "EXPECTED_REJECTION" ? "정상 거부" : "시스템 오류"}
                  </span>
                </td>
                <td className="px-3 py-2 text-gold">{row.fn}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {[row.phase, row.action].filter(Boolean).join(" · ") || "-"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.error_code ?? "-"}</td>
                <td className="max-w-[560px] px-3 py-2">{row.error_message}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.retried ? "예" : "-"}</td>
              </tr>
            ))}
            {logs.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">

                  기록된 오류가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
