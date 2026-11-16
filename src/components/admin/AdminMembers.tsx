import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  ConfirmDialog,
  Empty,
  fail,
  Panel,
  Table,
  useInvalidate,
  type ConfirmRequest,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RANK_TIERS, type AppRank } from "@/lib/game/rankTiers";
import { formatDateTime, USER_STATUS_LABEL } from "@/lib/services/adminService";
import {
  chatBanUser,
  fetchMemberContact,
  clearSanction,
  correctLockedPoints,
  listMembers,
  suspendUser,
  updateMemberProfile,
  type AdminMemberRow,
} from "@/lib/services/adminOpsService";
import { formatPoints, formatWon } from "@/lib/services/walletService";
import { CopyAddressButton } from "@/components/common/CopyButton";
import { adjustPointsV2 } from "@/lib/services/cryptoChargeService";
import { resetMemberPassword } from "@/lib/admin/adminAuth.functions";

const rankLabel = (rank: AppRank) => RANK_TIERS.find((t) => t.rank === rank)?.label ?? rank;

const SUSPEND_PRESETS = [
  { days: 1, label: "1일 정지" },
  { days: 3, label: "3일 정지" },
  { days: 7, label: "7일 정지" },
  { days: 0, label: "영구 정지" },
];

const CHAT_PRESETS = [
  { hours: 1, label: "채팅금지 1시간" },
  { hours: 24, label: "채팅금지 1일" },
  { hours: 0, label: "채팅금지 무기한" },
];

const BIG_POINT_THRESHOLD = 1_000_000;

export function AdminMembers({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const invalidate = useInvalidate();
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [detail, setDetail] = useState<AdminMemberRow | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const members = useQuery({
    queryKey: ["admin-members", applied],
    queryFn: () => listMembers(applied),
  });

  const refresh = () => {
    invalidate("admin-members");
    invalidate("admin-logs");
  };

  const askSuspend = (m: AdminMemberRow, days: number) =>
    setConfirm({
      title: `${m.nickname} · ${days > 0 ? `${days}일 정지` : "영구 정지"}`,
      danger: true,
      reasonRequired: true,
      challenge: days > 0 ? undefined : m.nickname,
      challengeLabel: days > 0 ? undefined : `영구 정지 확인: 닉네임 "${m.nickname}" 입력`,
      confirmLabel: "정지 실행",
      body: <p>정지 기간 동안 로그인·게임·채팅이 차단됩니다. 보유 포인트는 그대로 유지됩니다.</p>,
      run: async (reason) => {
        await suspendUser(m.id, days, reason);
        refresh();
      },
    });

  const askChatBan = (m: AdminMemberRow, hours: number) =>
    setConfirm({
      title: `${m.nickname} · ${hours > 0 ? `채팅금지 ${hours}시간` : "채팅금지 무기한"}`,
      reasonRequired: true,
      confirmLabel: "채팅금지 실행",
      body: <p>게임 참여는 가능하지만 채팅 전송이 서버에서 차단됩니다.</p>,
      run: async (reason) => {
        await chatBanUser(m.id, hours, reason);
        refresh();
      },
    });

  const askClear = (m: AdminMemberRow, kind: "suspend" | "chat" | "all") =>
    setConfirm({
      title: `${m.nickname} · 제재 해제`,
      reasonRequired: true,
      confirmLabel: "해제",
      body: <p>{kind === "chat" ? "채팅금지" : kind === "suspend" ? "정지" : "모든 제재"}를 해제합니다.</p>,
      run: async (reason) => {
        await clearSanction(m.id, kind, reason);
        refresh();
      },
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80 space-y-1.5">
          <Label htmlFor="member-q">아이디 / 닉네임 / 회원 ID 검색</Label>
          <Input
            id="member-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setApplied(q)}
            placeholder="검색어 입력 후 Enter"
          />
        </div>
        <Button size="sm" variant="gold" onClick={() => setApplied(q)}>
          검색
        </Button>
      </div>

      <Panel
        title="회원 목록"
        desc="모든 제재·정보 변경은 사유와 함께 운영 로그에 기록됩니다. 레벨 대신 계급으로 관리합니다."
      >
        <Table
          head={["아이디/닉네임", "계급", "보유", "잠금", "누적충전", "누적출금", "전적", "상태", "최근 접속", "관리"]}
        >
          {(members.data ?? []).map((m) => (
            <tr key={m.id} className="hover:bg-white/[0.02]">
              <td className="px-3 py-2">
                <button className="font-semibold text-gold hover:underline" onClick={() => setDetail(m)}>
                  {m.nickname}
                </button>
                <p className="font-mono text-[10px] text-muted-foreground">{m.username ?? m.id.slice(0, 8)}</p>
              </td>
              <td className="px-3 py-2">
                <Badge tone="gold">{rankLabel(m.rank)}</Badge>
              </td>
              <td className="px-3 py-2 text-gold-soft">{formatPoints(m.game_points)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatPoints(m.locked_points)}</td>
              <td className="px-3 py-2">{formatWon(m.total_charge_amount)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatWon(m.total_withdraw_amount)}</td>
              <td className="px-3 py-2">
                {m.wins}승 {m.losses}패
              </td>
              <td className="px-3 py-2">
                <Badge tone={m.status === "active" ? "jade" : "crimson"}>
                  {USER_STATUS_LABEL[m.status] ?? m.status}
                </Badge>
                {m.suspended_until && (
                  <p className="mt-1 text-[10px] text-crimson">~{formatDateTime(m.suspended_until)}</p>
                )}
                {m.chat_banned_until && (
                  <p className="mt-1 text-[10px] text-gold-soft">채팅 ~{formatDateTime(m.chat_banned_until)}</p>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(m.last_seen_at)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="table" onClick={() => setDetail(m)}>
                    상세
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => askSuspend(m, 3)}>
                    3일 정지
                  </Button>
                  <Button size="sm" variant="table" onClick={() => askChatBan(m, 24)}>
                    채팅금지
                  </Button>
                  {m.status !== "active" && (
                    <Button size="sm" variant="gold" onClick={() => askClear(m, "all")}>
                      해제
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {members.data?.length === 0 && <Empty colSpan={10} />}
        </Table>
      </Panel>

      {detail && (
        <MemberDetail
          member={detail}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setDetail(null)}
          onChanged={refresh}
          onSuspend={askSuspend}
          onChatBan={askChatBan}
          onClear={askClear}
        />
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function MemberDetail({
  member,
  isSuperAdmin,
  onClose,
  onChanged,
  onSuspend,
  onChatBan,
  onClear,
}: {
  member: AdminMemberRow;
  isSuperAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
  onSuspend: (m: AdminMemberRow, days: number) => void;
  onChatBan: (m: AdminMemberRow, hours: number) => void;
  onClear: (m: AdminMemberRow, kind: "suspend" | "chat" | "all") => void;
}) {
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    username: member.username ?? "",
    nickname: member.nickname,
    telegramId: "",
    walletAddress: "",
    rank: member.rank as AppRank,
  });
  const [points, setPoints] = useState({ amount: "", memo: "" });
  const [locked, setLocked] = useState(String(member.locked_points));
  const [password, setPassword] = useState("");

  // 회원 USDT 출금 주소 등 민감정보는 관리자 전용 RPC 로만 조회한다 (서버에서 권한 검증).
  const contact = useQuery({
    queryKey: ["admin-member-contact", member.id],
    queryFn: () => fetchMemberContact(member.id),
  });
  const usdtAddress = contact.data?.walletAddress?.trim() || null;

  const requireReason = () => {
    if (reason.trim().length < 2) throw new Error("사유를 입력해 주세요.");
    return reason.trim();
  };

  const saveProfile = useMutation({
    mutationFn: async () => {
      const r = requireReason();
      await updateMemberProfile({
        userId: member.id,
        username: form.username || null,
        nickname: form.nickname || null,
        telegramId: form.telegramId || null,
        walletAddress: form.walletAddress || null,
        rank: form.rank,
        reason: r,
      });
    },
    onSuccess: () => {
      toast.success("회원 정보를 수정했습니다.");
      onChanged();
    },
    onError: fail,
  });

  const pointMutation = useMutation({
    mutationFn: async () => {
      const r = requireReason();
      const amount = Number(points.amount);
      if (!Number.isFinite(amount) || amount === 0) throw new Error("금액을 확인해 주세요.");
      if (Math.abs(amount) >= BIG_POINT_THRESHOLD && !window.confirm(`${formatPoints(amount)}P 는 대량 지급입니다. 계속할까요?`)) {
        throw new Error("취소했습니다.");
      }
      await adjustPointsV2({
        userId: member.id,
        direction: amount > 0 ? "ADD" : "REMOVE",
        amount: Math.abs(amount),
        reason: `${points.memo || "관리자 조정"} · ${r}`,
      });
    },
    onSuccess: () => {
      toast.success("포인트를 조정했습니다.");
      setPoints({ amount: "", memo: "" });
      onChanged();
    },
    onError: fail,
  });

  const lockedMutation = useMutation({
    mutationFn: async () => {
      const r = requireReason();
      await correctLockedPoints(member.id, Number(locked), r);
    },
    onSuccess: () => {
      toast.success("잠금 포인트를 보정했습니다.");
      onChanged();
    },
    onError: fail,
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      const r = requireReason();
      if (password.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
      await resetMemberPassword({ data: { userId: member.id, newPassword: password, reason: r } });
    },
    onSuccess: () => {
      toast.success("비밀번호를 재설정했습니다. 회원에게 안전하게 전달해 주세요.");
      setPassword("");
    },
    onError: fail,
  });

  return (
    <Panel
      title={`${member.nickname} 상세`}
      desc="계정 정보 · 제재 · 포인트 · 비밀번호를 한 화면에서 처리합니다."
      actions={
        <Button size="sm" variant="table" onClick={onClose}>
          닫기
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 text-xs md:grid-cols-4">
          <Info label="회원 ID" value={member.id} mono />
          <Info label="계급" value={rankLabel(member.rank)} />
          <Info label="가입일" value={formatDateTime(member.created_at)} />
          <Info label="최근 접속" value={formatDateTime(member.last_seen_at)} />
          <Info label="누적 충전" value={`${formatWon(member.total_charge_amount)} · ${member.total_charge_count}회`} />
          <Info label="누적 출금" value={formatWon(member.total_withdraw_amount)} />
          <Info label="출석" value={`${member.attendance_count}일`} />
          <Info label="총판 코드" value={member.affiliate_code ?? "-"} />
          <Info label="보유 포인트" value={formatPoints(member.game_points)} />
          <Info label="잠금 포인트" value={formatPoints(member.locked_points)} />
          <Info label="게임 참여" value={`${member.rounds_played}라운드`} />
          <Info label="테스트 계정" value={member.is_test_user ? "예" : "아니오"} />
        </div>

        <section className="rounded-xl border border-border p-4">
          <h3 className="font-display mb-2 text-sm text-gold">USDT 출금 주소 (TRC20)</h3>
          {contact.isLoading ? (
            <p className="text-xs text-muted-foreground">불러오는 중…</p>
          ) : usdtAddress ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 break-all font-mono text-[12px] text-foreground">{usdtAddress}</p>
              <CopyAddressButton address={usdtAddress} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">등록된 USDT 주소 없음</p>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            수동 출금 전송에 사용하는 값입니다. 실제 처리 시에는 출금 신청에 저장된 신청 당시 주소를 기준으로
            전송하세요.
          </p>
        </section>

        <div className="space-y-1.5">
          <Label htmlFor="detail-reason">운영 사유 (모든 작업 필수)</Label>
          <Input
            id="detail-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예) 고객센터 요청 · 신고 접수 번호"
          />
        </div>

        <section className="rounded-xl border border-border p-4">
          <h3 className="font-display mb-2 text-sm text-gold">제재</h3>
          <div className="flex flex-wrap gap-1.5">
            {SUSPEND_PRESETS.map((p) => (
              <Button key={p.label} size="sm" variant="danger" onClick={() => onSuspend(member, p.days)}>
                {p.label}
              </Button>
            ))}
            {CHAT_PRESETS.map((p) => (
              <Button key={p.label} size="sm" variant="table" onClick={() => onChatBan(member, p.hours)}>
                {p.label}
              </Button>
            ))}
            <Button size="sm" variant="gold" onClick={() => onClear(member, "suspend")}>
              정지 해제
            </Button>
            <Button size="sm" variant="gold" onClick={() => onClear(member, "chat")}>
              채팅금지 해제
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-border p-4">
          <h3 className="font-display mb-3 text-sm text-gold">계정 정보 수정 {isSuperAdmin ? "" : "(최고관리자 전용)"}</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="아이디" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
            <Field label="닉네임" value={form.nickname} onChange={(v) => setForm({ ...form, nickname: v })} />
            <div className="space-y-1.5">
              <Label>계급 (수동 변경 시 자동 승급 기준과 달라질 수 있음)</Label>
              <select
                className="h-9 w-full rounded-md border border-border bg-black/40 px-2 text-xs"
                value={form.rank}
                onChange={(e) => setForm({ ...form, rank: e.target.value as AppRank })}
              >
                {RANK_TIERS.map((t) => (
                  <option key={t.rank} value={t.rank}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="텔레그램 ID (변경 시에만 입력)"
              value={form.telegramId}
              onChange={(v) => setForm({ ...form, telegramId: v })}
            />
            <Field
              label="지갑 주소 (변경 시에만 입력)"
              value={form.walletAddress}
              onChange={(v) => setForm({ ...form, walletAddress: v })}
            />
          </div>
          <Button
            className="mt-3"
            size="sm"
            variant="gold"
            disabled={!isSuperAdmin || saveProfile.isPending}
            onClick={() => saveProfile.mutate()}
          >
            {saveProfile.isPending ? "저장 중…" : "정보 저장"}
          </Button>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <h3 className="font-display mb-3 text-sm text-gold">포인트 지급 / 회수</h3>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40 space-y-1.5">
                <Label>금액 (회수는 음수)</Label>
                <Input
                  value={points.amount}
                  inputMode="numeric"
                  onChange={(e) => setPoints({ ...points, amount: e.target.value })}
                />
              </div>
              <div className="w-52 space-y-1.5">
                <Label>메모</Label>
                <Input value={points.memo} onChange={(e) => setPoints({ ...points, memo: e.target.value })} />
              </div>
              <Button size="sm" variant="gold" disabled={pointMutation.isPending} onClick={() => pointMutation.mutate()}>
                {pointMutation.isPending ? "처리 중…" : "적용"}
              </Button>
            </div>
            {isSuperAdmin && (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="w-40 space-y-1.5">
                  <Label>잠금 포인트 보정</Label>
                  <Input value={locked} inputMode="numeric" onChange={(e) => setLocked(e.target.value)} />
                </div>
                <Button size="sm" variant="danger" disabled={lockedMutation.isPending} onClick={() => lockedMutation.mutate()}>
                  {lockedMutation.isPending ? "처리 중…" : "특별 보정"}
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border p-4">
            <h3 className="font-display mb-3 text-sm text-gold">비밀번호 강제 재설정</h3>
            <p className="mb-2 text-[11px] text-muted-foreground">
              기존 비밀번호는 확인할 수 없습니다. 새 비밀번호를 설정하고 회원에게 직접 전달하세요.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56 space-y-1.5">
                <Label>새 비밀번호 (8자 이상)</Label>
                <Input value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button
                size="sm"
                variant="table"
                onClick={() => setPassword(Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 8).toUpperCase())}
              >
                자동 생성
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!isSuperAdmin || passwordMutation.isPending}
                onClick={() => passwordMutation.mutate()}
              >
                {passwordMutation.isPending ? "처리 중…" : "재설정"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </Panel>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={mono ? "truncate font-mono text-[11px] text-foreground" : "text-foreground"}>{value}</p>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
