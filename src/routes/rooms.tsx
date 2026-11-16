import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatPoints } from "@/lib/services/walletService";
import { fetchMyActiveGame } from "@/lib/services/gameService";
import { GAME_MODE_LABEL, type GameMode } from "@/lib/game/types";
import { ROOM_TITLE_MAX, resolveRoomTitle } from "@/lib/rooms/roomTitle";
import { cn } from "@/lib/utils";
import { GAME_ROOM_COLUMNS } from "@/lib/rooms/roomColumns";

export const Route = createFileRoute("/rooms")({
  head: () => ({
    meta: [
      { title: "채널 선택 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content:
          "초보방·일반방·고수방 채널을 선택해 입장하세요. 채널별 최소 입장 포인트와 기본 베팅이 고정되어 있습니다.",
      },
      { property: "og:title", content: "채널 선택 · 엔젤섯다" },
      { property: "og:description", content: "원하는 베팅 규모의 섯다 채널을 선택하세요." },
    ],
    links: [{ rel: "canonical", href: "https://angel-sd.com/rooms" }],
  }),
  component: Rooms,
});

const TIER_ACCENT: Record<string, string> = {
  beginner: "from-jade/25",
  normal: "from-gold/25",
  expert: "from-crimson/25",
};

function Rooms() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // 방 제목을 입력하면 항상 새 테이블을 만들고, 비워두면 기존 테이블 입장/기본 제목을 사용한다.
  const [roomTitle, setRoomTitle] = useState("");
  // "방 만들기" 버튼용 채널/게임 모드 선택 상태 (기존 입장 로직을 그대로 재사용한다)
  const [createTierId, setCreateTierId] = useState("");
  const [createMode, setCreateMode] = useState<GameMode>("sutda2");


  // 새로고침/재로그인 후에도 진행 중인 게임으로 복귀할 수 있게 안내한다.
  // 서버 좌석이 사라지면(나가기 예약 확정·정산 후 좌석 DELETE) 배너가 즉시 사라져야 하므로
  // 캐시를 붙들지 않고 주기적으로 서버 상태(my_active_game)를 다시 확인한다.
  const activeGame = useQuery({
    queryKey: ["my-active-game", user?.id],
    enabled: !!user,
    queryFn: fetchMyActiveGame,
    staleTime: 0,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const tiers = useQuery({
    queryKey: ["room-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_types")
        .select("*")
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rooms = useQuery({
    queryKey: ["rooms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_rooms")
        .select(GAME_ROOM_COLUMNS)
        .neq("status", "closed")
        .neq("status", "deleted")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 8000,
  });

  // 방 종료/삭제와 좌석 변화가 로비에 즉시 반영되도록 realtime을 구독한다.
  useEffect(() => {
    const channel = supabase
      .channel("lobby-rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "game_rooms" }, () => {
        queryClient.invalidateQueries({ queryKey: ["rooms"] });
        queryClient.invalidateQueries({ queryKey: ["lobby-rooms"] });
      })
      // 좌석 DELETE(나가기 확정) 시 "게임으로 복귀" 배너를 즉시 서버 상태로 재확인한다.
      .on("postgres_changes", { event: "*", schema: "public", table: "game_room_players" }, () => {
        queryClient.invalidateQueries({ queryKey: ["my-active-game"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);


  const roomsOfTier = (tierId: string) =>
    (rooms.data ?? []).filter((r) => r.room_type === tierId);

  const tierList = tiers.data ?? [];
  const createTier = tierList.find((t) => t.id === createTierId) ?? tierList[0];
  const createModes = (["sutda2", "sutda3"] as GameMode[]).filter((m) =>
    createTier ? (m === "sutda2" ? createTier.allow_sutda2 : createTier.allow_sutda3) : false,
  );
  const createLowPoints = !!createTier && (profile?.game_points ?? 0) < createTier.min_points;

  useEffect(() => {
    if (!createTierId && createTier) setCreateTierId(createTier.id);
  }, [createTierId, createTier]);

  useEffect(() => {
    if (createModes.length > 0 && !createModes.includes(createMode)) {
      setCreateMode(createModes[0]!);
    }
  }, [createModes, createMode]);

  const enterTier = useMutation({
    mutationFn: async ({
      tierId,
      mode,
      forceNew = false,
    }: { tierId: string; mode: GameMode; forceNew?: boolean }) => {
      if (!user) throw new Error("로그인이 필요합니다.");
      const tier = (tiers.data ?? []).find((t) => t.id === tierId);
      if (!tier) throw new Error("채널 정보를 불러올 수 없습니다.");
      if ((profile?.game_points ?? 0) < tier.min_points) {
        throw new Error(
          `${tier.name} 입장에는 최소 ${formatPoints(tier.min_points)}가 필요합니다.`,
        );
      }

      const resolved = resolveRoomTitle(roomTitle, tier.name, mode === "sutda3" ? "sutda3" : "sutda2");
      if (!resolved.ok) throw new Error(resolved.message);
      const wantsOwnRoom = forceNew || roomTitle.trim().length > 0;

      const open = wantsOwnRoom
        ? undefined
        : roomsOfTier(tierId).find(
            (r) =>
              r.game_mode === mode && r.current_players < r.max_players && r.status !== "closed",
          );

      let roomId = open?.id;
      if (!roomId) {
        const { data, error } = await supabase
          .from("game_rooms")
          .insert({
            host_id: user.id,
            title: resolved.title,
            game_mode: mode,
            room_type: tier.id,
            base_bet: tier.base_bet,
            max_players: tier.max_players,
            min_points: tier.min_points,
            status: "waiting",
          })
          .select("id")
          .single();
        if (error) throw error;
        roomId = data.id;
      }


      // 서버(DB)에서 보유 포인트를 재검증하고 좌석을 배정한다.
      const { error: joinError } = await supabase.rpc("join_room", {
        _room_id: roomId,
        _spectator: false,
      });
      if (joinError) throw joinError;
      return roomId;
    },
    onSuccess: (roomId) => {
      void queryClient.invalidateQueries({ queryKey: ["rooms"] });
      void navigate({ to: "/game/$roomId", params: { roomId } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "입장 실패"),
  });

  return (
    <AppShell>
      {activeGame.data && (
        <div className="gold-frame panel-surface mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <p className="text-sm">
            진행 중인 게임이 있습니다 —{" "}
            <span className="text-gold">{activeGame.data.room_title}</span>
          </p>
          <Button
            variant="gold"
            size="sm"
            onClick={() => void navigate({ to: "/game/$roomId", params: { roomId: activeGame.data!.room_id } })}
          >
            게임으로 복귀
          </Button>
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-gold-plate font-display text-2xl">채널 선택</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            채널별 최소 입장 포인트와 기본 베팅은 운영 설정으로 고정됩니다.
          </p>
        </div>
        <p className="text-sm text-gold-soft">
          보유 포인트 <span className="font-display">{formatPoints(profile?.game_points ?? 0)}</span>
        </p>
      </header>

      <div className="panel-surface mt-4 rounded-2xl p-4">
        <label htmlFor="room-title" className="text-xs text-gold-soft">
          방 제목 <span className="text-muted-foreground">(선택 · 최대 {ROOM_TITLE_MAX}글자)</span>
        </label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <input
            id="room-title"
            value={roomTitle}
            maxLength={ROOM_TITLE_MAX}
            onChange={(e) => setRoomTitle(e.target.value)}
            placeholder="예) 오늘 한판 갑시다"
            className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50 sm:min-w-[220px] sm:flex-1"
          />
          <span className="text-[11px] text-muted-foreground">
            {roomTitle.trim().length}/{ROOM_TITLE_MAX}
          </span>
          <select
            aria-label="채널 선택"
            value={createTierId}
            onChange={(e) => setCreateTierId(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50 sm:min-h-0 sm:w-auto"
          >
            {(tiers.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            aria-label="게임 모드 선택"
            value={createMode}
            onChange={(e) => setCreateMode(e.target.value as GameMode)}
            className="min-h-[44px] w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50 sm:min-h-0 sm:w-auto"
          >
            {createModes.map((m) => (
              <option key={m} value={m}>
                {GAME_MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <Button
            variant="gold"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={!user || !createTier || createLowPoints || enterTier.isPending}
            onClick={() =>
              createTier &&
              enterTier.mutate({ tierId: createTier.id, mode: createMode, forceNew: true })
            }
          >
            {enterTier.isPending ? "생성 중..." : "방 만들기"}
          </Button>
        </div>
        {user && createTier && createLowPoints && (
          <p className="mt-1 text-[11px] text-crimson">
            보유 포인트가 부족합니다. 충전 후 방을 만들어 주세요.
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          제목을 입력하면 입력한 제목으로 새 테이블이 열립니다. 비워두면 열려 있는 테이블에 입장하고
          기본 제목이 사용됩니다. 같은 제목은 여러 개 만들 수 있으며 테이블 번호로 구분됩니다.
        </p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {(tiers.data ?? []).map((tier) => {
          const list = roomsOfTier(tier.id);
          const players = list.reduce((sum, r) => sum + r.current_players, 0);
          const playing = list.filter((r) => r.status === "playing").length;
          const lowPoints = (profile?.game_points ?? 0) < tier.min_points;
          return (
            <section
              key={tier.id}
              className="panel-surface gold-frame relative overflow-hidden rounded-2xl p-6"
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b to-transparent opacity-70",
                  TIER_ACCENT[tier.id] ?? "from-gold/20",
                )}
              />
              <div className="relative">
                <h2 className="font-display text-2xl text-gold">{tier.name}</h2>
                <dl className="mt-5 space-y-2 text-xs">
                  <Row label="최소 입장" value={formatPoints(tier.min_points)} />
                  <Row label="기본 베팅" value={formatPoints(tier.base_bet)} />
                  <Row label="정원" value={`${tier.max_players}명 / 테이블`} />
                  <Row label="현재 접속자" value={`${players}명`} />
                  <Row label="진행 중 게임" value={`${playing}판`} />
                  <Row label="열린 테이블" value={`${list.length}개`} />
                </dl>

                <div className="mt-5 grid gap-2">
                  {(["sutda2", "sutda3"] as GameMode[])
                    .filter((m) => (m === "sutda2" ? tier.allow_sutda2 : tier.allow_sutda3))
                    .map((m) => (
                      <Button
                        key={m}
                        variant={m === "sutda2" ? "gold" : "goldOutline"}
                        disabled={!user || lowPoints || enterTier.isPending}
                        onClick={() => enterTier.mutate({ tierId: tier.id, mode: m })}
                      >
                        {GAME_MODE_LABEL[m]} 입장
                      </Button>
                    ))}
                  {!user && (
                    <Button variant="table" asChild>
                      <Link to="/auth">로그인 후 이용 가능</Link>
                    </Button>
                  )}
                  {user && lowPoints && (
                    <p className="text-center text-[11px] text-crimson">
                      보유 포인트가 부족합니다. 충전 후 입장해 주세요.
                    </p>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-8">
        <h2 className="text-gold-plate font-display text-lg">열려 있는 테이블</h2>
        <div className="mt-3 space-y-2">
          {(rooms.data ?? []).map((room) => {
            const full = room.current_players >= room.max_players;
            const lowPoints = (profile?.game_points ?? 0) < room.min_points;
            return (
              <div
                key={room.id}
                className="panel-surface flex flex-wrap items-center gap-4 rounded-xl px-5 py-3.5"
              >
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{room.title}</p>
                    <span className="shrink-0 rounded-full bg-gold/12 px-2 py-[1px] font-display text-[11px] text-gold">
                      #{room.room_number}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {GAME_MODE_LABEL[room.game_mode as GameMode] ?? room.game_mode} · 기본{" "}
                    {formatPoints(room.base_bet)} · 최소 입장 {formatPoints(room.min_points)}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    room.status === "playing"
                      ? "bg-crimson/15 text-crimson"
                      : "bg-jade/15 text-jade",
                  )}
                >
                  {room.status === "playing" ? "게임중" : "대기중"}
                </span>
                <span className="text-sm text-gold-soft">
                  {room.current_players}/{room.max_players}
                </span>
                <Button variant={full ? "table" : "gold"} size="sm" asChild disabled={lowPoints}>
                  <Link to="/game/$roomId" params={{ roomId: room.id }}>
                    {full ? "관전" : lowPoints ? "포인트 부족" : "입장"}
                  </Link>
                </Button>
              </div>
            );
          })}
          {rooms.data?.length === 0 && (
            <p className="panel-surface rounded-xl px-5 py-8 text-center text-sm text-muted-foreground">
              아직 열린 테이블이 없습니다. 위 채널에서 입장하면 새 테이블이 열립니다.
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-display text-sm text-gold-soft">{value}</dd>
    </div>
  );
}
