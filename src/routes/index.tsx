import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { EventPopupHost } from "@/components/layout/EventPopupHost";
import { HandRankChart } from "@/components/game/HandRankChart";
import { CardRow } from "@/components/game/HwatuCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatPoints } from "@/lib/services/walletService";
import { GAME_MODE_LABEL, type GameMode } from "@/lib/game/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "엔젤섯다 ANGEL SUTDA · 프리미엄 온라인 섯다" },
      {
        name: "description",
        content:
          "실시간 온라인 섯다 웹게임 엔젤섯다. 2장·3장 섯다, 38광땡부터 망통까지 정통 족보와 프리미엄 홀덤 테이블에서 즐기세요.",
      },
      { property: "og:title", content: "엔젤섯다 ANGEL SUTDA · 프리미엄 온라인 섯다" },
      {
        property: "og:description",
        content: "정통 화투 족보와 실시간 대전. 지금 엔젤섯다 테이블에 입장하세요.",
      },
    ],
    links: [{ rel: "canonical", href: "https://angel-sd.com/" }],
  }),
  component: Lobby,
});

function Lobby() {
  const { user, profile } = useAuth();

  const rooms = useQuery({
    queryKey: ["lobby-rooms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_rooms")
        .select("id, title, game_mode, base_bet, current_players, max_players, status")
        .neq("status", "closed")
        .neq("status", "deleted")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  const top = useQuery({
    queryKey: ["lobby-ranking"],
    // 회원 프로필은 로그인 회원만 조회 가능 (비로그인 노출 차단)
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nickname, level, rank_points, wins")
        .order("rank_points", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <AppShell>
      <EventPopupHost placement="LOBBY" />
      <section className="relative overflow-hidden rounded-3xl border border-gold/20 bg-black/40 px-8 py-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{ background: "var(--gradient-felt)" }}
        />
        <div className="relative grid gap-10 lg:grid-cols-[1.35fr_1fr] lg:items-center">
          <div>
            <img src="/brand/angel-sutda-logo.png" alt="엔젤섯다 ANGEL SUTDA" className="h-32 w-auto" />
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-foreground/80">
              정통 화투 20장, 38광땡부터 망통까지.
              <br />
              한 판의 긴장감과 역전의 재미를 그대로 담은 프리미엄 섯다를 즐겨보세요.
              <br />
              2장 섯다와 3장 섯다를 모두 지원합니다.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button variant="gold" size="lg" asChild>
                <Link to="/rooms">게임방 입장</Link>
              </Button>
              {!user && (
                <Button variant="goldOutline" size="lg" asChild>
                  <Link to="/auth">회원가입</Link>
                </Button>
              )}
            </div>
            {profile && (
              <div className="mt-7 flex flex-wrap gap-6 text-sm">
                <Stat label="보유 포인트" value={formatPoints(profile.game_points)} />
                <Stat label="전적" value={`${profile.wins}승 ${profile.losses}패`} />
                <Stat label="랭크 포인트" value={profile.rank_points.toLocaleString("ko-KR")} />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-center gap-4">
            <CardRow cards={["03-gwang", "08-gwang"]} size="lg" />
            <p className="font-display text-xl text-gold">38광땡</p>
            <p className="max-w-[16rem] text-center text-[11px] leading-relaxed text-muted-foreground">한 장의 패가 승부를 뒤집는다.</p>
          </div>
        </div>
      </section>


      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <section className="panel-surface rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-gold-plate font-display text-xl">진행 중인 방</h2>
              <Link to="/rooms" className="text-xs text-gold-soft hover:text-gold">
                전체 보기 →
              </Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(rooms.data ?? []).map((room) => (
                <Link
                  key={room.id}
                  to="/game/$roomId"
                  params={{ roomId: room.id }}
                  className="rounded-xl border border-gold/15 bg-black/35 p-4 transition-colors hover:border-gold/50"
                >
                  <p className="truncate text-sm font-semibold text-foreground">{room.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {GAME_MODE_LABEL[room.game_mode as GameMode] ?? room.game_mode} · 기본{" "}
                    {formatPoints(room.base_bet)}
                  </p>
                  <p className="mt-2 text-xs text-gold-soft">
                    {room.current_players}/{room.max_players}명
                  </p>
                </Link>
              ))}
              {rooms.data?.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  아직 열린 방이 없습니다. 첫 방을 만들어 보세요.
                </p>
              )}
            </div>
          </section>

          <section className="panel-surface rounded-2xl p-5">
            <h2 className="text-gold-plate font-display text-xl">주간 랭킹</h2>
            <ul className="mt-3 divide-y divide-border/60">
              {(top.data ?? []).map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="font-display w-6 text-gold">{i + 1}</span>
                  <span className="flex-1 truncate">{p.nickname}</span>
                  <span className="text-xs text-muted-foreground">Lv.{p.level}</span>
                  <span className="text-gold-soft">{p.rank_points.toLocaleString("ko-KR")}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <HandRankChart />
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-display text-lg text-gold">{value}</p>
    </div>
  );
}
