import { useEffect, useRef, useState } from "react";
import { HwatuCard } from "@/components/game/HwatuCard";
import { RankBadge } from "@/components/rank/RankBadge";
import { DEFAULT_CHARACTER, NO_TITLE_LABEL } from "@/components/game/PlayerSeatHUD";
import { isStoragePath, useShopImage } from "@/lib/shop/shopImage";
import { useResolvedAvatar } from "@/lib/profile/resolveAvatar";
import type { AppRank } from "@/lib/game/rankTiers";
import { formatPoints } from "@/lib/services/walletService";
import type { DoriSeatState } from "@/lib/services/doriService";
import { cn } from "@/lib/utils";
import { DORI_UI } from "./doriAssets";
import { DORI_HUD_LAYOUT, doriCardStep, type DoriHudSpec } from "./doriHudLayout";

/**
 * 서버 equipped_item_asset() 은 jsonb({name, assetUrl, itemId}) 를 내려준다.
 * 기존 섯다와 동일한 "장착 아이템" 소스를 그대로 쓰기 위해 assetUrl 을 꺼낸다.
 */
export function equippedAssetUrl(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  const url = (raw as { assetUrl?: unknown } | null)?.assetUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

export function equippedName(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  const name = (raw as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name.trim() : "";
}

/** 상태 배지 텍스트 + 색 (쇼다운 전 상대 족보/황은 표시하지 않는다) */
function statusOf(seat: DoriSeatState, showdown: boolean) {
  if (seat.folded) return { text: "다이", tone: "text-destructive" };
  if (showdown) return { text: seat.handLabel ?? "-", tone: "text-gold" };
  if (seat.isAllIn) return { text: "올인", tone: "text-crimson" };
  if (seat.makeStatus === "MADE" || seat.makeStatus === "SUBMITTED")
    return { text: "짓기 완료", tone: "text-jade" };
  if (seat.makeStatus === "HWANG") return { text: "황", tone: "text-destructive" };
  if (seat.longAbsence) return { text: "장기 미접속 · 판 종료 후 퇴장", tone: "text-destructive" };
  if (seat.connection === "DISCONNECTED" || seat.connection === "LONG_ABSENCE") {
    const miss = seat.absenceMisses ?? 0;
    return {
      text: miss > 0 ? `재접속 대기 ${Math.min(miss, 3)}/3` : "접속 끊김",
      tone: "text-destructive",
    };
  }
  if (seat.leavePending) return { text: "퇴장 예약", tone: "text-foreground/60" };
  if (seat.inRound) return { text: "진행중", tone: "text-gold-soft" };
  if (seat.isReady) return { text: "준비", tone: "text-jade" };
  return { text: "대기중", tone: "text-foreground/60" };
}

/**
 * 프로필 뷰포트 — 좌석당 하나만 존재한다.
 * 한 번 성공한 이미지는 Realtime rerender 로 다시 fallback 되지 않게 유지한다.
 */
function DoriAvatar({
  source,
  nickname,
  box,
  glow,
}: {
  source: string | null;
  nickname: string;
  box: { x: number; y: number; width: number; height: number };
  glow: boolean;
}) {
  /**
   * 이미 표시 가능한 URL(커스텀 프로필 signed URL · 번들 에셋)은 그대로 쓰고,
   * storage 경로만 조회 URL 로 해석한다.
   */
  const directSource = source && !isStoragePath(source) ? source : null;
  const resolved = useShopImage(directSource ? null : source);
  const loaded = useRef<string | null>(null);
  const [src, setSrc] = useState<string>(DEFAULT_CHARACTER);

  useEffect(() => {
    const next = directSource ?? resolved.url;
    if (next && next !== loaded.current) {
      loaded.current = next;
      setSrc(next);
    }
  }, [directSource, resolved.url]);

  return (
    <div
      className={cn(
        "pointer-events-none absolute overflow-hidden rounded-[9px] bg-black/45",
        glow && "shadow-[0_0_12px_-2px_var(--gold)]",
      )}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      <img
        src={src}
        alt={`${nickname} 캐릭터`}
        draggable={false}
        onError={() => setSrc(DEFAULT_CHARACTER)}
        className="h-full w-full select-none object-cover"
        style={{ objectPosition: "center top" }}
      />
    </div>
  );
}

/** CARDS 영역 안에서만 카드를 표시한다 (다른 영역 침범 0) */
function CardRow({
  faces,
  hidden,
  spec,
  makeCount,
}: {
  faces: string[];
  hidden: number;
  spec: DoriHudSpec;
  makeCount: number;
}) {
  const count = faces.length > 0 ? faces.length : hidden;
  if (count <= 0) return null;
  const step = doriCardStep(count, spec.cards.width, spec.cardWidth);
  const overlap = step - spec.cardWidth;
  const size = spec.cardWidth >= 80 ? "dori" : "sm";

  return (
    <div className="flex items-center justify-center">
      {faces.length > 0
        ? faces.map((card, i) => (
            <div key={`${card}-${i}`} style={i === 0 ? undefined : { marginLeft: overlap }}>
              <HwatuCard
                cardId={card}
                size={size}
                className={i < makeCount ? "opacity-70" : "ring-2 ring-gold"}
              />
            </div>
          ))
        : Array.from({ length: hidden }).map((_, i) => (
            <div key={i} style={i === 0 ? undefined : { marginLeft: overlap }}>
              <HwatuCard visual="FACE_DOWN" size={size} />
            </div>
          ))}
    </div>
  );
}

/**
 * 도리 전용 좌석 HUD — CLEAN SHELL 이미지 위에 AVATAR / INFO / CARDS 3구역만 얹는다.
 * 좌석번호는 좌상단, 선(딜러)은 닉네임 옆, 차례는 상단 중앙 + 프레임 glow 로 분리한다.
 */
export function DoriSeatHUD({
  seat,
  isTurn,
  isDealer,
  showdown,
  myCards = null,
  handPreview = null,
}: {
  seat: DoriSeatState;
  isTurn: boolean;
  isDealer: boolean;
  showdown: boolean;
  /** 내 좌석 카드 슬롯에 표시할 내 패 (본인 전용) */
  myCards?: string[] | null;
  /** "현재 최고패" 문구 (표시 전용 · 본인 좌석 전달만 허용) */
  handPreview?: string | null;
}) {
  const revealed = showdown && !seat.folded;
  const me = seat.isMe;
  const spec = me ? DORI_HUD_LAYOUT.self : DORI_HUD_LAYOUT.opponent;
  const frame = me ? DORI_UI.seatSelf : DORI_UI.seatOpponent;
  const status = statusOf(seat, showdown);
  const titleText = equippedName(seat.title ?? null);
  // 활성 커스텀 프로필(기간제)이 있으면 avatar 영역만 커스텀 이미지를 우선한다.
  const character = useResolvedAvatar(seat.userId, {
    equippedCharacterUrl: equippedAssetUrl(seat.characterUrl ?? null),
    defaultProfileUrl: equippedAssetUrl(seat.avatarUrl ?? null),
  });

  const madeOrder = [...(seat.selectedCards ?? []), ...(seat.remainingCards ?? [])];
  const faces = revealed ? madeOrder : me ? (myCards ?? []) : [];
  const hidden = faces.length > 0 ? 0 : seat.cardCount;

  return (
    <div
      className={cn("relative", seat.folded && "opacity-60")}
      style={{ width: spec.width, height: spec.height }}
    >
      {/* 그래픽 레이어 — CLEAN SHELL (값 없음) */}
      <img
        src={frame}
        alt=""
        aria-hidden
        draggable={false}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full select-none",
          isTurn && "drop-shadow-[0_0_18px_rgba(212,175,55,0.7)]",
        )}
      />

      {/* 차례 — HUD 상단 중앙 */}
      {isTurn && (
        <span className="pointer-events-none absolute -top-[10px] left-1/2 z-20 -translate-x-1/2 rounded-full border border-gold/70 bg-black/85 px-2.5 py-0.5 font-display text-[11px] tracking-widest text-gold shadow-[0_0_14px_-2px_var(--gold)]">
          차례
        </span>
      )}

      {/* 좌석번호 — 좌상단 배지 1개 */}
      <span
        className="pointer-events-none absolute flex items-center justify-center rounded-full border border-gold/55 bg-black/70 font-display text-gold"
        style={{
          left: spec.seatBadge.x,
          top: spec.seatBadge.y,
          width: spec.seatBadge.width,
          height: spec.seatBadge.height,
          fontSize: me ? 16 : 14,
        }}
      >
        {seat.seat}
      </span>

      {/* AVATAR — 좌석당 하나 */}
      <DoriAvatar source={character} nickname={seat.nickname} box={spec.avatar} glow={isTurn} />

      {/* PLAYER INFO — 카드 영역과 절대 겹치지 않는다 */}
      <div
        className="pointer-events-none absolute flex flex-col gap-[3px] overflow-hidden"
        style={{ left: spec.info.x, top: spec.info.y, width: spec.info.width }}
      >
        {/* NAME ROW — 칭호와 닉네임은 각각 독립 영역/독립 ellipsis */}
        <p
          className="flex min-w-0 items-center gap-1 leading-tight"
          style={{ fontSize: me ? 16 : 12 }}
          data-dori-name-row
        >
          <span
            data-dori-title
            title={titleText || NO_TITLE_LABEL}
            className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-gold-soft/90"
            style={{ maxWidth: spec.titleMaxWidth }}
          >
            {titleText || NO_TITLE_LABEL}
          </span>
          <span className="shrink-0 text-gold/35">|</span>
          <span
            data-dori-nickname
            title={seat.nickname}
            className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground"
          >
            {seat.nickname}
          </span>
          {isDealer && (
            <span className="ml-0.5 shrink-0 rounded-full border border-gold/60 bg-black/70 px-1 font-display text-[10px] text-gold">
              선
            </span>
          )}
        </p>

        <div className="flex items-center gap-1">
          <RankBadge rank={(seat.rank ?? null) as AppRank} size="sm" />
          <span className="text-[10px] text-foreground/50">Lv.{seat.level}</span>
        </div>

        {/* 포인트 행 — 이름/칭호 길이와 무관하게 항상 같은 위치 */}
        <p
          data-dori-points
          className="font-display leading-tight text-gold"
          style={{
            fontSize: me ? 24 : 15,
            whiteSpace: "nowrap",
          }}
        >
          {formatPoints(seat.points)}
        </p>
      </div>


      {/* 현재 최고패 — 본인 좌석 전용 한 줄 (상대 좌석에는 절대 렌더하지 않는다) */}
      {me && handPreview && spec.handPreview && (
        <div
          data-dori-hand-preview
          className="pointer-events-none absolute flex items-center justify-center gap-1.5 overflow-hidden rounded-md border border-gold/25 bg-black/55 leading-none"
          style={{
            left: spec.handPreview.x,
            top: spec.handPreview.y,
            width: spec.handPreview.width,
            height: spec.handPreview.height,
          }}
        >
          <span className="shrink-0 font-display text-[12px] tracking-wide text-gold-soft/80">
            현재 최고패
          </span>
          <span className="truncate font-display text-[16px] font-bold text-gold">
            {handPreview}
          </span>
        </div>
      )}

      {/* STATUS */}
      <div
        className="pointer-events-none absolute flex items-center gap-2 overflow-hidden text-[12px] leading-tight"
        style={{ left: spec.status.x, top: spec.status.y, width: spec.status.width * 1.6 }}
      >
        <span className={cn("truncate", status.tone)}>{status.text}</span>
        {seat.roundBet > 0 && (
          <span className="font-display text-gold-soft">{formatPoints(seat.roundBet)}</span>
        )}
      </div>

      {/* CARDS — 3/4/5장 모두 동일한 고정 footprint (카드 수에 따라 크기 변화 0) */}
      <div
        data-dori-card-area
        className="pointer-events-none absolute flex items-center justify-center overflow-hidden"
        style={{
          left: spec.cards.x,
          top: spec.cards.y,
          width: spec.cards.width,
          height: spec.cards.height,
          minWidth: spec.cards.width,
          maxWidth: spec.cards.width,
          minHeight: spec.cards.height,
          maxHeight: spec.cards.height,
          flex: "none",
        }}
      >

        <CardRow
          faces={faces}
          hidden={hidden}
          spec={spec}
          makeCount={revealed ? (seat.selectedCards?.length ?? 3) : 0}
        />
      </div>
    </div>
  );
}
