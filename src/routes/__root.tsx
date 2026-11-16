import type { ErrorComponentProps } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  useLocation,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "엔젤섯다 ANGEL SUTDA · 프리미엄 온라인 섯다" },
      {
        name: "description",
        content:
          "2장·3장 섯다를 실시간으로 즐기는 프리미엄 온라인 섯다. 38광땡부터 망통까지 정통 족보와 안전한 포인트 시스템.",
      },
      { name: "author", content: "ANGEL SUTDA" },
      { property: "og:title", content: "엔젤섯다 ANGEL SUTDA" },
      {
        property: "og:description",
        content: "프리미엄 홀덤 테이블에서 즐기는 실시간 온라인 섯다.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700;900&display=swap",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],

  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useLocation({ select: (location) => location.pathname });
  const railwayPreview = import.meta.env['VITE_RAILWAY_TELEGRAM_PREVIEW'] === "true";
  // Staging only: do not accidentally expose Supabase-dependent game/wallet UI.
  const showPreviewGate = railwayPreview && pathname !== "/telegram";

  return (
    <QueryClientProvider client={queryClient}>
      {showPreviewGate ? (
        <main className="flex min-h-screen items-center justify-center bg-background px-5">
          <div className="panel-surface gold-frame w-full max-w-md space-y-4 rounded-2xl p-6 text-center">
            <h1 className="text-xl font-bold text-gold">엔젤섯다 테스트 준비 중</h1>
            <p className="text-sm text-muted-foreground">
              현재는 텔레그램 로그인만 검증 중입니다.
              게임·충전·출금·정산 기능은 안전 점검 후 공개됩니다.
            </p>
            <Link to="/telegram" className="text-gold underline">텔레그램 로그인 화면</Link>
          </div>
        </main>
      ) : (
        <Outlet />
      )}
      <Toaster />
    </QueryClientProvider>
  );
}
