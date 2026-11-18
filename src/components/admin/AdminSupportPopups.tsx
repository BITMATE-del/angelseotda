import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Empty, Panel, Table } from "@/components/admin/ui";
import { EventPopupCard } from "@/components/layout/EventPopupHost";
import { EventPopupImage } from "@/components/layout/EventPopupImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSupportLink } from "@/hooks/useSupportLink";
import { supabase } from "@/integrations/supabase/client";
import { updateAdminSetting, formatDateTime } from "@/lib/services/adminService";
import {
  CTA_TYPE_LABEL,
  PLACEMENT_LABEL,
  deletePopup,
  fetchAllPopups,
  savePopup,
  setPopupActive,
  uploadPopupImage,
  type EventPopup,
  type EventPopupInput,
  type PopupCtaType,
  type PopupPlacement,
} from "@/lib/services/eventPopupService";
import {
  OFFICIAL_CHANNEL_SETTING_KEY,
  SUPPORT_SETTING_KEY,
  normalizeTelegramLink,
} from "@/lib/services/supportService";

function fail(e: unknown) {
  toast.error(e instanceof Error ? e.message : "처리에 실패했습니다.");
}

const EMPTY: EventPopupInput = {
  title: "",
  body: "",
  image_url: null,
  cta_label: "",
  cta_type: "NONE",
  cta_link: "",
  active: false,
  starts_at: null,
  ends_at: null,
  priority: 0,
  placement: "LOBBY",
};

/** 고객센터(Telegram) 설정 + 이벤트 팝업 관리 — admin/super_admin 전용 화면에서만 렌더된다. */
export function AdminSupportPopups() {
  return (
    <div className="space-y-4">
      <SupportSetting
        settingKey={SUPPORT_SETTING_KEY}
        queryKey="admin-support-link"
        publicQueryKey="support-link"
        title="고객센터 설정"
        desc="상단 메뉴 '고객센터'가 연결될 Telegram 주소입니다. @아이디로 입력하면 https://t.me/아이디 로 저장됩니다."
        label="Telegram 아이디 또는 주소"
        placeholder="@angel_support 또는 https://t.me/angel_support"
        name="고객센터"
      />
      <SupportSetting
        settingKey={OFFICIAL_CHANNEL_SETTING_KEY}
        queryKey="admin-official-channel-link"
        publicQueryKey="official-channel-link"
        title="공식채널 설정"
        desc="상단 메뉴 '공식채널입장'이 연결될 Telegram 채널 주소입니다. @채널아이디로 입력하면 https://t.me/채널아이디 로 저장됩니다."
        label="Telegram 채널 아이디 또는 주소"
        placeholder="@angel_channel 또는 https://t.me/angel_channel"
        name="공식채널"
      />
      <PopupManager />
    </div>
  );
}

function SupportSetting({
  settingKey,
  queryKey,
  publicQueryKey,
  title,
  desc,
  label,
  placeholder,
  name,
}: {
  settingKey: string;
  queryKey: string;
  publicQueryKey: string;
  title: string;
  desc: string;
  label: string;
  placeholder: string;
  name: string;
}) {
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", settingKey)
        .maybeSingle();
      if (error) throw error;
      return typeof data?.value === "string" ? data.value : "";
    },
  });
  const [raw, setRaw] = useState<string | null>(null);
  const value = raw ?? current.data ?? "";

  const save = useMutation({
    mutationFn: async (input: string) => {
      const n = normalizeTelegramLink(input);
      if (!n.ok) throw new Error(n.reason ?? "형식이 올바르지 않습니다.");
      await updateAdminSetting(settingKey, n.url);
      return n.url;
    },
    onSuccess: (url) => {
      setRaw(url);
      toast.success(url ? `${name} 링크를 저장했습니다. (${url})` : `${name} 링크를 비웠습니다.`);
      void qc.invalidateQueries({ queryKey: [queryKey] });
      void qc.invalidateQueries({ queryKey: [publicQueryKey] });
    },
    onError: fail,
  });

  return (
    <Panel title={title} desc={desc}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[280px] flex-1 space-y-1">
          <Label>{label}</Label>
          <Input value={value} placeholder={placeholder} onChange={(e) => setRaw(e.target.value)} />
        </div>
        <Button variant="gold" disabled={save.isPending} onClick={() => save.mutate(value)}>
          저장
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        현재 적용 링크 · {current.data ? current.data : "미설정 (클릭 시 안내 메시지 표시)"}
      </p>
    </Panel>
  );
}

function PopupManager() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<EventPopupInput | null>(null);
  const list = useQuery({ queryKey: ["admin-event-popups"], queryFn: fetchAllPopups });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["admin-event-popups"] });
    void qc.invalidateQueries({ queryKey: ["event-popups"] });
  };

  const save = useMutation({
    mutationFn: async (input: EventPopupInput) => {
      if (!input.title.trim()) throw new Error("제목을 입력해 주세요.");
      if (input.cta_type !== "NONE" && !input.cta_label?.trim())
        throw new Error("버튼 문구를 입력해 주세요.");
      if ((input.cta_type === "INTERNAL" || input.cta_type === "EXTERNAL") && !input.cta_link?.trim())
        throw new Error("버튼 연결 주소를 입력해 주세요.");
      await savePopup(input);
    },
    onSuccess: () => {
      toast.success("팝업을 저장했습니다.");
      setDraft(null);
      refresh();
    },
    onError: fail,
  });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => setPopupActive(v.id, v.active),
    onSuccess: refresh,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePopup(id),
    onSuccess: () => {
      toast.success("팝업을 삭제했습니다.");
      refresh();
    },
    onError: fail,
  });

  return (
    <Panel
      title="이벤트 팝업 관리"
      desc="활성 상태이고 기간 안에 있는 팝업만 사용자에게 노출됩니다. 우선순위가 높은 팝업이 먼저 표시됩니다."
      actions={
        <Button variant="gold" size="sm" onClick={() => setDraft({ ...EMPTY })}>
          새 팝업
        </Button>
      }
    >
      {draft && (
        <PopupForm
          value={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => save.mutate(draft)}
          saving={save.isPending}
        />
      )}
      <Table head={["제목", "노출 위치", "기간", "우선순위", "버튼", "활성", "관리"]}>
        {(list.data ?? []).map((p: EventPopup) => (
          <tr key={p.id}>
            <td className="px-3 py-2 text-foreground">{p.title}</td>
            <td className="px-3 py-2">{PLACEMENT_LABEL[p.placement]}</td>
            <td className="px-3 py-2 text-muted-foreground">
              {p.starts_at ? formatDateTime(p.starts_at) : "즉시"} ~{" "}
              {p.ends_at ? formatDateTime(p.ends_at) : "무제한"}
            </td>
            <td className="px-3 py-2">{p.priority}</td>
            <td className="px-3 py-2 text-muted-foreground">
              {p.cta_type === "NONE" ? "없음" : `${p.cta_label} · ${CTA_TYPE_LABEL[p.cta_type]}`}
            </td>
            <td className="px-3 py-2">
              <Switch
                checked={p.active}
                onCheckedChange={(v) => toggle.mutate({ id: p.id, active: v })}
              />
            </td>
            <td className="px-3 py-2">
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="table"
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      title: p.title,
                      body: p.body,
                      image_url: p.image_url,
                      cta_label: p.cta_label ?? "",
                      cta_type: p.cta_type,
                      cta_link: p.cta_link ?? "",
                      active: p.active,
                      starts_at: p.starts_at,
                      ends_at: p.ends_at,
                      priority: p.priority,
                      placement: p.placement,
                    })
                  }
                >
                  수정
                </Button>
                <Button size="sm" variant="table" onClick={() => remove.mutate(p.id)}>
                  삭제
                </Button>
              </div>
            </td>
          </tr>
        ))}
        {list.data?.length === 0 && <Empty colSpan={7} />}
      </Table>
    </Panel>
  );
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PopupForm({
  value,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  value: EventPopupInput;
  onChange: (v: EventPopupInput) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof EventPopupInput>(key: K, v: EventPopupInput[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="mb-4 space-y-3 rounded-xl border border-gold/20 bg-black/30 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>제목</Label>
          <Input value={value.title} onChange={(e) => set("title", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>우선순위 (숫자가 클수록 먼저)</Label>
          <Input
            type="number"
            value={value.priority}
            onChange={(e) => set("priority", Number(e.target.value) || 0)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>내용</Label>
        <textarea
          className="min-h-24 w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm"
          value={value.body}
          onChange={(e) => set("body", e.target.value)}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>시작일</Label>
          <Input
            type="datetime-local"
            value={toLocalInput(value.starts_at)}
            onChange={(e) =>
              set("starts_at", e.target.value ? new Date(e.target.value).toISOString() : null)
            }
          />
        </div>
        <div className="space-y-1">
          <Label>종료일</Label>
          <Input
            type="datetime-local"
            value={toLocalInput(value.ends_at)}
            onChange={(e) =>
              set("ends_at", e.target.value ? new Date(e.target.value).toISOString() : null)
            }
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label>노출 위치</Label>
          <select
            className="h-9 w-full rounded-lg border border-border bg-black/40 px-2 text-sm"
            value={value.placement}
            onChange={(e) => set("placement", e.target.value as PopupPlacement)}
          >
            {Object.entries(PLACEMENT_LABEL)
              .filter(([k]) => k !== "GAME_ROOM" || value.placement === "GAME_ROOM")
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {k === "ALL" ? "전체 (현재 로비에만 표시)" : k === "GAME_ROOM" ? `${label} (표시 안 됨)` : label}
                </option>
              ))}
          </select>
          <p className="text-[11px] text-muted-foreground">팝업은 로비 화면에만 표시됩니다. 게임 화면에는 뜨지 않습니다.</p>
        </div>
        <div className="space-y-1">
          <Label>버튼 문구</Label>
          <Input
            value={value.cta_label ?? ""}
            placeholder="고객센터 문의"
            onChange={(e) => set("cta_label", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>버튼 연결 방식</Label>
          <select
            className="h-9 w-full rounded-lg border border-border bg-black/40 px-2 text-sm"
            value={value.cta_type}
            onChange={(e) => set("cta_type", e.target.value as PopupCtaType)}
          >
            {Object.entries(CTA_TYPE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(value.cta_type === "INTERNAL" || value.cta_type === "EXTERNAL") && (
        <div className="space-y-1">
          <Label>버튼 연결 주소</Label>
          <Input
            value={value.cta_link ?? ""}
            placeholder={value.cta_type === "INTERNAL" ? "/shop" : "https://…"}
            onChange={(e) => set("cta_link", e.target.value)}
          />
        </div>
      )}
      {value.cta_type === "SUPPORT" && (
        <p className="text-[11px] text-gold-soft">
          현재 고객센터 설정 링크를 사용합니다. 링크가 변경되면 팝업 버튼도 자동으로 따라갑니다.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-1">
          <Label>이미지</Label>
          <input
            type="file"
            accept="image/*"
            className="block text-xs"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                set("image_url", await uploadPopupImage(file));
                toast.success("이미지를 업로드했습니다.");
              } catch (err) {
                fail(err);
              } finally {
                setUploading(false);
              }
            }}
          />
        </div>
        {value.image_url && (
          <EventPopupImage
            value={value.image_url}
            alt="팝업 이미지"
            className="h-16 w-auto rounded border border-gold/20"
          />
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={value.active} onCheckedChange={(v) => set("active", v)} />
          활성
        </label>
      </div>
      <div className="space-y-2">
        <Label>미리보기 (사용자 화면과 동일 비율)</Label>
        <div className="flex flex-wrap items-start gap-6 rounded-xl border border-border bg-black/40 p-4">
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">PC (560px)</p>
            <div className="w-[360px] origin-top-left scale-[0.64]">
              <PopupPreview value={value} maxWidthClass="max-w-[560px]" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">모바일 (360px)</p>
            <div className="w-[300px]">
              <PopupPreview value={value} maxWidthClass="max-w-[300px]" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="gold" size="sm" disabled={saving || uploading} onClick={onSave}>
          저장
        </Button>
        <Button variant="table" size="sm" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  );
}

/** 관리자 미리보기 — 사용자 화면과 동일한 팝업 카드를 렌더한다. */
function PopupPreview({
  value,
  maxWidthClass,
}: {
  value: EventPopupInput;
  maxWidthClass: string;
}) {
  const { link } = useSupportLink();
  return (
    <EventPopupCard
      maxWidthClass={maxWidthClass}
      supportLink={link}
      popup={{
        id: value.id ?? "preview",
        title: value.title,
        body: value.body,
        image_url: value.image_url,
        cta_label: value.cta_label ?? null,
        cta_type: value.cta_type,
        cta_link: value.cta_link ?? null,
        active: value.active,
        starts_at: value.starts_at,
        ends_at: value.ends_at,
        priority: value.priority,
        placement: value.placement,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }}
    />
  );
}
