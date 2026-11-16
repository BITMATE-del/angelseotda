import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, ConfirmDialog, Empty, fail, Panel, Table, useInvalidate, type ConfirmRequest } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/services/adminService";
import {
  cancelAbandonedRound,
  cleanupEmptyRooms,
  forceDeleteRoom,
  listAbandonedRounds,
  listRooms,
  roomSnapshot,
  safeCloseRoom,
  type AbandonedRoundRow,
  type AdminRoomRow,
  type RoomFilter,
} from "@/lib/services/adminOpsService";
import { formatPoints } from "@/lib/services/walletService";

const FILTERS: { id: RoomFilter; label: string }[] = [
  { id: "ALL", label: "전체" },
  { id: "WAITING", label: "대기" },
  { id: "PLAYING", label: "진행중" },
  { id: "PAUSED", label: "일시정지" },
  { id: "EMPTY", label: "빈 방" },
  { id: "TEST", label: "테스트 방" },
  { id: "CLOSED", label: "종료/삭제" },
];

const STATUS_LABEL: Record<string, string> = {
  waiting: "대기",
  playing: "진행중",
  paused: "일시정지",
  closed: "종료",
  deleted: "삭제",
};

export function AdminRooms({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const invalidate = useInvalidate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RoomFilter>("ALL");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const rooms = useQuery({
    queryKey: ["admin-rooms", search, filter],
    refetchInterval: 15000,
    queryFn: () => listRooms(search, filter),
  });

  const detail = useQuery({
    queryKey: ["admin-room-snapshot", detailId],
    enabled: !!detailId,
    refetchInterval: 5000,
    queryFn: () => roomSnapshot(detailId!),
  });

  const abandoned = useQuery({
    queryKey: ["admin-abandoned-rounds"],
    refetchInterval: 20000,
    queryFn: () => listAbandonedRounds(5),
  });

  const askCancelAbandoned = (r: AbandonedRoundRow) =>
    setConfirm({
      title: `방치 판 정리 (방 #${r.roomNumber ?? "-"})`,
      danger: false,
      reasonRequired: true,
      confirmLabel: "환급하고 판 취소",
      body: (
        <>
          <p>참가자 전원이 이탈해 진행이 불가능한 판입니다. 진행 단계 {r.phase ?? "-"}</p>
          <p>
            환급 예정 합계 <span className="text-gold-soft">{formatPoints(r.refundTotal)}</span>
            {r.carryIn > 0 ? ` · 이월 POT ${formatPoints(r.carryIn)} 는 방 이월금으로 복구` : ""}
          </p>
          <ul className="mt-1 space-y-0.5">
            {r.refundPreview.map((p) => (
              <li key={p.userId}>
                좌석 {p.seat} · {p.nickname ?? p.userId.slice(0, 8)} → {formatPoints(p.amount)}
              </li>
            ))}
          </ul>
          <p className="text-gold-soft">투입한 금액 그대로 환급되며, 중복 환급은 자동으로 차단됩니다.</p>
        </>
      ),
      run: async (reason) => {
        const res = await cancelAbandonedRound(r.roundId, reason);
        toast.success(
          res.code === "CANCELLED"
            ? `환급 ${formatPoints(res.refunded)} 완료 후 판을 취소했습니다.`
            : "이미 정리된 판입니다.",
        );
        invalidate("admin-abandoned-rounds");
        invalidate("admin-rooms");
      },
    });

  const cleanup = useMutation({
    mutationFn: cleanupEmptyRooms,
    onSuccess: (n) => {
      toast.success(`빈 방 ${n}개를 정리했습니다.`);
      invalidate("admin-rooms");
    },
    onError: fail,
  });

  const askSafeClose = (r: AdminRoomRow) =>
    setConfirm({
      title: `방 #${r.roomNumber} 안전 종료`,
      danger: false,
      reasonRequired: true,
      confirmLabel: "안전 종료 실행",
      body: (
        <>
          <p>진행 중인 라운드가 있으면 서버가 정상 정산한 뒤 방을 종료합니다.</p>
          <p>참가자 {r.players}명 · 관전 {r.spectators}명 · 현재 POT {formatPoints(r.currentPot)}</p>
          <p className="text-gold-soft">포인트는 보존되며 기록은 삭제되지 않습니다.</p>
        </>
      ),
      run: async (reason) => {
        await safeCloseRoom(r.roomId, reason);
        invalidate("admin-rooms");
        invalidate("admin-room-snapshot");
      },
    });

  const askForceDelete = (r: AdminRoomRow) =>
    setConfirm({
      title: `방 #${r.roomNumber} 강제 삭제`,
      danger: true,
      reasonRequired: true,
      challenge: String(r.roomNumber),
      challengeLabel: `확인을 위해 방 번호 ${r.roomNumber} 를 입력하세요`,
      confirmLabel: "강제 삭제 실행",
      body: (
        <>
          <p className="text-crimson">진행 중 라운드는 정산되지 않고 종료 처리됩니다.</p>
          <p>참가자 {r.players}명 · 현재 POT {formatPoints(r.currentPot)}</p>
          <p>과거 라운드/포인트 원장 기록은 그대로 보존됩니다. 최고관리자 전용 기능입니다.</p>
        </>
      ),
      run: async (reason) => {
        await forceDeleteRoom(r.roomId, r.roomNumber, reason);
        invalidate("admin-rooms");
        setDetailId(null);
      },
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72 space-y-1.5">
          <Label htmlFor="room-search">방 번호 / 방 ID / 참가자 검색</Label>
          <Input
            id="room-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="예) 1042 또는 닉네임"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "gold" : "table"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="table" onClick={() => cleanup.mutate()} disabled={cleanup.isPending}>
          {cleanup.isPending ? "정리 중…" : "빈 방 일괄 정리"}
        </Button>
      </div>

      <Panel
        title="방 목록"
        desc="방 번호는 영구 고유값입니다. 안전 종료는 라운드를 정상 정산하고, 강제 삭제는 최고관리자만 가능합니다."
      >
        <Table
          head={[
            "방 번호",
            "제목",
            "등급/모드",
            "상태",
            "인원",
            "현재 POT",
            "최근 활동",
            "생성",
            "관리",
          ]}
        >
          {(rooms.data ?? []).map((r) => (
            <tr key={r.roomId} className="hover:bg-white/[0.02]">
              <td className="px-3 py-2">
                <button className="font-display text-gold hover:underline" onClick={() => setDetailId(r.roomId)}>
                  #{r.roomNumber}
                </button>
                {r.isTestRoom && <Badge>TEST</Badge>}
              </td>
              <td className="px-3 py-2 text-foreground">{r.title}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {r.roomType ?? "-"} · {r.mode}
              </td>
              <td className="px-3 py-2">
                <Badge
                  tone={r.status === "playing" ? "jade" : r.status === "waiting" ? "gold" : "muted"}
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </Badge>
                {r.stuck && <Badge tone="crimson">비정상</Badge>}
              </td>
              <td className="px-3 py-2">
                {r.players}명{r.spectators > 0 ? ` (관전 ${r.spectators})` : ""}
              </td>
              <td className="px-3 py-2 text-gold-soft">{formatPoints(r.currentPot)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.lastActivityAt)}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.createdAt)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="table" onClick={() => setDetailId(r.roomId)}>
                    상세
                  </Button>
                  {r.status !== "closed" && r.status !== "deleted" && (
                    <Button size="sm" variant="gold" onClick={() => askSafeClose(r)}>
                      안전 종료
                    </Button>
                  )}
                  {isSuperAdmin && r.status !== "deleted" && (
                    <Button size="sm" variant="danger" onClick={() => askForceDelete(r)}>
                      강제 삭제
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {rooms.data?.length === 0 && <Empty colSpan={9} />}
        </Table>
      </Panel>

      <Panel
        title="방치 판 (전원 이탈)"
        desc="참가자 전원이 이탈해 5분 이상 진행이 멈춘 판입니다. 투입 금액 기준으로 환급하고 판을 취소합니다."
      >
        <Table head={["방 번호", "모드", "단계", "POT", "환급 예정", "멈춘 시각", "관리"]}>
          {(abandoned.data ?? []).map((r) => (
            <tr key={r.roundId} className="hover:bg-white/[0.02]">
              <td className="px-3 py-2 font-display text-gold">#{r.roomNumber ?? "-"}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.mode}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.phase ?? "-"}</td>
              <td className="px-3 py-2 text-gold-soft">{formatPoints(r.pot)}</td>
              <td className="px-3 py-2">
                {formatPoints(r.refundTotal)}
                {r.alreadyRefunded && <Badge tone="muted">환급 완료</Badge>}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(r.lastActivityAt)}</td>
              <td className="px-3 py-2">
                <Button size="sm" variant="gold" onClick={() => askCancelAbandoned(r)}>
                  환급 후 정리
                </Button>
              </td>
            </tr>
          ))}
          {abandoned.data?.length === 0 && <Empty colSpan={7} text="방치된 판이 없습니다." />}
        </Table>
      </Panel>

      {detailId && (
        <Panel
          title={detail.data ? `방 #${detail.data.roomNumber} 상세` : "방 상세"}
          desc="참가자·좌석·베팅 상태를 확인합니다. 상대 카드는 어떤 경우에도 조회할 수 없습니다."
          actions={
            <Button size="sm" variant="table" onClick={() => setDetailId(null)}>
              닫기
            </Button>
          }
        >
          {detail.isLoading && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
          {detail.data && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>상태 {STATUS_LABEL[detail.data.status] ?? detail.data.status}</span>
                <span>모드 {detail.data.mode}</span>
                <span>진행 라운드 {detail.data.activeRound ? `#${detail.data.activeRound.roundNumber} · ${detail.data.activeRound.phase}` : "없음"}</span>
                <span className="text-gold-soft">현재 POT {formatPoints(detail.data.currentPot)}</span>
                <span>이월 POT {formatPoints(detail.data.carryPot)}</span>
              </div>
              <Table head={["좌석", "닉네임", "구분", "연결", "이번 라운드 베팅", "보유 포인트", "나가기 예약"]}>
                {detail.data.players.map((p) => (
                  <tr key={p.userId}>
                    <td className="px-3 py-2">{p.isSpectator ? "-" : p.seat}</td>
                    <td className="px-3 py-2 text-foreground">{p.nickname}</td>
                    <td className="px-3 py-2">{p.isSpectator ? "관전" : p.seatStatus}</td>
                    <td className="px-3 py-2">
                      <Badge tone={p.connection === "CONNECTED" ? "jade" : "crimson"}>{p.connection}</Badge>
                    </td>
                    <td className="px-3 py-2 text-gold-soft">{formatPoints(p.currentBet)}</td>
                    <td className="px-3 py-2">{formatPoints(p.points)}</td>
                    <td className="px-3 py-2">{p.leavePending ? "예약됨" : "-"}</td>
                  </tr>
                ))}
                {detail.data.players.length === 0 && <Empty colSpan={7} text="참가자가 없습니다." />}
              </Table>
            </div>
          )}
        </Panel>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
