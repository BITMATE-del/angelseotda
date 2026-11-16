import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Empty, fail, Panel, Table, useInvalidate } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/services/adminService";
import {
  abortDoriStuckRound,
  canAbortDoriRound,
  closeDoriRoomAsAdmin,
  doriRoomCloseBlockReason,
  fetchDoriAdminDetail,
  fetchDoriAdminRooms,
  isDoriRoomStale,
  type DoriAdminRoomRow,
} from "@/lib/services/doriAdminService";

import { formatPoints } from "@/lib/services/walletService";

/**
 * 도리짓고땡 방 관리 — 모니터링 전용.
 * 관리자에게도 카드/덱 정보는 표시하지 않으며 서버 응답에도 포함되지 않는다(장수만).
 */

const PHASE_LABEL: Record<string, string> = {
  DEALING: "카드 배분",
  BETTING_1: "1차 베팅",
  MAKE_SELECTION: "짓기",
  BETTING_FINAL: "최종 베팅",
  SHOWDOWN: "승부",
  FINISHED: "정산 완료",
};

const ACTION_LABEL: Record<string, string> = {
  ANTE: "기본금",
  CHECK: "체크",
  BET: "베트",
  CALL: "콜",
  RAISE: "레이즈",
  FOLD: "다이",
  ALL_IN: "올인",
};

const CONNECTION_LABEL: Record<string, string> = {
  CONNECTED: "접속",
  DISCONNECTED: "끊김",
  LONG_ABSENCE: "장기 미접속",
};

export function AdminDoriRooms() {
  const invalidate = useInvalidate();
  const [includeClosed, setIncludeClosed] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const rooms = useQuery({
    queryKey: ["admin-dori-rooms", includeClosed],
    refetchInterval: 10000,
    queryFn: () => fetchDoriAdminRooms(includeClosed),
  });

  const detail = useQuery({
    queryKey: ["admin-dori-detail", detailId],
    enabled: !!detailId,
    refetchInterval: 4000,
    queryFn: () => fetchDoriAdminDetail(detailId!),
  });

  const close = useMutation({
    mutationFn: (roomId: string) => closeDoriRoomAsAdmin(roomId),
    onSuccess: (res) => {
      if (res.ok) toast.success(res.result === "CLOSED" ? "방을 종료했습니다." : "이미 종료된 방입니다.");
      else if (res.result === "ROUND_IN_PROGRESS")
        toast.error(`진행 중/미정산 라운드 ${res.openRounds}건이 있어 종료할 수 없습니다.`);
      else toast.error(`착석자 ${res.seated}명이 있어 종료할 수 없습니다.`);
      invalidate("admin-dori-rooms");
      invalidate("admin-dori-detail");
    },
    onError: fail,
  });

  const abort = useMutation({
    mutationFn: (roomId: string) => abortDoriStuckRound(roomId),
    onSuccess: (res) => {
      if (res.ok && res.result === "ABORTED")
        toast.success(`중단 판을 정리하고 ${formatPoints(res.refunded)} P를 환급했습니다.`);
      else if (res.ok) toast.success("정리할 중단 판이 없습니다.");
      else toast.error("아직 진행 중인 판입니다. 잠시 후 다시 시도하세요.");
      invalidate("admin-dori-rooms");
      invalidate("admin-dori-detail");
    },
    onError: fail,
  });


  const list = rooms.data ?? [];
  const staleRooms = list.filter(isDoriRoomStale);

  return (
    <div className="space-y-5">
      <Panel
        title="도리짓고땡 방 목록"
        desc="10초마다 자동 갱신됩니다. 카드/덱 정보는 관리자에게도 표시되지 않습니다."
        actions={
          <div className="flex gap-2">
            <Button variant="table" size="sm" onClick={() => setIncludeClosed((v) => !v)}>
              {includeClosed ? "진행 방만 보기" : "종료 방 포함"}
            </Button>
            <Button variant="table" size="sm" onClick={() => invalidate("admin-dori-rooms")}>
              새로고침
            </Button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span>전체 {list.length}개</span>
          <span>· 이상 감지 {staleRooms.length}개</span>
        </div>
        <Table
          head={[
            "방번호",
            "이름",
            "상태",
            "인원",
            "phase",
            "선",
            "현재 턴",
            "POT",
            "캐리팟",
            "레이즈",
            "나가기 예약",
            "미접속",
            "최근 액션",
            "",
          ]}
        >
          {list.length === 0 && <Empty colSpan={14} text="도리 방이 없습니다." />}
          {list.map((r) => {
            const blocked = doriRoomCloseBlockReason(r);
            return (
              <tr key={r.roomId} className={isDoriRoomStale(r) ? "bg-crimson/5" : undefined}>
                <td className="px-3 py-2 font-mono text-gold">#{r.roomNumber}</td>
                <td className="px-3 py-2">
                  {r.title}
                  {r.isPrivate && <span className="ml-1 text-[10px] text-gold-soft">비공개</span>}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={r.status === "CLOSED" ? "muted" : r.status === "PLAYING" ? "jade" : "gold"}>
                    {r.status}
                  </Badge>
                  {isDoriRoomStale(r) && (
                    <Badge tone="crimson">
                      이상
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.seated}/{r.maxPlayers}
                </td>
                <td className="px-3 py-2">{r.phase ? (PHASE_LABEL[r.phase] ?? r.phase) : "-"}</td>
                <td className="px-3 py-2">{r.dealerSeat ?? "-"}</td>
                <td className="px-3 py-2">{r.currentTurnSeat ? `${r.currentTurnSeat}번` : "-"}</td>
                <td className="px-3 py-2">{formatPoints(r.pot)}</td>
                <td className="px-3 py-2">{formatPoints(r.carryPot)}</td>
                <td className="px-3 py-2">{r.raiseCount ?? "-"}</td>
                <td className="px-3 py-2">{r.leavePendingCount}</td>
                <td className="px-3 py-2">{r.disconnectedCount}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {r.lastActionAt ? formatDateTime(r.lastActionAt) : "-"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2">
                    <Button variant="table" size="sm" onClick={() => setDetailId(r.roomId)}>
                      상세
                    </Button>
                    {canAbortDoriRound(r) && (
                      <Button
                        variant="table"
                        size="sm"
                        disabled={abort.isPending}
                        title="참가자가 모두 이탈한 중단 판을 정리하고 베팅금을 환급합니다."
                        onClick={() => abort.mutate(r.roomId)}
                      >
                        중단 판 정리
                      </Button>
                    )}
                    <Button
                      variant="table"
                      size="sm"
                      disabled={!!blocked || close.isPending}
                      title={blocked ?? "방을 안전 종료합니다."}
                      onClick={() => close.mutate(r.roomId)}
                    >
                      안전 종료
                    </Button>

                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Panel>

      {detailId && (
        <Panel
          title="방 상세 / 진행 로그"
          desc="좌석 상태와 최근 액션 60건입니다. 카드 내용은 제공되지 않습니다."
          actions={
            <Button variant="table" size="sm" onClick={() => setDetailId(null)}>
              닫기
            </Button>
          }
        >
          {detail.isLoading && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
          {detail.data && (
            <div className="space-y-4">
              <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3 lg:grid-cols-6">
                <Info label="방번호" value={`#${detail.data.room.roomNumber}`} />
                <Info label="상태" value={detail.data.room.status} />
                <Info label="Ante" value={formatPoints(detail.data.room.ante)} />
                <Info label="캐리팟" value={formatPoints(detail.data.room.carryPot)} />
                <Info label="라운드" value={detail.data.round ? `${detail.data.round.roundNumber}판` : "-"} />
                <Info
                  label="phase"
                  value={
                    detail.data.round
                      ? (PHASE_LABEL[detail.data.round.phase] ?? detail.data.round.phase)
                      : "-"
                  }
                />
                <Info label="선 좌석" value={detail.data.round?.dealerSeat ?? "-"} />
                <Info label="POT" value={formatPoints(detail.data.round?.pot ?? 0)} />
                <Info label="레이즈" value={detail.data.round?.raiseCount ?? "-"} />
                <Info label="정산" value={detail.data.round?.settlementStatus ?? "-"} />
                <Info label="round id" value={detail.data.round?.roundId ?? "-"} mono />
                <Info
                  label="턴 마감"
                  value={detail.data.round?.turnDeadlineAt ? formatDateTime(detail.data.round.turnDeadlineAt) : "-"}
                />
              </div>

              <Table
                head={["좌석", "닉네임", "보유 P", "준비", "접속", "장수", "기여", "짓기", "결과", "나가기 예약", "최근 확인"]}
              >
                {detail.data.seats.length === 0 && <Empty colSpan={11} text="착석자가 없습니다." />}
                {detail.data.seats.map((s) => (
                  <tr key={s.seat}>
                    <td className="px-3 py-2 text-gold">{s.seat}번</td>
                    <td className="px-3 py-2">{s.nickname ?? "-"}</td>
                    <td className="px-3 py-2">{formatPoints(s.points)}</td>
                    <td className="px-3 py-2">{s.isReady ? "READY" : "-"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={s.connectionStatus === "CONNECTED" ? "jade" : "crimson"}>
                        {CONNECTION_LABEL[s.connectionStatus] ?? s.connectionStatus}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{s.cardCount}장</td>
                    <td className="px-3 py-2">{formatPoints(s.contribution)}</td>
                    <td className="px-3 py-2">{s.makeStatus ?? "-"}</td>
                    <td className="px-3 py-2">{s.folded ? "FOLD" : (s.resultType ?? "-")}</td>
                    <td className="px-3 py-2">{s.leavePending ? "예약" : "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {s.lastSeenAt ? formatDateTime(s.lastSeenAt) : "-"}
                    </td>
                  </tr>
                ))}
              </Table>

              <Table head={["판", "좌석", "닉네임", "행동", "금액", "베팅 라운드", "시각"]}>
                {detail.data.actions.length === 0 && <Empty colSpan={7} text="진행 로그가 없습니다." />}
                {detail.data.actions.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2">{a.roundNumber}판</td>
                    <td className="px-3 py-2">{a.seat ? `${a.seat}번` : "-"}</td>
                    <td className="px-3 py-2">{a.nickname ?? "-"}</td>
                    <td className="px-3 py-2">{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td className="px-3 py-2">{a.amount ? formatPoints(a.amount) : "-"}</td>
                    <td className="px-3 py-2">{a.bettingRound ?? "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(a.at)}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-gold/12 bg-black/30 px-3 py-2">
      <p className="text-[10px] tracking-widest text-gold-soft/60">{label}</p>
      <p className={mono ? "font-mono text-[10px] text-foreground/90" : "text-xs text-foreground/90"}>{value}</p>
    </div>
  );
}
