import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { OpsBanner } from "@/components/layout/OpsBanner";
import { useOfficialChannelLink, useSupportLink } from "@/hooks/useSupportLink";
import { toast } from "sonner";
import { RankBadge } from "@/components/rank/RankBadge";
import { syncMyRank } from "@/lib/services/rankingService";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAdminEvent } from "@/lib/services/roleService";
import { formatPoints } from "@/lib/services/walletService";

const NAV = [
  { to: "/", label: "로비" },
  { to: "/rooms", label: "섯다 입장" },
  { to: "/dori", label: "도리짓고땡 입장" },
  { to: "/ranking", label: "랭킹" },
  { to: "/shop", label: "상점" },
  { to: "/wallet", label: "충전/출금" },
  { to: "/notices", label: "공지사항" },
] as const;


/**
 * chrome=false → 게임 집중모드(게임모드). 글로벌 헤더/네비/운영배너/푸터/외부 여백을 숨기고
 * 게임 화면이 사용 가능한 세로 공간을 모두 쓰게 한다. (게임 로직과 무관한 표현 레이어)
 */
export function AppShell({
  children,
  chrome = true,
  /**
   * true → 게임모드 root 를 100vh/overflow hidden 으로 고정한다 (페이지 세로 스크롤 0).
   * 기본값 false 이므로 일반 페이지 / 3장 섯다 / 도리짓고땡 동작은 그대로 유지된다.
   */
  fitViewport = false,
}: {
  children: ReactNode;
  chrome?: boolean;
  fitViewport?: boolean;
}) {
  const fitMode = fitViewport && !chrome;
  const { user, profile, isAdmin } = useAuth();
  const { link: supportLink } = useSupportLink();
  const { link: channelLink } = useOfficialChannelLink();

  function openSupport() {
    if (!supportLink) {
      toast.error("고객센터가 아직 설정되지 않았습니다.");
      return;
    }
    window.open(supportLink, "_blank", "noopener,noreferrer");
  }

  function openOfficialChannel() {
    if (!channelLink) {
      toast.error("공식채널이 아직 설정되지 않았습니다.");
      return;
    }
    window.open(channelLink, "_blank", "noopener,noreferrer");
  }
  const affiliate = useQuery({
    queryKey: ["my-affiliate", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("affiliates")
        .select("id, status")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // 세션당 1회 계급 동기화 — 미수령 계급 보상/전용 아이템을 서버가 지급한다.
  useQuery({
    queryKey: ["sync-rank", user?.id],
    enabled: !!user,
    staleTime: Infinity,
    retry: false,
    queryFn: syncMyRank,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  async function signOut() {
    if (isAdmin) await logAdminEvent("ADMIN_LOGOUT").catch(() => undefined);
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className={fitMode ? "h-screen min-h-0 overflow-hidden" : "min-h-screen"}>
      {chrome && (
      <header className="sticky top-0 z-40 border-b border-gold/15 bg-black/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-3 sm:gap-6 sm:px-5">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="메뉴 열기"
                className="shrink-0 rounded-lg p-2 text-gold-soft/80 transition-colors hover:text-gold md:hidden"
              >
                <Menu className="h-6 w-6" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[82vw] max-w-xs overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="text-gold">메뉴</SheetTitle>
              </SheetHeader>
              <nav className="mt-4 flex flex-col gap-1">
                {NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    activeOptions={{ exact: item.to === "/" }}
                    activeProps={{ className: "text-gold bg-gold/10" }}
                    inactiveProps={{ className: "text-foreground/80 hover:text-gold" }}
                    className="rounded-lg px-3 py-3 text-sm font-medium transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
                {affiliate.data && (
                  <Link
                    to="/affiliate"
                    onClick={() => setMenuOpen(false)}
                    activeProps={{ className: "text-gold bg-gold/10" }}
                    inactiveProps={{ className: "text-gold-soft/90 hover:text-gold" }}
                    className="rounded-lg px-3 py-3 text-sm font-semibold transition-colors"
                  >
                    총판 센터
                  </Link>
                )}
                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setMenuOpen(false)}
                    activeProps={{ className: "text-crimson bg-crimson/10" }}
                    inactiveProps={{ className: "text-crimson/80 hover:text-crimson" }}
                    className="rounded-lg px-3 py-3 text-sm font-semibold transition-colors"
                  >
                    관리자
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    openSupport();
                  }}
                  className="rounded-lg px-3 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:text-gold"
                >
                  고객센터
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    openOfficialChannel();
                  }}
                  className="rounded-lg px-3 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:text-gold"
                >
                  공식채널입장
                </button>
              </nav>
            </SheetContent>
          </Sheet>

          <Link to="/" className="flex min-w-0 items-center gap-2">
            <img src="/brand/angel-sutda-logo.png" alt="엔젤섯다" className="h-9 w-auto sm:h-11" />
          </Link>


          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/" }}
                activeProps={{ className: "text-gold bg-gold/10" }}
                inactiveProps={{ className: "text-foreground/70 hover:text-gold" }}
                className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              >
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={openSupport}
              className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:text-gold"
            >
              고객센터
            </button>
            <button
              type="button"
              onClick={openOfficialChannel}
              className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/70 transition-colors hover:text-gold"
            >
              공식채널입장
            </button>
            {affiliate.data && (
              <Link
                to="/affiliate"
                activeProps={{ className: "text-gold bg-gold/10" }}
                inactiveProps={{ className: "text-gold-soft/80 hover:text-gold" }}
                className="rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
              >
                총판 센터
              </Link>
            )}
            {isAdmin && (
              <Link
                to="/admin"
                activeProps={{ className: "text-crimson bg-crimson/10" }}
                inactiveProps={{ className: "text-crimson/70 hover:text-crimson" }}
                className="rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
              >
                관리자
              </Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {profile ? (
              <>
                <RankBadge rank={profile.rank} className="hidden sm:inline-flex" />
                <div className="hidden text-right sm:block">
                  <p className="text-xs text-muted-foreground">
                    Lv.{profile.level} {profile.nickname}
                  </p>
                  <p className="font-display text-sm text-gold">
                    {formatPoints(profile.game_points)}
                  </p>
                </div>
                <Button variant="table" size="sm" onClick={signOut}>
                  로그아웃
                </Button>
              </>
            ) : (
              <Button variant="gold" size="sm" asChild>
                <Link to="/auth">{user ? "내 정보" : "로그인 / 회원가입"}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      )}

      <main
        className={
          chrome
            ? "mx-auto max-w-[1400px] space-y-4 px-5 py-8"
            : fitMode
              ? "h-full min-h-0 w-full max-w-none overflow-hidden px-0 py-0"
              : "w-full max-w-none px-0 py-0"
        }
      >
        {chrome && <OpsBanner />}
        {children}
      </main>

      {chrome && (
        <footer className="border-t border-gold/10 py-6 text-center text-[11px] text-muted-foreground">
          ANGEL SUTDA · 본 서비스의 포인트는 게임 내 재화이며 현금과 직접 교환되지 않습니다.
        </footer>
      )}
    </div>
  );
}
