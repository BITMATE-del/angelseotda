import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { RankBadge } from "@/components/rank/RankBadge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatPoints } from "@/lib/services/walletService";
import {
  DEFAULT_EFFECT_SETTINGS,
  fetchEffectSettings,
  saveEffectSettings,
  type EffectSettings,
} from "@/lib/services/rankingService";
import { ItemThumb } from "@/components/shop/ItemThumb";
import { LoadoutShowcase } from "@/components/shop/LoadoutShowcase";
import { fetchEquippedTitle } from "@/lib/services/customTitleService";
import { CustomTitlePanel } from "@/components/shop/CustomTitlePanel";
import { CustomProfilePanel } from "@/components/shop/CustomProfilePanel";
import { RareOfferDialog } from "@/components/shop/RareOfferDialog";
import { RareOffersPanel } from "@/components/shop/RareOffersPanel";
import { fetchRareOwners } from "@/lib/services/rareOfferService";
import {
  purchaseErrorMessage,
  rareOwnerOf,
  shopActionState,
} from "@/lib/shop/rareOwnership";
import { itemKind, KIND_LABEL, rarityRing, type ItemKind } from "@/lib/shop/itemVisuals";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "상점 · 인벤토리 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content:
          "카드 뒷면 스킨과 이모티콘을 포인트로 구매하고, 계급 달성으로 받은 전용 스킨·이펙트를 인벤토리에서 장착하세요.",
      },
      { property: "og:title", content: "상점 · 인벤토리 · 엔젤섯다" },
      { property: "og:description", content: "나만의 카드 스킨과 계급 전용 이펙트로 테이블을 꾸며보세요." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://angel-sd.com/shop" }],
  }),
  component: Shop,
});

const TABS = [
  { key: "shop", label: "상점" },
  { key: "inventory", label: "인벤토리" },
  { key: "effects", label: "효과 설정" },
] as const;

const EFFECT_TOGGLES: { key: keyof EffectSettings; label: string; desc: string }[] = [
  { key: "entry_effect", label: "입장 효과", desc: "내 입장 연출을 재생합니다." },
  { key: "win_effect", label: "승리 효과", desc: "승리 시 계급 전용 연출을 재생합니다." },
  { key: "showdown_effect", label: "쇼다운 효과", desc: "카드 공개 순간 연출을 재생합니다." },
  { key: "name_effect", label: "닉네임 효과", desc: "닉네임 글로우/애니메이션을 표시합니다." },
  {
    key: "reduce_others",
    label: "타인 효과 간소화",
    desc: "다른 플레이어의 화려한 연출을 최소화해 성능을 확보합니다.",
  },
];

function Shop() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"shop" | "inventory" | "effects">("shop");
  const [category, setCategory] = useState<ItemKind | "all">("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [offerItemId, setOfferItemId] = useState<string | null>(null);

  /** RARE(전 서버 1개) 상품의 실제 보유 상태는 서버 판정만 신뢰한다. */
  const rareOwners = useQuery({
    queryKey: ["rare-owners"],
    queryFn: fetchRareOwners,
    staleTime: 10_000,
  });

  // RARE 판매 즉시 다른 사용자 화면도 갱신 (새로고침 불필요)
  useEffect(() => {
    const channel = supabase
      .channel("rare-owners-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_items" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["rare-owners"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);






  const items = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*")
        .order("price");
      if (error) throw error;
      return data ?? [];
    },
  });

  const owned = useQuery({
    queryKey: ["user-items", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // 기간 만료 아이템은 서버가 먼저 정리한다 (만료분 자동 해제)
      await supabase.rpc("expire_my_items");
      const { data, error } = await supabase
        .from("user_items")
        .select("id, item_id, equipped, expires_at")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  /** 현재 장착 칭호 1개 (일반 + 커스텀 통합 서버 판정) */
  const equippedTitle = useQuery({
    queryKey: ["equipped-title", user?.id],
    enabled: !!user,
    queryFn: fetchEquippedTitle,
  });

  const buy = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.rpc("purchase_item", { _item_id: itemId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("구매가 완료되었습니다.");
      void queryClient.invalidateQueries({ queryKey: ["user-items"] });
      void queryClient.invalidateQueries({ queryKey: ["equipped-title"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["rare-owners"] });
    },
    onError: (error) => {
      // 서버 error message를 보존하고, RARE 선점 케이스만 명확히 안내한다.
      toast.error(purchaseErrorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ["rare-owners"] });
    },
  });

  const equip = useMutation({
    // 장착은 서버 RPC가 처리한다 (같은 카테고리 단일 장착 보장)
    mutationFn: async (item: { item_id: string }) => {
      const { error } = await supabase.rpc("equip_item", { _item_id: item.item_id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("장착했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["user-items"] });
      void queryClient.invalidateQueries({ queryKey: ["equipped-title"] });
    },
    onError: () => toast.error("장착에 실패했습니다."),
  });

  const effects = useQuery({
    queryKey: ["effect-settings", user?.id],
    enabled: !!user,
    queryFn: () => fetchEffectSettings(user!.id),
  });

  const saveEffects = useMutation({
    mutationFn: (patch: Partial<EffectSettings>) => saveEffectSettings(user!.id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["effect-settings"] });
    },
    onError: () => toast.error("효과 설정 저장에 실패했습니다."),
  });

  const ownedIds = new Set((owned.data ?? []).map((o) => o.item_id));
  // 계급 전용 아이템(for_sale=false)과 관리자가 숨긴 아이템(status=HIDDEN)은 상점에 노출하지 않는다.
  const visible = (items.data ?? []).filter((i) =>
    tab === "shop"
      ? i.enabled !== false && i.for_sale !== false && i.status !== "HIDDEN"
      : ownedIds.has(i.id),
  );
  const effectValues = effects.data ?? DEFAULT_EFFECT_SETTINGS;

  // 장착 중인 아이템 (프리뷰 기준값)
  const equippedIds = new Set(
    (owned.data ?? []).filter((o) => o.equipped).map((o) => o.item_id),
  );
  const equippedItems = (items.data ?? []).filter((i) => equippedIds.has(i.id));

  const kindsPresent = new Map<ItemKind, number>();
  for (const i of visible) {
    const k = itemKind(i.category);
    kindsPresent.set(k, (kindsPresent.get(k) ?? 0) + 1);
  }
  const categoryTabs = [
    { key: "all" as const, label: "전체", count: visible.length },
    ...[...kindsPresent.entries()].map(([k, count]) => ({
      key: k,
      label: KIND_LABEL[k],
      count,
    })),
  ];
  const filtered =
    category === "all" ? visible : visible.filter((i) => itemKind(i.category) === category);
  const previewItem = (items.data ?? []).find((i) => i.id === previewId) ?? null;
  const offerItem = (items.data ?? []).find((i) => i.id === offerItemId) ?? null;


  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-gold-plate font-display text-2xl">상점 / 인벤토리</h1>
        <p className="text-sm text-gold">{formatPoints(profile?.game_points ?? 0)}</p>
      </div>

      <div className="mt-4 flex gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "gold" : "table"}
            size="sm"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "shop" && (
        <p className="mt-3 text-xs text-muted-foreground">
          계급 전용 스킨·이펙트는 상점에서 판매하지 않습니다. 계급 달성 시 인벤토리로 자동 지급됩니다.
        </p>
      )}

      {tab === "effects" ? (
        <div className="panel-surface mt-5 rounded-2xl p-5">
          <h2 className="font-display text-lg text-gold">이펙트 표시 설정</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            연출이 과하게 느껴지면 개별적으로 끌 수 있습니다.
          </p>
          <div className="mt-4 space-y-2">
            {EFFECT_TOGGLES.map((t) => (
              <label
                key={t.key}
                className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border bg-black/30 p-3 text-sm hover:border-gold/30"
              >
                <span>
                  <span className="text-foreground">{t.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t.desc}</span>
                </span>
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={effectValues[t.key]}
                  disabled={!user || saveEffects.isPending}
                  onChange={(e) => saveEffects.mutate({ [t.key]: e.target.checked })}
                />
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <LoadoutShowcase
            userId={user?.id ?? null}
            nickname={profile?.nickname ?? "GUEST"}
            rank={profile?.rank ?? "UNRANKED"}
            equipped={equippedItems}
            preview={previewItem}
            equippedTitleText={equippedTitle.data?.titleText ?? null}
          />

          <CustomTitlePanel tab={tab} canBuy={!!user} />

          <CustomProfilePanel tab={tab} canBuy={!!user} />

          <RareOffersPanel enabled={!!user} />




          <div className="flex flex-wrap gap-2">
            {categoryTabs.map((c) => (
              <Button
                key={c.key}
                variant={category === c.key ? "goldOutline" : "table"}
                size="sm"
                onClick={() => setCategory(c.key)}
              >
                {c.label} {c.count > 0 && <span className="ml-1 text-[10px] opacity-70">{c.count}</span>}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {filtered.map((item) => {
              const mine = (owned.data ?? []).find((o) => o.item_id === item.id);
              const isRare = item.rarity === "RARE";
              const rankOnly = item.for_sale === false;
              const isPreview = previewId === item.id;
              const rareOwner = isRare ? rareOwnerOf(rareOwners.data, item.id) : null;
              const state = shopActionState({
                loggedIn: !!user,
                rarity: item.rarity,
                forSale: item.for_sale,
                minePresent: !!mine,
                rareOwner,
              });
              const expiresAt = mine?.expires_at ? new Date(mine.expires_at) : null;
              const remainDays = expiresAt
                ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000))
                : null;
              const durationDays = Number(item.duration_days ?? 0);
              return (
                <div
                  key={item.id}
                  onMouseEnter={() => setPreviewId(item.id)}
                  onFocus={() => setPreviewId(item.id)}
                  onClick={() => setPreviewId(item.id)}
                  className={cn(
                    "panel-surface flex cursor-pointer flex-col rounded-2xl border p-4 transition",
                    rarityRing(item.rarity, !!mine?.equipped),
                    isPreview && "-translate-y-0.5",
                  )}
                >
                  <div className="flex justify-center py-3">
                    <ItemThumb item={item} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-semibold text-foreground">{item.name}</p>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-[1px] text-[10px] font-bold",
                        isRare ? "bg-crimson text-gold-soft" : "bg-charcoal text-muted-foreground",
                      )}
                    >
                      {isRare ? "RARE · 전 서버 1개" : "NORMAL"}
                    </span>
                    {mine?.equipped && (
                      <span className="rounded-full bg-gold/20 px-1.5 py-[1px] text-[10px] font-bold text-gold">
                        장착중
                      </span>
                    )}
                    {state === "OWNED_BY_OTHER" && (
                      <span className="rounded-full bg-charcoal px-1.5 py-[1px] text-[10px] font-bold text-muted-foreground">
                        보유자 있음
                      </span>
                    )}
                    {item.rank_required && <RankBadge rank={item.rank_required} size="sm" />}
                  </div>
                  <p className="mt-1 flex-1 text-xs text-muted-foreground">{item.description}</p>
                  <p className="mt-2 font-display text-gold">
                    {rankOnly ? "계급 전용 (판매 없음)" : formatPoints(item.price)}
                    {durationDays > 0 && (
                      <span className="ml-2 text-[11px] text-gold-soft">{durationDays}일 기간제</span>
                    )}
                  </p>
                  {remainDays !== null && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {remainDays > 0 ? `보유 기간 ${remainDays}일 남음` : "기간 만료"}
                    </p>
                  )}
                  {state === "OWNED_BY_OTHER" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      현재 보유자{rareOwner?.owner_nickname ? ` · ${rareOwner.owner_nickname}` : ""} · 판매 완료
                    </p>
                  )}
                  <div className="mt-3">
                    {state === "OWNED_BY_ME" && mine ? (
                      <Button
                        variant={mine.equipped ? "goldOutline" : "gold"}
                        size="sm"
                        className={cn("w-full")}
                        disabled={mine.equipped || equip.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          equip.mutate({ item_id: item.id });
                        }}
                      >
                        {mine.equipped ? "장착중" : "장착하기"}
                      </Button>
                    ) : state === "OWNED_BY_ME" ? (
                      <Button variant="goldOutline" size="sm" className="w-full" disabled>
                        보유중
                      </Button>
                    ) : state === "OWNED_BY_OTHER" ? (
                      <div className="space-y-2">
                        <Button variant="table" size="sm" className="w-full" disabled>
                          보유자 있음 · 판매 완료
                        </Button>
                        <Button
                          variant="goldOutline"
                          size="sm"
                          className="w-full"
                          disabled={!user}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOfferItemId(item.id);
                          }}
                        >
                          입찰 신청
                        </Button>
                      </div>
                    ) : state === "RANK_ONLY" ? (
                      <Button variant="table" size="sm" className="w-full" disabled>
                        계급 달성 시 지급
                      </Button>
                    ) : state === "LOGIN_REQUIRED" ? (
                      <Button variant="table" size="sm" className="w-full" disabled>
                        로그인 필요
                      </Button>
                    ) : (
                      <Button
                        variant="gold"
                        size="sm"
                        className="w-full"
                        disabled={buy.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          buy.mutate(item.id);
                        }}
                      >
                        구매하기
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="panel-surface col-span-full rounded-2xl p-10 text-center text-sm text-muted-foreground">
                {tab === "shop" ? "판매 중인 아이템이 없습니다." : "보유한 아이템이 없습니다."}
              </p>
            )}
          </div>
        </div>
      )}

      {offerItem && (
        <RareOfferDialog
          item={offerItem}
          ownerNickname={rareOwnerOf(rareOwners.data, offerItem.id)?.owner_nickname ?? null}
          availablePoints={Math.max(
            0,
            (profile?.game_points ?? 0) - (profile?.locked_points ?? 0),
          )}
          open={!!offerItemId}
          onOpenChange={(open) => setOfferItemId(open ? offerItemId : null)}
        />
      )}
    </AppShell>
  );
}
