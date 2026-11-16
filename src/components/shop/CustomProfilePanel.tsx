import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPoints } from "@/lib/services/walletService";
import {
  CUSTOM_PROFILE_ACCEPT,
  CUSTOM_PROFILE_DAYS,
  CUSTOM_PROFILE_PRICE,
  customProfileRemainLabel,
  customProfileStatusLabel,
  formatFileSize,
  validateProfileDimensions,
  validateProfileFile,
} from "@/lib/profile/customProfile";
import {
  customProfileSignedUrl,
  fetchMyCustomProfile,
  purchaseCustomProfile,
  readImageSize,
  uploadCustomProfileImage,
} from "@/lib/services/customProfileService";
import { resetCustomProfileImageCache } from "@/lib/profile/useCustomProfileImage";
import { cn } from "@/lib/utils";

interface Picked {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

/** 커스텀 프로필 (30,000P / 7일 기간제) */
export function CustomProfilePanel({ tab, canBuy }: { tab: "shop" | "inventory"; canBuy: boolean }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);

  const mine = useQuery({
    queryKey: ["my-custom-profile"],
    enabled: canBuy,
    queryFn: fetchMyCustomProfile,
  });

  const info = mine.data;
  const active = !!info?.active;
  const statusLabel = customProfileStatusLabel(
    info?.status ?? "NONE",
    active,
    info?.expiresAt ?? null,
  );

  useEffect(() => {
    let alive = true;
    setCurrentUrl(null);
    const path = info?.imagePath;
    if (!path) return;
    void customProfileSignedUrl(path).then((u) => {
      if (alive) setCurrentUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [info?.imagePath]);

  useEffect(
    () => () => {
      if (picked) URL.revokeObjectURL(picked.previewUrl);
    },
    [picked],
  );

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    const basic = validateProfileFile({ name: file.name, type: file.type, size: file.size });
    if (!basic.ok) {
      toast.error(basic.message ?? "사용할 수 없는 이미지입니다.");
      return;
    }
    let size: { width: number; height: number };
    try {
      size = await readImageSize(file);
    } catch {
      toast.error("이미지를 읽을 수 없습니다. 다시 시도해주세요.");
      return;
    }
    const dim = validateProfileDimensions(size.width, size.height);
    if (!dim.ok) {
      toast.error(dim.message ?? "사용할 수 없는 이미지입니다.");
      return;
    }
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file), width: size.width, height: size.height };
    });
  }

  const buy = useMutation({
    mutationFn: () => purchaseCustomProfile(crypto.randomUUID()),
    onSuccess: async () => {
      toast.success(`커스텀 프로필을 ${CUSTOM_PROFILE_DAYS}일간 사용할 수 있습니다.`);
      setBuyOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["my-custom-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "구매에 실패했습니다."),
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!picked) throw new Error("이미지를 먼저 선택해주세요.");
      await uploadCustomProfileImage(picked.file);
    },
    onSuccess: async () => {
      toast.success("커스텀 프로필을 적용했습니다.");
      resetCustomProfileImageCache();
      setPicked((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
      if (fileRef.current) fileRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["my-custom-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "이미지 업로드에 실패했습니다. 다시 시도해주세요."),
  });

  function onApplyClick() {
    if (!active) {
      setBuyOpen(true);
      return;
    }
    apply.mutate();
  }

  if (tab !== "shop") return null;

  const previewSrc = picked?.previewUrl ?? currentUrl;

  return (
    <>
      <div className="panel-surface rounded-2xl border border-gold/30 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg text-gold">커스텀 프로필</h2>
              <span className="rounded-full bg-gold/15 px-2 py-[1px] text-[10px] font-bold text-gold">
                CUSTOM
              </span>
              {canBuy && (
                <span
                  className={cn(
                    "rounded-full px-2 py-[1px] text-[10px] font-bold",
                    active ? "bg-jade/20 text-jade" : "bg-charcoal text-muted-foreground",
                  )}
                >
                  {statusLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              원하는 이미지를 직접 프로필로 등록할 수 있습니다.
            </p>
            <p className="mt-1 text-[11px] text-gold-soft/80">
              권장 800×800px / JPG·PNG·WEBP / 최대 5MB
            </p>
          </div>
          <div className="text-right">
            <p className="font-display text-gold">{formatPoints(CUSTOM_PROFILE_PRICE)}</p>
            <p className="text-[11px] text-gold-soft">{CUSTOM_PROFILE_DAYS}일 기간제</p>
            {active && info?.expiresAt && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                남은 기간 {customProfileRemainLabel(info.expiresAt)}
                <br />
                만료 {new Date(info.expiresAt).toLocaleString("ko-KR")}
              </p>
            )}
            {info?.status === "DISABLED" && info.disabledReason && (
              <p className="mt-1 text-[11px] text-crimson">관리자 해제 · {info.disabledReason}</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5">
          <div>
            <p className="text-[11px] text-muted-foreground">게임 프로필 미리보기</p>
            <div className="mt-2 flex items-end gap-3">
              <div className="h-[200px] w-[200px] overflow-hidden rounded-2xl border border-gold/35 bg-black/40">
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt="커스텀 프로필 미리보기"
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
                    이미지 없음
                  </div>
                )}
              </div>
              <div className="h-24 w-24 overflow-hidden rounded-xl border border-gold/25 bg-black/40">
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt="게임 HUD 미리보기"
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                    HUD
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-[220px] flex-1">
            <input
              ref={fileRef}
              type="file"
              accept={CUSTOM_PROFILE_ACCEPT}
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files?.[0])}
            />
            <Button
              variant="goldOutline"
              size="sm"
              disabled={!canBuy}
              onClick={() => fileRef.current?.click()}
            >
              📁 이미지 파일 선택
            </Button>
            {picked && (
              <p className="mt-2 text-[11px] text-gold-soft">
                {picked.file.name} · {picked.width}×{picked.height} ·{" "}
                {formatFileSize(picked.file.size)}
              </p>
            )}
            <div className="mt-3">
              <Button
                variant="gold"
                size="sm"
                disabled={!canBuy || !picked || apply.isPending}
                onClick={onApplyClick}
              >
                {active
                  ? info?.imagePath
                    ? "이미지 변경"
                    : "커스텀 프로필 적용"
                  : "커스텀 프로필 적용"}
              </Button>
            </div>
            {!active && (
              <div className="mt-3">
                <Button
                  variant="table"
                  size="sm"
                  disabled={!canBuy || buy.isPending}
                  onClick={() => setBuyOpen(true)}
                >
                  {canBuy ? "이용권 구매" : "로그인 필요"}
                </Button>
              </div>
            )}
            {active && (
              <div className="mt-3">
                <Button
                  variant="table"
                  size="sm"
                  disabled={buy.isPending}
                  onClick={() => setBuyOpen(true)}
                >
                  기간 7일 연장
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {buyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="panel-surface gold-frame w-full max-w-sm rounded-2xl p-6">
            <h3 className="font-display text-xl text-gold">커스텀 프로필</h3>
            <p className="mt-2 text-sm text-foreground">
              커스텀 프로필 이용권이 필요합니다. {CUSTOM_PROFILE_DAYS}일 /{" "}
              {formatPoints(CUSTOM_PROFILE_PRICE)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              이용 기간 중에는 이미지 변경이 무료이며, 재구매 시 남은 기간에 7일이 추가됩니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="table" size="sm" onClick={() => setBuyOpen(false)}>
                닫기
              </Button>
              <Button
                variant="gold"
                size="sm"
                disabled={buy.isPending}
                onClick={() => buy.mutate()}
              >
                {formatPoints(CUSTOM_PROFILE_PRICE)} 결제
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
