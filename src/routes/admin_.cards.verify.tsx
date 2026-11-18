import { createFileRoute, Link } from "@tanstack/react-router";
import { GWANG_IDS, SUTDA_CARDS } from "@/data/sutdaCards";
import { HwatuCard } from "@/components/game/HwatuCard";
import { AdminGuard } from "@/components/admin/AdminGuard";

export const Route = createFileRoute("/admin_/cards/verify")({
  component: () => (
    <AdminGuard>
      <CardVerifyPage />
    </AdminGuard>
  ),
  head: () => ({
    meta: [
      { title: "카드 에셋 검수 · ANGEL SUTDA 운영 콘솔" },
      {
        name: "description",
        content: "ANGEL SUTDA 기본 화투 카드 20장의 에셋 경로와 광 카드 설정을 검수합니다.",
      },
      { property: "og:title", content: "카드 에셋 검수 · ANGEL SUTDA" },
      {
        property: "og:description",
        content: "기본 화투 카드 20장 · 광 카드 3장 구성을 확인하는 운영자 검수 페이지.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function CardVerifyPage() {
  const total = SUTDA_CARDS.length;
  const gwang = SUTDA_CARDS.filter((c) => c.isGwang);
  const normal = total - gwang.length;
  const gwangIdsOk =
    gwang.length === GWANG_IDS.length && gwang.every((c) => (GWANG_IDS as readonly string[]).includes(c.id));
  const configError = total !== 20 || gwang.length !== 3 || !gwangIdsOk;

  return (
    <main className="min-h-screen bg-charcoal px-8 py-8 text-foreground">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl text-gold">카드 에셋 검수</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              /public/cards/hwatu/base/ 실제 이미지 파일 20장만 기본 카드로 사용합니다.
            </p>
          </div>
          <Link to="/admin" className="text-sm text-gold-soft underline">
            운영 콘솔로
          </Link>
        </div>

        <div className="flex flex-wrap gap-3">
          <Stat label="총 카드" value={`${total}`} ok={total === 20} />
          <Stat label="광 카드" value={`${gwang.length}`} ok={gwang.length === 3 && gwangIdsOk} />
          <Stat label="일반 카드" value={`${normal}`} ok={normal === 17} />
        </div>

        {configError && (
          <p className="rounded-lg border border-crimson/60 bg-crimson/15 px-4 py-3 font-display text-lg text-crimson">
            CARD CONFIG ERROR
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-10">
          {SUTDA_CARDS.map((card) => (
            <div key={card.id} className="panel-surface rounded-xl p-3 text-center">
              <div className="flex justify-center">
                <HwatuCard cardId={card.id} size="lg" />
              </div>
              <p className="mt-2 text-xs font-semibold text-foreground">{card.id}</p>
              <p className="text-[11px] text-muted-foreground">{card.name}</p>
              <dl className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                <div>month: {card.month}</div>
                <div>variant: {card.variant}</div>
                <div className={card.isGwang ? "text-gold" : undefined}>
                  isGwang: {String(card.isGwang)}
                </div>
                <div className="break-all">{card.assetUrl}</div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="panel-surface rounded-lg px-4 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`font-display text-xl ${ok ? "text-gold" : "text-crimson"}`}>{value}</p>
    </div>
  );
}
