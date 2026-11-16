import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EventPopupImage } from "@/components/layout/EventPopupImage";
import { Button } from "@/components/ui/button";
import { useSupportLink } from "@/hooks/useSupportLink";
import {
  dismissForToday,
  fetchActivePopups,
  isDismissedToday,
  resolveCtaLink,
  type EventPopup,
  type PopupPlacement,
} from "@/lib/services/eventPopupService";

/**
 * 이벤트 팝업 표시 레이어 (표현 전용).
 * - 이미지가 있으면 이미지를 메인으로 표시하고 제목/본문은 중복 노출하지 않는다.
 * - [오늘 다시 보지 않기]: 해당 팝업만 KST 오늘 날짜 기준으로 숨김
 * - [닫기]: 현재 로드에서만 닫기 (새로고침 시 다시 표시)
 */
export function EventPopupHost({ placement = "LOBBY" }: { placement?: PopupPlacement }) {
  const [closed, setClosed] = useState<string[]>([]);
  const { link } = useSupportLink();

  const popups = useQuery({
    queryKey: ["event-popups", placement],
    queryFn: () => fetchActivePopups(placement),
    staleTime: 30_000,
  });

  const current = useMemo(() => {
    const list = popups.data ?? [];
    return list.find((p) => !closed.includes(p.id) && !isDismissedToday(p.id)) ?? null;
  }, [popups.data, closed]);

  if (!current) return null;

  const close = () => setClosed((prev) => [...prev, current.id]);

  return (
    <EventPopupView
      popup={current}
      supportLink={link}
      onClose={close}
      onDismissToday={() => {
        dismissForToday(current.id);
        close();
      }}
    />
  );
}

/** 팝업 카드 (관리자 미리보기에서도 동일 비율로 재사용) */
export function EventPopupCard({
  popup,
  supportLink,
  onClose,
  onDismissToday,
  maxWidthClass = "max-w-[560px]",
}: {
  popup: EventPopup;
  supportLink: string;
  onClose?: () => void;
  onDismissToday?: () => void;
  maxWidthClass?: string;
}) {
  const hasImage = Boolean(popup.image_url?.trim());
  const ctaHref = resolveCtaLink(popup, supportLink);

  function openCta() {
    if (popup.cta_type === "SUPPORT" && !supportLink) {
      toast.error("고객센터가 아직 설정되지 않았습니다.");
      return;
    }
    if (!ctaHref) return;
    if (popup.cta_type === "INTERNAL") {
      window.location.assign(ctaHref);
      return;
    }
    window.open(ctaHref, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className={`panel-surface relative flex max-h-[85vh] w-[90vw] flex-col overflow-hidden rounded-2xl border border-gold/25 ${maxWidthClass}`}
    >
      {onClose && (
        <button
          type="button"
          aria-label="팝업 닫기"
          onClick={onClose}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/70 p-1.5 text-foreground/70 transition-colors hover:text-gold"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasImage ? (
          <>
            <EventPopupImage
              value={popup.image_url}
              alt={popup.title}
              popupId={popup.id}
              className="max-h-[62vh]"
            />
            {popup.body?.trim() && (
              <p className="whitespace-pre-line px-4 pt-3 text-xs leading-relaxed text-foreground/70">
                {popup.body}
              </p>
            )}
          </>
        ) : (
          <div className="space-y-3 px-5 pt-5">
            <h2 className="font-display text-lg text-gold">{popup.title}</h2>
            {popup.body?.trim() && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/80">
                {popup.body}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-3 p-4">
        {popup.cta_type !== "NONE" && popup.cta_label && (
          <Button variant="gold" className="w-full" onClick={openCta}>
            {popup.cta_label}
          </Button>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-gold"
            onClick={onDismissToday}
          >
            오늘 다시 보지 않기
          </button>
          <Button variant="table" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}

function EventPopupView({
  popup,
  supportLink,
  onClose,
  onDismissToday,
}: {
  popup: EventPopup;
  supportLink: string;
  onClose: () => void;
  onDismissToday: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4">
      <EventPopupCard
        popup={popup}
        supportLink={supportLink}
        onClose={onClose}
        onDismissToday={onDismissToday}
      />
    </div>
  );
}
