import { ITEM_CATEGORY_SPEC } from "@/lib/services/adminOpsService";
import { cn } from "@/lib/utils";

/**
 * 상점 상품의 인게임 노출 위치 프리뷰 (관리자 등록 화면 전용).
 * 실제 게임 로직/에셋 파이프라인은 건드리지 않고 표시 형태만 모사한다.
 */
export function ShopItemPreview({
  category,
  name,
  imageUrl,
  rarity,
  durationDays,
}: {
  category: string;
  name: string;
  imageUrl: string | null;
  rarity: "NORMAL" | "RARE";
  durationDays: number;
}) {
  const spec = ITEM_CATEGORY_SPEC[category];
  const label = name.trim() || "상품명";

  return (
    <div className="rounded-xl border border-border bg-black/30 p-3">
      <p className="text-[10px] tracking-widest text-muted-foreground">인게임 노출 미리보기</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{spec?.usage ?? "-"}</p>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        {/* 좌석 HUD 모사 */}
        {(category === "character" || category === "frame" || category === "effect") && (
          <div className="w-40">
            <div
              className={cn(
                "relative overflow-hidden rounded-lg border bg-[image:var(--gradient-panel)]",
                category === "frame" ? "border-gold/70" : "border-gold/25",
              )}
            >
              <div className="relative aspect-[3/4] w-full bg-black/50">
                {imageUrl && category !== "effect" && (
                  <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                )}
                {imageUrl && category === "effect" && (
                  <>
                    <div className="absolute inset-0 bg-[image:var(--gradient-panel)]" />
                    <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
                  </>
                )}
                {category === "frame" && imageUrl && (
                  <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
                )}
              </div>
              <div className="border-t border-gold/20 px-2 py-1">
                <p className="truncate text-[10px] text-gold-soft">
                  {rarity === "RARE" ? "[한정] " : ""}
                  {label} | 닉네임
                </p>
                <p className="text-[9px] text-muted-foreground">보유 1,250,000P</p>
              </div>
            </div>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">좌석 HUD</p>
          </div>
        )}

        {/* 카드 뒷면 모사 */}
        {category === "card_back" && (
          <div className="w-32">
            <div className="flex gap-1.5">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="aspect-[2/3] flex-1 overflow-hidden rounded-md border border-gold/30 bg-black/60"
                >
                  {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
                </div>
              ))}
            </div>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">내 패 뒷면</p>
          </div>
        )}

        {/* 이모티콘 모사 */}
        {category === "emoticon" && (
          <div className="w-56">
            <div className="rounded-lg border border-border bg-black/50 p-2">
              <p className="text-[10px] text-muted-foreground">채팅 · 퀵 이모티콘</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                {imageUrl ? (
                  <img src={imageUrl} alt="" className="h-9 w-9 rounded-md border border-gold/25 object-cover" />
                ) : (
                  <div className="h-9 w-9 rounded-md border border-border bg-black/40" />
                )}
                <span className="text-[10px] text-foreground">닉네임 · {label}</span>
              </div>
            </div>
          </div>
        )}

        {/* 칭호 모사 */}
        {category === "title" && (
          <div className="rounded-lg border border-border bg-black/50 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">닉네임 표기</p>
            <p className="font-display mt-1 text-sm text-gold">[{label}] | 닉네임</p>
          </div>
        )}

        {/* 상점 카드 모사 */}
        <div className="w-36">
          <div className="overflow-hidden rounded-lg border border-gold/25 bg-[image:var(--gradient-panel)]">
            <div className="aspect-square w-full bg-black/50">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                  이미지 없음
                </div>
              )}
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-[11px] text-foreground">{label}</p>
              <p className="text-[10px] text-gold-soft">
                {rarity === "RARE" ? "RARE · 1개 한정" : "NORMAL"}
                {durationDays > 0 ? ` · ${durationDays}일` : " · 영구"}
              </p>
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] text-muted-foreground">상점 카드</p>
        </div>
      </div>
    </div>
  );
}
