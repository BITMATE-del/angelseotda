import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPoints } from "@/lib/services/walletService";
import { createDoriRoom, fetchMyDoriRoom, listDoriRooms } from "@/lib/services/doriService";
import { friendlyErrorMessage } from "@/lib/services/opsService";
import { DORI_MAX_PLAYERS, DORI_MIN_PLAYERS } from "@/lib/game/dori/doriRules";
import { DORI_GRADES, doriGradeName, type DoriRoomGrade } from "@/lib/game/dori/doriRooms";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  WAITING: "대기",
  PLAYING: "게임중",
  CLOSED: "종료",
};

/** 도리 전용 방 목록 + 방 만들기. 섯다 방은 이 목록에 절대 포함되지 않는다. */
export function DoriRoomBoard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [grade, setGrade] = useState<DoriRoomGrade>("beginner");
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState("");

  const rooms = useQuery({
    queryKey: ["dori-rooms"],
    queryFn: listDoriRooms,
    refetchInterval: 4000,
  });

  const myRoom = useQuery({
    queryKey: ["dori-my-room"],
    queryFn: fetchMyDoriRoom,
    refetchInterval: 5000,
  });

  // 방이 삭제/변경되면 새로고침 없이 목록에서 즉시 반영한다.
  useEffect(() => {
    const channel = supabase
      .channel("dori-lobby-rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "dori_rooms" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["dori-rooms"] });
        void queryClient.invalidateQueries({ queryKey: ["dori-my-room"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const create = useMutation({
    mutationFn: async () =>
      createDoriRoom({
        title: title.trim() || "도리짓고땡",
        grade,
        isPrivate,
        password: isPrivate ? password : null,
      }),
    onSuccess: (roomId) => {
      setOpen(false);
      setTitle("");
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["dori-rooms"] });
      void navigate({ to: "/dori/game/$roomId", params: { roomId } });
    },
    onError: (e) => toast.error(friendlyErrorMessage(e)),
  });

  return (
    <section className="panel-surface rounded-2xl p-6">
      {myRoom.data && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3">
          <p className="text-[13px] text-foreground/85">
            <span className="font-display text-gold">
              #{myRoom.data.roomNumber} {myRoom.data.title}
            </span>{" "}
            {myRoom.data.seat}번 좌석에 아직 앉아 있습니다.
            {myRoom.data.leavePending ? " (퇴장 예약 중)" : ""}
          </p>
          <Button
            variant="gold"
            size="sm"
            onClick={() =>
              void navigate({
                to: "/dori/game/$roomId",
                params: { roomId: myRoom.data!.roomId },
              })
            }
          >
            게임으로 돌아가기
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-gold">도리 방 목록</h2>
        <Button variant="gold" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "닫기" : "방 만들기"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 grid gap-4 rounded-xl border border-gold/25 bg-black/40 p-4">
          <label className="block text-[12px] text-foreground/70">
            방 제목
            <Input
              value={title}
              maxLength={24}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="도리짓고땡"
              className="mt-1 max-w-sm"
            />
          </label>

          <div>
            <p className="text-[12px] text-foreground/70">방 등급 (최소 입장 포인트 · 기본 베팅)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {DORI_GRADES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGrade(g.id)}
                  className={cn(
                    "rounded-xl border px-3 py-3 text-left transition-colors",
                    grade === g.id
                      ? "border-gold bg-gold/10"
                      : "border-gold/20 bg-black/40 hover:border-gold/50",
                  )}
                >
                  <p className="font-display text-sm text-gold">{g.name}</p>
                  <p className="mt-1 text-[12px] text-foreground/70">
                    최소 입장 {formatPoints(g.minPoints)}
                  </p>
                  <p className="text-[12px] text-foreground/70">
                    기본 베팅 {formatPoints(g.ante)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="text-[12px] text-foreground/70">
              공개 설정
              <div className="mt-1 flex items-center gap-2">
                <Button
                  variant={isPrivate ? "table" : "gold"}
                  size="sm"
                  onClick={() => setIsPrivate(false)}
                >
                  공개
                </Button>
                <Button
                  variant={isPrivate ? "gold" : "table"}
                  size="sm"
                  onClick={() => setIsPrivate(true)}
                >
                  비공개
                </Button>
              </div>
            </div>
            {isPrivate && (
              <label className="text-[12px] text-foreground/70">
                비밀번호
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1"
                />
              </label>
            )}
          </div>

          <div>
            <Button variant="gold" disabled={create.isPending} onClick={() => create.mutate()}>
              도리 방 만들기 (최소 {DORI_MIN_PLAYERS}명 · 최대 {DORI_MAX_PLAYERS}명)
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-gold/20">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="bg-black/50 text-[11px] tracking-[0.15em] text-gold-soft/80">
            <tr>
              <th className="px-3 py-2">방번호</th>
              <th className="px-3 py-2">방제목</th>
              <th className="px-3 py-2">등급</th>
              <th className="px-3 py-2">인원</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2">기본 베팅</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(rooms.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-gold/10">
                <td className="px-3 py-2 font-display text-gold-soft">#{r.room_number}</td>
                <td className="px-3 py-2">
                  {r.title}
                  {r.is_private && <span className="ml-1 text-[11px] text-gold-soft">🔒</span>}
                </td>
                <td className="px-3 py-2 text-foreground/75">{doriGradeName(r.room_type)}</td>
                <td className="px-3 py-2">
                  {r.seated}/{r.max_players}
                </td>
                <td className="px-3 py-2 text-foreground/75">
                  {STATUS_LABEL[r.status] ?? r.status}
                </td>
                <td className="px-3 py-2 font-display text-gold">{formatPoints(r.ante)}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="sm"
                    variant="gold"
                    onClick={() =>
                      void navigate({ to: "/dori/game/$roomId", params: { roomId: r.id } })
                    }
                  >
                    입장
                  </Button>
                </td>
              </tr>
            ))}
            {(rooms.data ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-foreground/60">
                  아직 열린 도리 방이 없습니다. 방을 만들어 시작하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
