import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { signInWithUsername } from "@/lib/services/accountService";
import { formatPoints } from "@/lib/services/walletService";
import { loadTelegramSdk } from "@/lib/telegram/miniApp";
import { telegramLink, telegramLogin } from "@/lib/telegram/telegram.functions";

/** Original production login unchanged; lazily imported on NON-Railway builds. */
type Stage = "loading" | "outside" | "choose" | "link" | "ready" | "error";

export default function LegacyTelegramEntry() {
  const [stage, setStage] = useState<Stage>("loading");
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const initData = useRef("");
  const login = useServerFn(telegramLogin);
  const link = useServerFn(telegramLink);
  const { profile } = useAuth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wa = await loadTelegramSdk();
      if (cancelled) return;
      if (!wa) return setStage("outside");
      wa.ready();
      wa.expand();
      initData.current = wa.initData;
      try {
        const r = await login({ data: { initData: wa.initData } });
        if (r.linked) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash, type: "magiclink" });
          if (error) throw new Error("로그인에 실패했습니다. 미니앱을 다시 열어 주세요.");
          setStage("ready");
        } else {
          setStage("choose");
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "오류가 발생했습니다.");
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [login]);

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await signInWithUsername(form.username.trim().toLowerCase(), form.password);
      await link({ data: { initData: initData.current } });
      toast.success("텔레그램 계정이 연결되었습니다. 다음부터 자동으로 입장합니다.");
      setStage("ready");
    } catch (e) {
      await supabase.auth.signOut().catch(() => undefined);
      toast.error(e instanceof Error ? e.message : "연결에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-5"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 24px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
      }}
    >
      <div className="w-full max-w-sm space-y-5">
        <img src="/brand/angel-sutda-logo.png" alt="엔젤섯다" className="mx-auto h-16 w-auto" />

        {stage === "loading" && <p className="text-center text-sm text-muted-foreground">텔레그램 인증 확인 중…</p>}

        {stage === "outside" && (
          <div className="panel-surface gold-frame space-y-3 rounded-2xl p-6 text-center">
            <p className="text-sm">이 페이지는 텔레그램 앱 안에서 열어 주세요.</p>
            <Button variant="gold" asChild className="w-full">
              <Link to="/">웹사이트로 이동</Link>
            </Button>
          </div>
        )}

        {stage === "error" && (
          <div className="panel-surface gold-frame rounded-2xl p-6 text-center text-sm text-crimson">{err}</div>
        )}

        {stage === "choose" && (
          <div className="panel-surface gold-frame space-y-3 rounded-2xl p-6">
            <p className="text-center text-sm text-muted-foreground">
              처음 오셨네요. 엔젤섯다 계정을 텔레그램과 연결해 주세요.
            </p>
            <Button variant="gold" className="h-12 w-full" onClick={() => setStage("link")}>
              기존 ANGEL 계정 연결
            </Button>
            <Button variant="table" className="h-12 w-full" asChild>
              <Link to="/auth">신규 가입</Link>
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              가입 후 이 미니앱을 다시 열어 "기존 계정 연결"을 눌러 주세요.
            </p>
          </div>
        )}

        {stage === "link" && (
          <form onSubmit={submitLink} className="panel-surface gold-frame space-y-4 rounded-2xl p-6">
            <h1 className="text-gold-plate font-display text-center text-xl">기존 계정 연결</h1>
            <div className="space-y-1.5">
              <Label htmlFor="tg-username">아이디</Label>
              <Input id="tg-username" autoComplete="username" value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tg-password">비밀번호</Label>
              <Input id="tg-password" type="password" autoComplete="current-password" value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
            </div>
            <Button type="submit" variant="gold" className="h-12 w-full" disabled={busy}>
              {busy ? "연결 중…" : "연결하고 입장하기"}
            </Button>
            <button type="button" onClick={() => setStage("choose")}
              className="w-full text-center text-xs text-muted-foreground">
              뒤로
            </button>
          </form>
        )}

        {stage === "ready" && (
          <div className="panel-surface gold-frame space-y-4 rounded-2xl p-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">{profile ? `Lv.${profile.level} ${profile.nickname}` : "…"}</p>
              <p className="font-display text-2xl text-gold">{profile ? formatPoints(profile.game_points) : ""}</p>
            </div>
            <Button variant="gold" className="h-14 w-full text-base" asChild>
              <Link to="/">게임 입장</Link>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="table" className="h-12" asChild><Link to="/rooms">섯다 (2장·3장)</Link></Button>
              <Button variant="table" className="h-12" asChild><Link to="/dori">도리짓고땡</Link></Button>
              <Button variant="table" className="h-12" asChild><Link to="/wallet">충전/출금</Link></Button>
              <Button variant="table" className="h-12" asChild><Link to="/ranking">랭킹</Link></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
