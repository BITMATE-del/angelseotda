import {createFileRoute} from "@tanstack/react-router";
import {lazy,Suspense} from "react";
import {RailwayTelegramPreview} from "@/components/telegram/RailwayTelegramPreview";

/**
 * Railway preview imports no legacy Supabase runtime or account services.
 * The original production entry remains intact in a lazy-only component.
 */
const LegacyTelegramEntry=lazy(()=>import("@/components/telegram/LegacyTelegramEntry"));

export const Route = createFileRoute("/telegram")({
  ssr: false,
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "텔레그램 입장 · 엔젤섯다 ANGEL SUTDA" },
      { name: "description", content: "텔레그램에서 바로 엔젤섯다에 입장하세요." },
      { property: "og:title", content: "텔레그램 입장 · 엔젤섯다" },
      { property: "og:description", content: "텔레그램 미니앱으로 엔젤섯다를 즐기세요." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelegramEntryPage,
});

function TelegramEntryPage() {
  // Only the isolated staging build uses the new Railway login.
  // The original Telegram page remains unchanged for other builds.
  if (import.meta.env['VITE_RAILWAY_TELEGRAM_PREVIEW'] === "true") {
    return <RailwayTelegramPreview />;
  }
  return <Suspense fallback={<p role="status">입장 화면 불러오는 중…</p>}><LegacyTelegramEntry /></Suspense>;
}

