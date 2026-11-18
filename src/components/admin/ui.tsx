import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** 관리자 콘솔 공통 UI 요소 (admin.tsx 내부 스타일과 동일 톤) */

export function Panel({
  title,
  desc,
  actions,
  children,
  className,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel-surface rounded-2xl p-5", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-gold">{title}</h2>
          {desc && <p className="mt-1 text-[11px] text-muted-foreground">{desc}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead>
          <tr className="border-b border-gold/15 text-[11px] text-gold-soft/70">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ colSpan, text = "데이터가 없습니다." }: { colSpan: number; text?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (key: string) => void qc.invalidateQueries({ queryKey: [key] });
}

export function fail(e: unknown) {
  toast.error(e instanceof Error ? e.message : "처리에 실패했습니다.");
}

export function Badge({
  tone = "muted",
  children,
}: {
  tone?: "gold" | "jade" | "crimson" | "muted";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold",
        tone === "gold" && "bg-gold/15 text-gold",
        tone === "jade" && "bg-jade/15 text-jade",
        tone === "crimson" && "bg-crimson/15 text-crimson",
        tone === "muted" && "bg-white/5 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  /** 입력해야 실행되는 확인 문자열 (2단계 확인) */
  challenge?: string | undefined;
  challengeLabel?: string | undefined;
  reasonRequired?: boolean | undefined;
  danger?: boolean | undefined;
  confirmLabel?: string | undefined;
  run: (reason: string) => Promise<void>;
}

/** 2단계 확인 모달 (사유 필수 · 확인 문자열 입력 · 처리중/성공/실패 표시) */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);

  if (!request) return null;

  const reasonOk = !request.reasonRequired || reason.trim().length >= 2;
  const challengeOk = !request.challenge || challenge.trim() === request.challenge;

  const close = () => {
    setReason("");
    setChallenge("");
    setBusy(false);
    onClose();
  };

  const run = async () => {
    setBusy(true);
    try {
      await request.run(reason.trim());
      toast.success("처리를 완료했습니다.");
      close();
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="panel-surface w-full max-w-lg rounded-2xl p-6">
        <h3 className={cn("font-display text-lg", request.danger ? "text-crimson" : "text-gold")}>
          {request.title}
        </h3>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">{request.body}</div>

        {request.reasonRequired && (
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="confirm-reason">운영 사유 (필수 · 로그 기록)</Label>
            <Input
              id="confirm-reason"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예) 이용약관 위반 신고 접수"
            />
          </div>
        )}

        {request.challenge && (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="confirm-challenge">
              {request.challengeLabel ?? `확인을 위해 "${request.challenge}" 를 입력하세요`}
            </Label>
            <Input
              id="confirm-challenge"
              value={challenge}
              onChange={(e) => setChallenge(e.target.value)}
              placeholder={request.challenge}
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="table" size="sm" onClick={close} disabled={busy}>
            취소
          </Button>
          <Button
            variant={request.danger ? "danger" : "gold"}
            size="sm"
            disabled={busy || !reasonOk || !challengeOk}
            onClick={() => void run()}
          >
            {busy ? "처리 중…" : (request.confirmLabel ?? "실행")}
          </Button>
        </div>
      </div>
    </div>
  );
}
