import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * 보안 헤더 (클릭재킹 / MIME sniffing / referrer / 민감 페이지 캐시 방지).
 * - frame-ancestors: 자사 도메인 + Lovable 미리보기만 허용
 * - 지갑/관리자/총판/게임방 응답은 공유 캐시에 저장되지 않도록 no-store
 */
const PRIVATE_PATHS = ["/wallet", "/admin", "/affiliate", "/game/", "/dori/game/", "/api/"];

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const headers = result.response.headers;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  // 미리보기(iframe)를 막지 않기 위해 X-Frame-Options 대신 CSP frame-ancestors 사용
  headers.set(
    "Content-Security-Policy",
    "frame-ancestors 'self' https://*.lovable.app https://*.lovable.dev https://lovable.dev https://angel-sd.com https://www.angel-sd.com https://web.telegram.org",
  );
  if (PRIVATE_PATHS.some((p) => result.pathname === p || result.pathname.startsWith(p))) {
    headers.set("Cache-Control", "private, no-store, max-age=0");
  }
  return result;
});

export const startInstance = createStart(() => ({
  // The Railway-only Telegram preview must not call Supabase Auth at all.
  // Keep legacy middleware unchanged for the currently operating non-staging build.
  functionMiddleware: import.meta.env["VITE_RAILWAY_TELEGRAM_PREVIEW"] === "true"
    ? [] : [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware, securityHeadersMiddleware],
}));
