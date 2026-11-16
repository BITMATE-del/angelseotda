import { useEffect, useState } from "react";
import { popupImageUrl } from "@/lib/services/eventPopupService";
import { cn } from "@/lib/utils";

/** 이미지 로드 실패 시 관리자 점검용 코드 (콘솔 1회 기록) */
export const POPUP_IMAGE_LOAD_FAILED = "EVENT_POPUP_IMAGE_LOAD_FAILED";

/**
 * 이벤트 팝업 이미지 — storage 경로를 조회 URL로 변환해 표시하고,
 * 실패하면 깨진 이미지 아이콘 대신 안내 문구를 보여준다.
 */
export function EventPopupImage({
  value,
  alt,
  className,
  popupId,
}: {
  value: string | null | undefined;
  alt: string;
  className?: string;
  popupId?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    setBroken(false);
    setUrl(null);
    void popupImageUrl(value).then((resolved) => {
      if (!alive) return;
      if (!resolved) setBroken(true);
      else setUrl(resolved);
    });
    return () => {
      alive = false;
    };
  }, [value]);

  if (broken) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-1 bg-black/50 px-4 py-8 text-center">
        <span className="font-display text-[11px] tracking-widest text-gold/70">ANGEL SUTDA</span>
        <span className="text-xs text-muted-foreground">이벤트 이미지를 불러올 수 없습니다.</span>
      </div>
    );
  }

  if (!url) return <div className="min-h-32 animate-pulse bg-black/40" />;

  return (
    <img
      src={url}
      alt={alt}
      className={cn("mx-auto block h-auto w-full object-contain", className)}
      onError={() => {
        console.warn(POPUP_IMAGE_LOAD_FAILED, { popupId, value });
        setBroken(true);
      }}
    />
  );
}
