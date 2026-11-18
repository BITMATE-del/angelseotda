import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Empty, Panel, Table } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/services/adminService";
import { searchAdminLogs, type AdminLogRow } from "@/lib/services/adminOpsService";

/** 운영 로그 검색 + 변경 전/후 비교 */
export function AdminLogSearch() {
  const [form, setForm] = useState({ admin: "", target: "", action: "", from: "", to: "" });
  const [applied, setApplied] = useState(form);
  const [open, setOpen] = useState<AdminLogRow | null>(null);

  const logs = useQuery({
    queryKey: ["admin-logs", applied],
    queryFn: () =>
      searchAdminLogs({
        adminSearch: applied.admin.trim(),
        targetSearch: applied.target.trim(),
        action: applied.action.trim(),
        from: applied.from ? new Date(applied.from).toISOString() : null,
        to: applied.to ? new Date(applied.to).toISOString() : null,
        limit: 500,
      }),
  });

  return (
    <div className="space-y-4">
      <Panel title="운영 로그 검색" desc="관리자·대상 회원·작업 종류·기간으로 검색하고 변경 전/후 값을 비교합니다.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48 space-y-1.5">
            <Label htmlFor="log-admin">관리자</Label>
            <Input id="log-admin" value={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.value })} />
          </div>
          <div className="w-48 space-y-1.5">
            <Label htmlFor="log-target">대상 회원 / 내용</Label>
            <Input id="log-target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
          </div>
          <div className="w-52 space-y-1.5">
            <Label htmlFor="log-action">작업 코드 (예: USER_SUSPEND)</Label>
            <Input id="log-action" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} />
          </div>
          <div className="w-48 space-y-1.5">
            <Label htmlFor="log-from2">시작</Label>
            <Input
              id="log-from2"
              type="datetime-local"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
          </div>
          <div className="w-48 space-y-1.5">
            <Label htmlFor="log-to2">종료</Label>
            <Input
              id="log-to2"
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

      <Panel title={`운영 로그 ${logs.data?.length ?? 0}건`}>
        <Table head={["일시", "관리자", "작업", "대상", "사유", "상세"]}>
          {(logs.data ?? []).map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(l.created_at)}</td>
              <td className="px-3 py-2 text-foreground">{l.admin_nickname ?? l.admin_id.slice(0, 8)}</td>
              <td className="px-3 py-2 text-gold-soft">{l.action}</td>
              <td className="px-3 py-2">
                {l.target_nickname ?? l.target_id?.slice(0, 8) ?? "-"}
                {l.target_type ? ` · ${l.target_type}` : ""}
              </td>
              <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground">{l.reason ?? "-"}</td>
              <td className="px-3 py-2">
                <Button size="sm" variant="table" onClick={() => setOpen(l)}>
                  전/후 보기
                </Button>
              </td>
            </tr>
          ))}
          {logs.data?.length === 0 && <Empty colSpan={6} text="조건에 맞는 로그가 없습니다." />}
        </Table>
      </Panel>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="panel-surface max-h-[80vh] w-full max-w-3xl overflow-auto rounded-2xl p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg text-gold">{open.action}</h3>
              <Button size="sm" variant="table" onClick={() => setOpen(null)}>
                닫기
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(open.created_at)} · {open.admin_nickname ?? open.admin_id} · 사유 {open.reason ?? "-"}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 text-[11px] text-muted-foreground">변경 전</p>
                <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/80">
                  {JSON.stringify((open.metadata as Record<string, unknown>)?.["before"] ?? {}, null, 2)}
                </pre>
              </div>
              <div className="rounded-lg border border-gold/25 p-3">
                <p className="mb-1 text-[11px] text-gold-soft">변경 후</p>
                <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/80">
                  {JSON.stringify((open.metadata as Record<string, unknown>)?.["after"] ?? open.metadata, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
