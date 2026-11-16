import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Empty, Panel, Table } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/services/adminService";
import { searchRoomLogs } from "@/lib/services/adminOpsService";
import { formatPoints } from "@/lib/services/walletService";

const EVENT_TYPES = [
  "",
  "ROOM_CREATED",
  "PLAYER_JOIN",
  "PLAYER_LEAVE",
  "ROUND_START",
  "BET",
  "ALL_IN",
  "FOLD",
  "SHOWDOWN",
  "SETTLEMENT",
  "REMATCH",
  "ROOM_CLOSED",
  "ROOM_FORCE_DELETED",
  "ERROR",
];

/** 방 번호 기준 영구 진행 로그 검색 (방이 삭제되어도 로그는 남는다) */
export function AdminRoomLogs() {
  const [form, setForm] = useState({ roomNumber: "", user: "", eventType: "", from: "", to: "" });
  const [applied, setApplied] = useState(form);

  const logs = useQuery({
    queryKey: ["admin-room-logs", applied],
    queryFn: () =>
      searchRoomLogs({
        roomNumber: applied.roomNumber.trim() ? Number(applied.roomNumber.trim()) : null,
        userSearch: applied.user.trim(),
        eventType: applied.eventType,
        from: applied.from ? new Date(applied.from).toISOString() : null,
        to: applied.to ? new Date(applied.to).toISOString() : null,
        limit: 500,
      }),
  });

  return (
    <div className="space-y-4">
      <Panel title="방 진행 로그 검색" desc="방 번호·회원·기간·이벤트로 조회합니다. 카드 정보는 로그에 저장되지 않습니다.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32 space-y-1.5">
            <Label htmlFor="log-room">방 번호</Label>
            <Input
              id="log-room"
              value={form.roomNumber}
              inputMode="numeric"
              onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
            />
          </div>
          <div className="w-52 space-y-1.5">
            <Label htmlFor="log-user">회원(닉네임/ID)</Label>
            <Input id="log-user" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor="log-type">이벤트</Label>
            <select
              id="log-type"
              className="h-9 w-full rounded-md border border-border bg-black/40 px-2 text-xs"
              value={form.eventType}
              onChange={(e) => setForm({ ...form, eventType: e.target.value })}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === "" ? "전체" : t}
                </option>
              ))}
            </select>
          </div>
          <div className="w-48 space-y-1.5">
            <Label htmlFor="log-from">시작</Label>
            <Input
              id="log-from"
              type="datetime-local"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          </div>
          <div className="w-48 space-y-1.5">
            <Label htmlFor="log-to">종료</Label>
            <Input
              id="log-to"
              type="datetime-local"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </div>
          <Button size="sm" variant="gold" onClick={() => setApplied({ ...form })}>
            검색
          </Button>
        </div>
      </Panel>

      <Panel title={`검색 결과 ${logs.data?.length ?? 0}건`}>
        <Table head={["일시", "방", "라운드", "회원", "좌석", "이벤트", "금액", "POT", "결과", "상세"]}>
          {(logs.data ?? []).map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(l.occurred_at)}</td>
              <td className="px-3 py-2 text-gold">#{l.room_number}</td>
              <td className="px-3 py-2 font-mono text-[10px]">{l.round_id?.slice(0, 8) ?? "-"}</td>
              <td className="px-3 py-2 text-foreground">{l.nickname ?? "-"}</td>
              <td className="px-3 py-2">{l.seat ?? "-"}</td>
              <td className="px-3 py-2 text-gold-soft">{l.event_type}</td>
              <td className="px-3 py-2">{l.amount != null ? formatPoints(l.amount) : "-"}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {l.pot_before != null || l.pot_after != null
                  ? `${formatPoints(l.pot_before ?? 0)} → ${formatPoints(l.pot_after ?? 0)}`
                  : "-"}
              </td>
              <td className="px-3 py-2">
                {l.error_code ? (
                  <Badge tone="crimson">{l.error_code}</Badge>
                ) : (
                  <Badge tone="muted">{l.server_result ?? "OK"}</Badge>
                )}
              </td>
              <td className="max-w-[360px] truncate px-3 py-2 font-mono text-[10px] text-muted-foreground">
                {JSON.stringify({ before: l.before_state, after: l.after_state })}
              </td>
            </tr>
          ))}
          {logs.data?.length === 0 && <Empty colSpan={10} text="조건에 맞는 로그가 없습니다." />}
        </Table>
      </Panel>
    </div>
  );
}
