import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AuthFlowError, signInWithUsername, signUpWithUsername } from "@/lib/services/accountService";
import { logSignupFailure } from "@/lib/auth/signupLog.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "로그인 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content: "아이디와 비밀번호로 엔젤섯다에 로그인하고 실시간 섯다 테이블에 입장하세요.",
      },
      { property: "og:title", content: "로그인 · 엔젤섯다" },
      { property: "og:description", content: "프리미엄 온라인 섯다, 엔젤섯다에 입장하세요." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  /** 총판 추천 링크(/auth?code=XXX)로 들어오면 가입코드를 미리 채운다 */
  const initialCode =
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase();
  const [mode, setMode] = useState<"login" | "signup">(initialCode ? "signup" : "login");
  const [form, setForm] = useState({
    username: "",
    password: "",
    nickname: "",
    telegram: "",
    wallet: "",
    code: initialCode,
  });
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { user, role, roleLoading } = useAuth();


  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  useEffect(() => {
    if (!user || roleLoading) return;
    // 서버가 판정한 역할에 따라 이동한다. (관리자 → 운영 콘솔)
    if (role === "admin" || role === "super_admin") {
      void navigate({ to: "/admin", replace: true });
    } else {
      void navigate({ to: "/", replace: true });
    }
  }, [user, role, roleLoading, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const username = form.username.trim().toLowerCase();
        const invalid = (msg: string, field: string) => {
          throw new AuthFlowError(msg, "validation", `invalid_${field}`, { field });
        };
        if (!/^[a-z0-9_]{4,16}$/.test(username))
          invalid("아이디는 영문 소문자·숫자·밑줄 4~16자로 입력해 주세요.", "username");
        if (form.nickname.trim().length < 2) invalid("닉네임은 2자 이상 입력해 주세요.", "nickname");
        if (form.password.length < 6) invalid("비밀번호는 6자 이상 입력해 주세요.", "password");
        if (!form.telegram.trim()) invalid("텔레그램 아이디를 입력해 주세요.", "telegram");
        if (!form.wallet.trim()) invalid("지갑주소를 입력해 주세요.", "wallet");

        const { data: available, error: checkError } = await supabase.rpc("username_available", {
          _username: username,
        });
        if (checkError)
          throw new AuthFlowError(
            "아이디 중복 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.",
            "username_check",
            checkError.code ?? "rpc_error",
            { raw: checkError.message },
          );
        if (!available)
          throw new AuthFlowError(
            "이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.",
            "username_check",
            "username_taken",
          );

        await signUpWithUsername({
          username,
          password: form.password,
          nickname: form.nickname.trim(),
          telegramId: form.telegram.trim(),
          walletAddress: form.wallet.trim(),
          signupCode: form.code.trim(),
        });
        toast.success("가입이 완료되었습니다.", {
          description: "텔레그램 아이디와 지갑주소는 가입 후 변경할 수 없습니다.",
        });
      } else {
        await signInWithUsername(form.username.trim().toLowerCase(), form.password);
        toast.success("환영합니다!");
      }
    } catch (error) {
      const friendly =
        error instanceof Error
          ? error.message
          : "요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
      if (mode === "signup") {
        // 사용자에게는 친절한 안내만, 상세 원인은 서버 로그로만 남긴다.
        void logSignupFailure({
          data: {
            stage: error instanceof AuthFlowError ? error.stage : "unknown",
            errorCode: error instanceof AuthFlowError ? error.code : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            username: form.username.trim().toLowerCase() || undefined,
            detail: error instanceof AuthFlowError ? error.detail : undefined,
          },
        }).catch(() => {});
      }
      toast.error(friendly);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex justify-center">
          <img
            src="/brand/angel-sutda-logo.png"
            alt="엔젤섯다"
            className="h-16 w-auto object-contain"
          />
        </Link>

        <div className="panel-surface gold-frame rounded-2xl p-7">
          <h1 className="text-gold-plate font-display text-center text-2xl">
            {mode === "login" ? "로그인" : "회원가입"}
          </h1>
          <p className="mt-1 text-center text-xs text-muted-foreground">엔젤섯다 · ANGEL SUTDA</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">아이디</Label>
              <Input
                id="username"
                value={form.username}
                maxLength={16}
                autoComplete="username"
                onChange={set("username")}
                placeholder="영문 소문자·숫자 4~16자"
                required
              />
            </div>

            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="nickname">닉네임</Label>
                <Input
                  id="nickname"
                  value={form.nickname}
                  maxLength={12}
                  onChange={set("nickname")}
                  placeholder="테이블에 표시될 이름"
                  required
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                minLength={6}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onChange={set("password")}
                placeholder="6자 이상"
                required
              />
            </div>

            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="telegram">텔레그램 아이디</Label>
                  <Input
                    id="telegram"
                    value={form.telegram}
                    maxLength={64}
                    onChange={set("telegram")}
                    placeholder="@angel_sutda"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wallet">지갑주소</Label>
                  <Input
                    id="wallet"
                    value={form.wallet}
                    maxLength={120}
                    onChange={set("wallet")}
                    placeholder="USDT (TRC20) 주소"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="code">가입코드 (선택)</Label>
                  <Input
                    id="code"
                    value={form.code}
                    maxLength={20}
                    onChange={set("code")}
                    placeholder="총판 코드가 있으면 입력"
                  />
                </div>
                <p className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
                  텔레그램 아이디와 지갑주소는 가입 후 회원이 직접 변경할 수 없습니다. 변경이
                  필요하면 관리자에게 문의해 주세요.
                </p>
              </>
            )}

            <Button type="submit" variant="gold" className="w-full" disabled={busy}>
              {mode === "login" ? "입장하기" : "가입하고 입장하기"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="mt-5 w-full text-center text-xs text-muted-foreground transition-colors hover:text-gold"
          >
            {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
          </button>
        </div>
      </div>
    </div>
  );
}
