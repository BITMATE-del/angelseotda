import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadTelegramSdk } from "@/lib/telegram/miniApp";

interface AngelAccount {
  id: string;
  telegramId: string;
  nickname: string;
  balance: string;
  status: string;
}
type Screen = "checking" | "outside" | "ready" | "unavailable" | "error";

/**
 * Staging-only Telegram sign-in preview.
 * Deliberately separated from the Supabase-dependent game UI:
 * successful login does not imply game, wallet or deposit readiness.
 */
export function RailwayTelegramPreview() {
  const [screen, setScreen] = useState<Screen>("checking");
  const [account, setAccount] = useState<AngelAccount | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const authenticate = async () => {
      const webapp = await loadTelegramSdk();
      if (!active) return;
      if (!webapp?.initData) {
        setScreen("outside");
        return;
      }
      webapp.ready();
      webapp.expand();
      try {
        const check = await fetch("/api/public/railway-auth", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (check.status === 404) {
          if (active) setScreen("unavailable");
          return;
        }
        if (check.ok) {
          const current = await check.json() as { account?: AngelAccount };
          if (current.account) {
            if (active) { setAccount(current.account); setScreen("ready"); }
            return;
          }
        }
        const login = await fetch("/api/public/railway-auth", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: webapp.initData }),
        });
        if (login.status === 404) {
          if (active) setScreen("unavailable");
          return;
        }
        if (!login.ok) throw new Error("텔레그램 인증에 실패했습니다. 미니앱을 닫고 다시 열어 주세요.");
        const response = await login.json() as { ok?: boolean; account?: AngelAccount };
        if (!response.ok || !response.account) throw new Error("로그인 결과를 확인할 수 없습니다.");
        if (active) { setAccount(response.account); setScreen("ready"); }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setMessage(error instanceof Error ? error.message : "로그인 연결에 실패했습니다.");
        setScreen("error");
      }
    };
    void authenticate();
    return () => { active = false; controller.abort(); };
  }, []);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/public/railway-auth", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("로그아웃 실패");
      setAccount(null);
      setScreen("outside");
    } catch {
      setMessage("로그아웃에 실패했습니다. 다시 시도해 주세요.");
      setScreen("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-8">
      <section className="panel-surface gold-frame w-full max-w-sm space-y-5 rounded-2xl p-6 text-center">
        <img src="/brand/angel-sutda-logo.png" alt="엔젤섯다" className="mx-auto h-16 w-auto" />
        <h1 className="font-display text-xl text-gold">엔젤섯다</h1>
        {screen === "checking" && <p role="status" className="text-sm">텔레그램 인증 확인 중…</p>}
        {screen === "outside" && (
          <>
            <p className="text-sm">텔레그램 앱에서 엔젤섯다 미니앱으로 접속해 주세요.</p>
            <a className="text-sm text-gold underline" href="https://t.me/angelsda_bot" rel="noopener noreferrer">
              텔레그램 봇 열기
            </a>
          </>
        )}
        {screen === "unavailable" && (
          <p role="status" className="text-sm">테스트 로그인 기능이 아직 활성화되지 않았습니다.</p>
        )}
        {screen === "error" && <p role="alert" className="text-sm text-crimson">{message}</p>}
        {screen === "ready" && account && (
          <>
            <p className="text-lg font-semibold">{account.nickname}님, 인증이 완료됐습니다.</p>
            <p className="text-sm text-muted-foreground">계정 잔액</p>
            <p className="font-display text-2xl text-gold">{account.balance} P</p>
            <p className="text-sm text-muted-foreground">
              현재는 로그인 시험 단계입니다. 게임 입장·베팅·충전·출금은 아직 활성화되지 않았습니다.
            </p>
            <Button className="h-11 w-full" variant="table" onClick={() => void signOut()} disabled={busy}>
              {busy ? "로그아웃 중…" : "로그아웃"}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
