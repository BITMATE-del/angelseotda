import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  ConfirmDialog,
  Empty,
  fail,
  Panel,
  Table,
  useInvalidate,
  type ConfirmRequest,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/services/adminService";
import { needsReupload, useShopImage } from "@/lib/shop/shopImage";
import { ShopItemPreview } from "@/components/admin/ShopItemPreview";
import {
  deleteItem,
  ITEM_CATEGORIES,
  ITEM_CATEGORY_SPEC,
  ITEM_STATUS,
  ITEM_STATUS_LABEL,
  resolveShopImage,
  setItemStatus,
  uploadShopImage,
  upsertItem,
  type ItemStatus,
} from "@/lib/services/adminOpsService";
import { formatPoints } from "@/lib/services/walletService";

interface ItemRow {
  id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;
  rarity: string;
  status: string;
  sort_order: number;
  asset_url: string | null;
  duration_days: number | null;
  updated_at: string;
}

const EMPTY_FORM = {
  id: null as string | null,
  category: "character",
  name: "",
  description: "",
  price: "0",
  rarity: "NORMAL" as "NORMAL" | "RARE",
  status: "DRAFT" as ItemStatus,
  sortOrder: "0",
  durationDays: "0",
  assetPath: "" as string,
};

const DURATION_PRESETS = [
  { days: 0, label: "영구" },
  { days: 7, label: "7일" },
  { days: 30, label: "30일" },
  { days: 90, label: "90일" },
];

/** 상품 썸네일 — storage 경로는 조회 URL로 변환해 표시한다. */
function ItemAssetThumb({ path }: { path: string | null }) {
  const { url, onError } = useShopImage(path);
  const reupload = needsReupload(path);
  if (!url) {
    return (
      <div
        className={`flex h-11 w-11 items-center justify-center rounded-md border bg-black/40 text-center text-[9px] leading-tight ${
          reupload ? "border-destructive text-destructive-foreground" : "border-border text-muted-foreground"
        }`}
      >
        {reupload ? "재업로드 필요" : "없음"}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      onError={onError}
      className="h-11 w-11 rounded-md border border-gold/20 object-cover"
    />
  );
}

interface ImageMeta {
  width: number;
  height: number;
  bytes: number;
  ok: boolean;
  note: string;
  url: string;
}

/** 업로드 전 로컬 이미지 규격 검사 (비율 ±8% 허용) */
async function inspectImage(file: File, category: string): Promise<ImageMeta> {
  const url = URL.createObjectURL(file);
  const size = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
  const target = ITEM_CATEGORY_SPEC[category]?.ratio ?? 0;
  const ratio = size.height > 0 ? size.width / size.height : 0;
  const ratioOk = target === 0 || (ratio > 0 && Math.abs(ratio - target) / target <= 0.08);
  const sizeOk = file.size <= 5 * 1024 * 1024;
  return {
    width: size.width,
    height: size.height,
    bytes: file.size,
    ok: ratioOk && sizeOk,
    note: !sizeOk ? "5MB 초과" : "권장 비율과 다릅니다(표시가 잘릴 수 있음)",
    url,
  };
}

export function AdminItems({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const invalidate = useInvalidate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [q, setQ] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [localMeta, setLocalMeta] = useState<ImageMeta | null>(null);
  const spec = ITEM_CATEGORY_SPEC[form.category];

  const items = useQuery({
    queryKey: ["admin-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, category, name, description, price, rarity, status, sort_order, asset_url, duration_days, updated_at")
        .order("category")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as ItemRow[];
    },
  });

  const owned = useQuery({
    queryKey: ["admin-item-owners"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_items").select("item_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.item_id] = (counts[row.item_id] ?? 0) + 1;
      return counts;
    },
  });

  useEffect(() => {
    let alive = true;
    void resolveShopImage(form.assetPath || null).then((url) => {
      if (alive) setPreview(url);
    });
    return () => {
      alive = false;
    };
  }, [form.assetPath]);

  const save = useMutation({
    mutationFn: async () => {
      await upsertItem({
        id: form.id,
        category: form.category,
        name: form.name,
        description: form.description,
        price: Number(form.price),
        rarity: form.rarity,
        assetUrl: form.assetPath || null,
        images: form.assetPath ? [form.assetPath] : [],
        status: form.status,
        sortOrder: Number(form.sortOrder),
        durationDays: Number(form.durationDays) || 0,
        reason: reason.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success(form.id ? "상품을 수정했습니다." : "상품을 등록했습니다.");
      setForm(EMPTY_FORM);
      setLocalPreview(null);
      setLocalMeta(null);
      invalidate("admin-items");
    },
    onError: fail,
  });

  const upload = useMutation({
    mutationFn: uploadShopImage,
    onSuccess: (path) => {
      setForm((f) => ({ ...f, assetPath: path }));
      toast.success("이미지를 업로드했습니다.");
    },
    onError: fail,
  });

  const status = useMutation({
    mutationFn: (input: { id: string; status: ItemStatus }) => setItemStatus(input.id, input.status, reason.trim()),
    onSuccess: () => {
      toast.success("판매 상태를 변경했습니다.");
      invalidate("admin-items");
    },
    onError: fail,
  });

  const all: ItemRow[] = items.data ?? [];
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (i) =>
      (filterCategory === "all" || i.category === filterCategory) &&
      (filterStatus === "all" || i.status === filterStatus) &&
      (!needle ||
        i.name.toLowerCase().includes(needle) ||
        (i.description ?? "").toLowerCase().includes(needle)),
  );

  const askDelete = (item: ItemRow) =>
    setConfirm({
      title: `${item.name} 삭제`,
      danger: true,
      reasonRequired: true,
      confirmLabel: "삭제",
      body: (
        <>
          <p>보유 회원이 있으면 삭제되지 않고 숨김 처리됩니다(보유 아이템 보존).</p>
          <p>보유 회원 {owned.data?.[item.id] ?? 0}명</p>
        </>
      ),
      run: async (r) => {
        const result = await deleteItem(item.id, r);
        toast.success(result === "ARCHIVED" ? "보유자가 있어 숨김 처리했습니다." : "삭제했습니다.");
        invalidate("admin-items");
      },
    });

  return (
    <div className="space-y-4">
      <Panel
        title={form.id ? "상품 수정" : "상품 등록"}
        desc="RARE 등급은 전 서버 1개 한정입니다. 판매 완료된 RARE 상품은 가격을 바꿀 수 없고 품절 상태로 고정됩니다."
        actions={
          form.id ? (
            <Button size="sm" variant="table" onClick={() => setForm(EMPTY_FORM)}>
              새 상품
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>분류</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-black/40 px-2 text-xs"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {ITEM_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>상품명</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>가격 (P)</Label>
            <Input value={form.price} inputMode="numeric" onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>등급</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-black/40 px-2 text-xs"
              value={form.rarity}
              onChange={(e) => setForm({ ...form, rarity: e.target.value as "NORMAL" | "RARE" })}
            >
              <option value="NORMAL">NORMAL (상시 판매)</option>
              <option value="RARE">RARE (전 서버 1개 한정)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>판매 상태</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-black/40 px-2 text-xs"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ItemStatus })}
            >
              {ITEM_STATUS.map((s) => (
                <option key={s} value={s}>
                  {ITEM_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>정렬 순서</Label>
            <Input
              value={form.sortOrder}
              inputMode="numeric"
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>기간제 (일 · 0이면 영구)</Label>
            <div className="flex gap-1.5">
              <Input
                value={form.durationDays}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
              />
              {DURATION_PRESETS.map((p) => (
                <Button
                  key={p.days}
                  size="sm"
                  variant="table"
                  onClick={() => setForm({ ...form, durationDays: String(p.days) })}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>설명</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>이미지 업로드 (5MB 이하)</Label>
            <input
              type="file"
              accept="image/*"
              className="w-full text-xs"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void inspectImage(file, form.category).then((meta) => {
                  setLocalMeta(meta);
                  setLocalPreview(meta.url);
                  if (meta.bytes > 5 * 1024 * 1024) {
                    toast.error("5MB 이하 이미지만 업로드할 수 있습니다.");
                    return;
                  }
                  upload.mutate(file);
                });
              }}
            />
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label>이미지 경로 / 외부 URL</Label>
            <Input value={form.assetPath} onChange={(e) => setForm({ ...form, assetPath: e.target.value })} />
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-black/30 p-3 text-[11px] text-muted-foreground">
            <p className="text-[10px] tracking-widest text-gold-soft">권장 이미지 규격</p>
            <p className="mt-1.5">크기 · {spec?.size ?? "-"}</p>
            <p>배경 · {spec?.background ?? "-"}</p>
            <p>형식 · {spec?.format ?? "-"}</p>
            <p>사용 위치 · {spec?.usage ?? "-"}</p>
            {localMeta && (
              <p className={localMeta.ok ? "mt-1.5 text-jade" : "mt-1.5 text-destructive-foreground"}>
                업로드 이미지 {localMeta.width}×{localMeta.height}px ·{" "}
                {(localMeta.bytes / 1024 / 1024).toFixed(2)}MB · {localMeta.ok ? "규격 적합" : localMeta.note}
              </p>
            )}
          </div>
          <ShopItemPreview
            category={form.category}
            name={form.name}
            imageUrl={localPreview ?? preview}
            rarity={form.rarity}
            durationDays={Number(form.durationDays) || 0}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="w-80 space-y-1.5">
            <Label>운영 사유 (로그 기록)</Label>
            <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button size="sm" variant="gold" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "저장 중…" : form.id ? "수정 저장" : "상품 등록"}
          </Button>
        </div>
      </Panel>

      <Panel title="상점 운영 현황" desc="분류·상태·등급별 상품 수와 회원 보유 수량을 집계합니다.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "전체 상품", value: `${all.length}개` },
            { label: "판매중", value: `${all.filter((i) => i.status === "ON_SALE").length}개` },
            {
              label: "RARE (품절 포함)",
              value: `${all.filter((i) => i.rarity === "RARE").length}개 · 품절 ${
                all.filter((i) => i.rarity === "RARE" && i.status === "SOLD_OUT").length
              }`,
            },
            {
              label: "회원 보유 총합",
              value: `${Object.values(owned.data ?? {}).reduce((s, n) => s + n, 0).toLocaleString("ko-KR")}건`,
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-black/30 px-3 py-2">
              <p className="text-[10px] tracking-widest text-muted-foreground">{s.label}</p>
              <p className="font-display mt-1 text-sm text-gold-soft">{s.value}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="상점 상품" desc="RARE 상품은 판매되면 자동으로 품절 처리되어 다시 판매되지 않습니다.">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="w-56 space-y-1.5">
            <Label>상품명 검색</Label>
            <Input value={q} placeholder="상품명 / 설명" onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="w-40 space-y-1.5">
            <Label>분류</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-black/40 px-2 text-xs"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="all">전체</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40 space-y-1.5">
            <Label>상태</Label>
            <select
              className="h-9 w-full rounded-md border border-border bg-black/40 px-2 text-xs"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">전체</option>
              {ITEM_STATUS.map((s) => (
                <option key={s} value={s}>
                  {ITEM_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <span className="pb-2 text-[11px] text-muted-foreground">{rows.length}개 표시</span>
        </div>
        <Table head={["이미지", "분류", "상품명", "등급", "가격", "기간", "상태", "보유자", "정렬", "수정일", "관리"]}>
          {rows.map((i) => (
            <tr key={i.id}>
              <td className="px-3 py-2">
                <ItemAssetThumb path={i.asset_url} />
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {ITEM_CATEGORIES.find((c) => c.id === i.category)?.label ?? i.category}
              </td>
              <td className="px-3 py-2 text-foreground">{i.name}</td>
              <td className="px-3 py-2">
                <Badge tone={i.rarity === "RARE" ? "gold" : "muted"}>{i.rarity}</Badge>
              </td>
              <td className="px-3 py-2 text-gold-soft">{formatPoints(i.price)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {i.duration_days && i.duration_days > 0 ? `${i.duration_days}일` : "영구"}
              </td>
              <td className="px-3 py-2">
                <Badge tone={i.status === "ON_SALE" ? "jade" : i.status === "SOLD_OUT" ? "crimson" : "muted"}>
                  {ITEM_STATUS_LABEL[i.status] ?? i.status}
                </Badge>
              </td>
              <td className="px-3 py-2">{owned.data?.[i.id] ?? 0}명</td>
              <td className="px-3 py-2">{i.sort_order}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(i.updated_at)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="table"
                    onClick={() =>
                      setForm({
                        id: i.id,
                        category: i.category,
                        name: i.name,
                        description: i.description ?? "",
                        price: String(i.price),
                        rarity: i.rarity === "RARE" ? "RARE" : "NORMAL",
                        status: (i.status as ItemStatus) ?? "DRAFT",
                        sortOrder: String(i.sort_order),
                        durationDays: String(i.duration_days ?? 0),
                        assetPath: i.asset_url ?? "",
                      })
                    }
                  >
                    수정
                  </Button>
                  {i.status === "ON_SALE" ? (
                    <Button size="sm" variant="danger" onClick={() => status.mutate({ id: i.id, status: "PAUSED" })}>
                      판매 중지
                    </Button>
                  ) : (
                    <Button size="sm" variant="gold" onClick={() => status.mutate({ id: i.id, status: "ON_SALE" })}>
                      판매 시작
                    </Button>
                  )}
                  {isSuperAdmin && (
                    <Button size="sm" variant="danger" onClick={() => askDelete(i)}>
                      삭제
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <Empty colSpan={11} />}
        </Table>
      </Panel>

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
