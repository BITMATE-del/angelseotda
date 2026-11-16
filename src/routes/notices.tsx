import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/services/adminService";

export const NOTICE_CATEGORY_LABEL: Record<string, string> = {
  system: "시스템",
  event: "이벤트",
  maintenance: "점검",
};

export const Route = createFileRoute("/notices")({
  head: () => ({
    meta: [
      { title: "공지사항 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content: "엔젤섯다 점검·이벤트·시스템 공지사항을 확인하세요.",
      },
      { property: "og:title", content: "공지사항 · 엔젤섯다" },
      { property: "og:description", content: "점검, 이벤트, 시스템 공지를 한 곳에서 확인하세요." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://angel-sd.com/notices" }],
  }),
  errorComponent: () => (
    <AppShell>
      <p className="panel-surface rounded-2xl p-8 text-center text-sm">
        공지사항을 불러오지 못했습니다.
      </p>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <p className="panel-surface rounded-2xl p-8 text-center text-sm">공지를 찾을 수 없습니다.</p>
    </AppShell>
  ),
  component: NoticesPage,
});

function NoticesPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");

  const notices = useQuery({
    queryKey: ["notices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notices")
        .select("*")
        .eq("published", true)
        .order("pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const list = (notices.data ?? []).filter(
    (n) => category === "all" || (n.category ?? "system") === category,
  );

  return (
    <AppShell>
      <h1 className="text-gold-plate font-display text-2xl">공지사항</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        점검·이벤트·시스템 안내를 확인하실 수 있습니다.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {([["all", "전체"], ...Object.entries(NOTICE_CATEGORY_LABEL)] as [string, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setCategory(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              category === id
                ? "border-gold/50 bg-gold/12 text-gold"
                : "border-border text-foreground/70 hover:text-gold",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {notices.isLoading && (
          <p className="panel-surface rounded-2xl p-6 text-center text-sm text-muted-foreground">
            불러오는 중…
          </p>
        )}
        {!notices.isLoading && list.length === 0 && (
          <p className="panel-surface rounded-2xl p-6 text-center text-sm text-muted-foreground">
            등록된 공지가 없습니다.
          </p>
        )}
        {list.map((notice) => (
          <article key={notice.id} className="panel-surface overflow-hidden rounded-2xl">
            <button
              type="button"
              onClick={() => setOpenId(openId === notice.id ? null : notice.id)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left"
            >
              {notice.pinned && (
                <span className="rounded bg-crimson/20 px-2 py-0.5 text-[10px] font-semibold text-crimson">
                  고정
                </span>
              )}
              <span className="rounded bg-gold/12 px-2 py-0.5 text-[10px] text-gold">
                {NOTICE_CATEGORY_LABEL[notice.category ?? "system"] ?? "시스템"}
              </span>
              <span className="flex-1 truncate text-sm font-semibold text-foreground">
                {notice.title}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatDateTime(notice.created_at)}
              </span>
            </button>
            {openId === notice.id && (
              <div className="border-t border-gold/10 px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/80">
                {notice.body}
              </div>
            )}
          </article>
        ))}
      </div>
    </AppShell>
  );
}
