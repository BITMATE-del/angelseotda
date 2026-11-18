import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPoints } from "@/lib/services/walletService";
import { customProfileRemainLabel } from "@/lib/profile/customProfile";
import {
  adminDisableCustomProfile,
  adminListCustomProfiles,
  adminSetCustomProfileExpiry,
  customProfileSignedUrl,
  type AdminCustomProfile,
} from "@/lib/services/customProfileService";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "사용중",
  EXPIRED: "만료",
  DISABLED: "관리자 해제",
  NONE: "미구매",
};

const FILTERS = [
  { key: "", label: "전체" },
  { key: "ACTIVE", label: "사용중" },
  { key: "EXPIRED", label: "만료" },
  { key: "DISABLED", label: "관리자 해제" },
] as const;

function ProfileThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!path) return;
    void customProfileSignedUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <div className="h-12 w-12 overflow-hidden rounded-lg border border-gold/25 bg-black/40">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover object-center" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
          없음
        </div>
      )}
    </div>
  );
}

/** 커스텀 프로필 관리 — 상태 확인 / 강제 해제 / 만료일 수정 (조치는 감사 로그 기록) */
export function AdminCustomProfiles() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [expiries, setExpiries] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ["admin-custom-profiles", status],
    queryFn: () => adminListCustomProfiles(status || undefined),
  });

  const disable = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      adminDisableCustomProfile(userId, reason),
    onSuccess: () => {
      toast.success("커스텀 프로필을 해제하고 기본 프로필로 되돌렸습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-custom-profiles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "처리에 실패했습니다."),
  });

  const setExpiry = useMutation({
    mutationFn: ({ userId, expiresAt }: { userId: string; expiresAt: string }) =>
      adminSetCustomProfileExpiry(userId, expiresAt),
    onSuccess: () => {
      toast.success("만료일을 변경했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["admin-custom-profiles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "처리에 실패했습니다."),
  });

  const rows: AdminCustomProfile[] = list.data ?? [];

  return (
    <section className="panel-surface rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-gold">커스텀 프로필 관리</h2>
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              variant={status === f.key ? "gold" : "table"}
              size="sm"
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-xs">
          <thead className="text-gold-soft/70">
            <tr>
              {[
                "이미지",
                "닉네임",
                "현재 프로필",
                "시작일",
                "만료일",
                "남은 기간",
                "상태",
                "구매 이력",
                "누적 결제",
                "관리",
              ].map((h) => (
                <th key={h} className="border-b border-border/60 pb-2 pr-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-border/30">
                <td className="py-2 pr-3">
                  <ProfileThumb path={r.imagePath} />
                </td>
                <td className="py-2 pr-3">
                  {r.nickname ?? "-"}
                  <span className="ml-1 text-muted-foreground">({r.username ?? "-"})</span>
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      r.currentProfile === "CUSTOM" ? "text-gold" : "text-muted-foreground"
                    }
                  >
                    {r.currentProfile ?? "-"}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString("ko-KR") : "-"}
                </td>
                <td className="py-2 pr-3">
                  {r.expiresAt ? new Date(r.expiresAt).toLocaleString("ko-KR") : "-"}
                </td>
                <td className="py-2 pr-3">
                  {r.active ? customProfileRemainLabel(r.expiresAt) : "-"}
                </td>
                <td className="py-2 pr-3">
                  {STATUS_LABEL[r.status] ?? r.status}
                  {r.disabledReason && (
                    <span className="block text-[10px] text-crimson">{r.disabledReason}</span>
                  )}
                </td>
                <td className="py-2 pr-3">{r.purchaseCount}회</td>
                <td className="py-2 pr-3">{formatPoints(r.paidTotal)}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={reasons[r.userId] ?? ""}
                      onChange={(e) =>
                        setReasons((p) => ({ ...p, [r.userId]: e.target.value }))
                      }
                      placeholder="해제 사유"
                      className="w-32 rounded border border-border bg-black/40 px-2 py-1 text-[11px] outline-none focus:border-gold/50"
                    />
                    <Button
                      variant="table"
                      size="sm"
                      disabled={r.status === "DISABLED" || disable.isPending}
                      onClick={() =>
                        disable.mutate({
                          userId: r.userId,
                          reason: (reasons[r.userId] ?? "").trim(),
                        })
                      }
                    >
                      강제 해제
                    </Button>
                    <input
                      type="datetime-local"
                      value={expiries[r.userId] ?? ""}
                      onChange={(e) =>
                        setExpiries((p) => ({ ...p, [r.userId]: e.target.value }))
                      }
                      className="rounded border border-border bg-black/40 px-2 py-1 text-[11px] outline-none focus:border-gold/50"
                    />
                    <Button
                      variant="goldOutline"
                      size="sm"
                      disabled={!expiries[r.userId] || setExpiry.isPending}
                      onClick={() =>
                        setExpiry.mutate({
                          userId: r.userId,
                          expiresAt: new Date(expiries[r.userId]!).toISOString(),
                        })
                      }
                    >
                      만료일 변경
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-4 text-center text-muted-foreground">
                  {list.isLoading ? "불러오는 중..." : "표시할 내역이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
