import { useEffect, useRef, useState } from "react";
import { RankBadge } from "@/components/rank/RankBadge";
import { HwatuCard, type CardVisual } from "@/components/game/HwatuCard";
import {
  DEFAULT_CHARACTER,
  MISSED_TURN_LIMIT,
  seatConnectionLabel,
  seatPrefixLabel,
  seatWaitingLabel,
  type TableSeat,
} from "@/components/game/PlayerSeatHUD";
import type { SeatLoadout } from "@/lib/game/roomLoadout";
import type { AppRank } from "@/lib/game/rankTiers";
import { ACTION_LABEL, type BetAction } from "@/lib/game/types";
import { getEmoticon } from "@/lib/game/emoticons";
import { formatPoints } from "@/lib/services/walletService";
import { isStoragePath, useShopImage } from "@/lib/shop/shopImage";
import { useResolvedAvatar } from "@/lib/profile/resolveAvatar";
import { cn } from "@/lib/utils";
import { SUTDA_UI } from "@/lib/game/sutdaAssets";
import {
  BADGES,
  SUTDA2_LAYOUT,
  Z,
  zoneStyle,
  type HudSpec,
  type SutdaCleanLayout,
} from "@/lib/game/sutda2CleanLayout";
import { resolveMasterAvatarSource } from "@/lib/game/sutdaMasterLayout";


/** 좌석 shell — CLEAN SHELL 이미지만 렌더링한다 (장식 · 클릭 차단 없음) */
function SeatShell({ spec, glow }: { spec: HudSpec; glow: boolean }) {
  return (
    <img
      src={spec.shell}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full select-none",
        glow && "drop-shadow-[0_0_18px_rgba(212,175,55,0.65)]",
      )}
      style={{ zIndex: Z.seatShell }}
    />
  );
}

/**
 * 좌석번호 배지 — HUD 프레임 바깥 좌상단 anchor.
 * 배지 box 는 avatar safe zone 시작점 위/왼쪽에서 끝나므로 프로필을 절대 침범하지 않는다.
 */
function SeatNumberBadge({ seat }: { seat: number }) {
  return (
    <span
      className="pointer-events-none absolute flex items-center justify-center"
      style={{
        left: BADGES.seatNumber.x,
        top: BADGES.seatNumber.y,
        width: BADGES.seatNumber.width,
        height: BADGES.seatNumber.height,
        zIndex: Z.badges,
      }}
    >
      <img
        src={SUTDA_UI.seatNumberBadge}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-contain"
      />
      <span className="relative font-display text-[12px] text-gold-soft">{seat}</span>
    </span>
  );
}

/**
 * AVATAR ZONE — 좌석당 프로필 element 정확히 1개.
 * 장착 캐릭터가 최우선이고, 없거나 로드 실패일 때만 기본 실루엣으로 대체한다.
 * safe zone 안에서만 렌더되므로 프레임 장식 · 좌석번호 배지와 겹치지 않는다.
 */
function SeatAvatar({
  source,
  nickname,
  spec,
  glow,
  frameUrl,
}: {
  source: string | null;
  nickname: string;
  spec: HudSpec;
  glow: boolean;
  frameUrl: string | null;
}) {
  /**
   * 이미 표시 가능한 URL(커스텀 프로필 signed URL · 번들 에셋)은 그대로 쓰고,
   * storage 경로만 조회 URL 로 해석한다. (signed URL 을 다시 해석하면 값이 버려진다)
   */
  const directSource = source && !isStoragePath(source) ? source : null;
  const resolved = useShopImage(directSource ? null : source);
  const frame = useShopImage(frameUrl);
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
      data-sutda-avatar
      className="pointer-events-none"
      style={zoneStyle(spec.avatarZone, Z.avatar)}
    >
      <div
        className={cn(
          "h-full w-full overflow-hidden rounded-[10px] border",
          glow ? "border-gold shadow-[0_0_14px_-2px_var(--gold)]" : "border-gold/25",
        )}
      >
        <img
          src={src}
          alt={`${nickname} 캐릭터`}
          draggable={false}
          onError={() => setSrc(DEFAULT_CHARACTER)}
          className="h-full w-full select-none object-cover"
          style={{ objectPosition: "center top" }}
        />
        {frame.url && (
          <img
            src={frame.url}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
          />
        )}
      </div>
    </div>
  );
}

/**
 * CARD ZONE — 슬롯 수(2장/3장)를 항상 예약한다 (0장~N장 모두 동일 footprint).
 * zone 안에서만 렌더되므로 프레임 우측 장식에 붙지 않는다.
 *
 * 3장 섯다 최종 승부패 선택 단계에서는 내 카드가 선택 가능해진다 (표시 전용 · 확정은 서버).
 */
function SeatCards({
  spec,
  slots,
  faces,
  hiddenCount,
  backSkin,
  visuals,
  onRevealed,
  dimmed,
  selectable = false,
  selected = [],
  onToggleCard,
  openCard = null,
}: {
  spec: HudSpec;
  slots: number;
  faces: readonly string[];
  hiddenCount: number;
  backSkin: string;
  visuals?: readonly CardVisual[] | undefined;
  onRevealed?: ((cardId?: string) => void) | undefined;
  dimmed: boolean;
  selectable?: boolean;
  selected?: readonly string[];
  onToggleCard?: ((card: string) => void) | undefined;
  /** 3장 섯다 공개패 (표시 전용 · 서버가 내려준 값만 사용) */
  openCard?: string | null;
}) {
  return (
    <div
      data-sutda-card-area
      className={cn(
        /* 카드 영역은 절대 clip 하지 않는다 (avatar wrapper 만 overflow:hidden) */
        "flex items-center overflow-visible",
        spec.cardAlign === "center" ? "justify-center" : "justify-end",
      )}
      style={{ ...zoneStyle(spec.cardZone, Z.cards), gap: spec.cardGap }}
    >
      {Array.from({ length: slots }).map((_, i) => {
        const face = faces[i];
        const hidden = !face && i < hiddenCount;
        const picked = !!face && selected.includes(face);
        const pickable = selectable && !!face && !!onToggleCard;
        /** 공개패 강조 — 카드 배열 순서는 바꾸지 않고 표시만 구분한다 */
        const isOpen = !!face && !!openCard && face === openCard;
        return (
          <div
            /**
             * key 는 카드 identity 기준이다.
             * index key 를 쓰면 3장 → 최종 2장으로 슬롯 내용이 바뀔 때 같은 <img> DOM 이
             * 재사용되어 새 이미지가 디코딩되기 전까지 "이전 카드 이미지"가 남는다
             * (예: 7/10 이 순간적으로 7/7 처럼 보이는 현상). 서버 카드값은 바꾸지 않는다.
             */
            key={face ? `card-${face}` : `slot-${i}`}
            className="flex shrink-0 items-center justify-center overflow-visible"
            style={{ width: spec.cardWidth, height: spec.cardHeight }}
          >
            {face ? (
              <span
                data-sutda-card-slot
                className={cn(
                  "relative block transition-transform",
                  pickable && "pointer-events-auto cursor-pointer",
                  picked && "-translate-y-2",
                )}
                onClick={pickable ? () => onToggleCard(face) : undefined}
              >
                <HwatuCard
                  cardId={face}
                  visual={visuals?.[i] ?? "FACE_UP"}
                  size={spec.cardSize}
                  backSkin={backSkin}
                  {...(onRevealed ? { onRevealed } : {})}
                  {...(dimmed ? { dimmed: true } : {})}
                />
                {selectable && (
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-0 rounded-lg border-2",
                      picked
                        ? "border-gold shadow-[0_0_16px_-2px_var(--gold)]"
                        : "border-transparent",
                    )}
                  />
                )}
                {picked && (
                  <span className="pointer-events-none absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-gold bg-black/85 font-display text-[11px] text-gold">
                    ✓
                  </span>
                )}
                {isOpen && (
                  <>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-lg border-2 border-gold shadow-[0_0_18px_-2px_var(--gold)]"
                    />
                    <span
                      data-sutda-open-card-badge
                      className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold bg-black/85 px-1.5 py-[1px] font-display text-[10px] leading-none tracking-wide text-gold"
                    >
                      공개패
                    </span>
                  </>
                )}
              </span>
            ) : hidden ? (
              <HwatuCard
                visual="FACE_DOWN"
                size={spec.cardSize}
                backSkin={backSkin}
                {...(dimmed ? { dimmed: true } : {})}
              />
            ) : (
              /* 빈 슬롯 — 실제 카드와 동일한 위치/크기의 placeholder */
              <span
                aria-hidden
                className="block rounded-lg border border-gold/10"
                style={{ width: spec.cardWidth, height: spec.cardHeight }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}


/** INFO ZONE — ROW1 칭호|닉네임 / ROW2 티어 / ROW3 포인트 */
function SeatInfo({
  spec,
  titleLabel,
  nickname,
  rank,
  points,
  nameEffect,
}: {
  spec: HudSpec;
  titleLabel: string;
  nickname: string;
  rank: AppRank | null;
  points: number;
  nameEffect: boolean;
}) {
  return (
    <div
      data-sutda-info
      className="pointer-events-none flex min-w-0 flex-col justify-center overflow-hidden"
      style={{ ...zoneStyle(spec.infoZone, Z.info), rowGap: spec.infoRowGap }}
    >
      <div
        data-sutda-name-row
        className="flex min-w-0 items-center gap-1 leading-none"
        style={{ fontSize: spec.nameFontSize }}
      >
        <span
          data-sutda-title
          title={titleLabel}
          className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-gold-soft/90"
          style={{ maxWidth: spec.titleMaxWidth }}
        >
          {titleLabel}
        </span>
        <span className="shrink-0 text-gold/35">|</span>
        <span
          data-sutda-nickname
          title={nickname}
          className={cn(
            "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
            nameEffect ? "name-glow" : "text-foreground",
          )}
        >
          {nickname}
        </span>
      </div>

      <div data-sutda-rank-row className="flex min-w-0 items-center">
        <RankBadge rank={rank ?? "UNRANKED"} size={spec.rankSize} />
      </div>

      <div
        data-sutda-points
        className="flex items-center font-display font-bold text-gold"
        style={{ fontSize: spec.pointFontSize, whiteSpace: "nowrap" }}
      >
        {formatPoints(points)}
      </div>
    </div>
  );
}

/**
 * Sutda2SeatHUD — 2장 섯다 좌석 HUD (CLEAN SHELL · 내부 safe zone 배치).
 * [AVATAR ZONE][INFO ZONE][CARD ZONE] + 하단 STATUS ZONE.
 * 좌석번호/선/차례 배지만 HUD 프레임 외부 anchor 다.
 */
export function Sutda2SeatHUD({
  seat,
  isTurn,
  isDealer,
  revealed,
  backSkin,
  isWinner,
  waiting,
  loadout = null,
  reaction,
  cardVisuals,
  onRevealed,
  layout = SUTDA2_LAYOUT,
  selectable = false,
  selected = [],
  onToggleCard,
  handPreview = null,
  hideOpponentCards = false,
  openCard = null,
}: {
  seat: TableSeat;
  isTurn: boolean;
  isDealer: boolean;
  /** SHOWDOWN 카드 공개 시점 (서버 판정) */
  revealed: boolean;
  backSkin: string;
  isWinner: boolean;
  waiting: boolean;
  loadout?: SeatLoadout | null;
  reaction?: string | undefined;
  /** 본인 카드 시각 상태 (쪼기) */
  cardVisuals?: readonly CardVisual[] | undefined;
  onRevealed?: ((cardId?: string) => void) | undefined;
  /** 좌표 bundle — 2장(기본) / 3장 */
  layout?: SutdaCleanLayout;
  /** 3장 최종 승부패 선택 단계 (내 좌석 전용) */
  selectable?: boolean;
  selected?: readonly string[];
  onToggleCard?: ((card: string) => void) | undefined;
  /** 내 카드 아래 "현재 족보" 미리보기 문구 (표시 전용 · 상대 좌석 전달 금지) */
  handPreview?: string | null;
  /** 2장 섯다 전용 — SHOWDOWN 이전 상대 좌석 카드는 앞면으로 렌더하지 않는다 (표시 전용) */
  hideOpponentCards?: boolean;
  /** 3장 섯다 공개패 (표시 전용 · 서버가 공개를 허용한 카드만 전달된다) */
  openCard?: string | null;
}) {
  const me = seat.isMe;
  const spec = me ? layout.self : layout.opponent;
  // 프로필 이미지 우선순위는 공통 resolver 하나로 통일한다 (커스텀 → 장착 캐릭터 → 기본).
  const avatarSrc = useResolvedAvatar(seat.userId, {
    equippedCharacterUrl: resolveMasterAvatarSource(seat.characterUrl).src,
  });

  const player = seat.player;
  const allCards = player?.cards ?? [];
  /** SHOWDOWN 에서는 최종 승부패 2장만 남긴다 */
  const finalCards =
    revealed && player?.selectedCards?.length === 2
      ? allCards.filter((c) => player.selectedCards!.includes(c))
      : allCards;
  /**
   * 앞면 렌더는 "서버가 내려준 카드"만 사용한다.
   * 상대 좌석의 경우 서버(get_round_state)가 공개 허용된 카드(3장방 공개패 · 2장방 첫 장,
   * SHOWDOWN 최종패)만 전달하므로, 클라이언트는 그 값을 그대로 앞면으로 고정 표시한다.
   * hidden card identity 는 애초에 클라이언트로 오지 않는다 (CSS 숨김 방식 아님).
   */
  /** 2장 섯다: SHOWDOWN 공개 전까지 상대 좌석은 앞면 카드를 렌더하지 않는다 */
  const faces = hideOpponentCards && !me && !revealed ? [] : finalCards;
  const hiddenCount = Math.max(seat.cardCount, allCards.length);

  const back = loadout?.cardBack || backSkin;
  const titleLabel = seatPrefixLabel(seat);
  const waitLabel = seatWaitingLabel(seat, waiting);
  const connLabel = seatConnectionLabel(seat);
  const missed = Math.min(Math.max(seat.missedTurns ?? 0, 0), MISSED_TURN_LIMIT);
  const reactionEmote = reaction ? getEmoticon(reaction) : null;

  const statusText = player?.folded
    ? "다이"
    : player?.allIn
      ? "올인"
      : missed >= MISSED_TURN_LIMIT
        ? "장기 미접속 · 판 종료 후 퇴장"
        : (connLabel ?? (isTurn ? "차례" : (waitLabel ?? (player ? "진행중" : "대기중"))));
  const statusTone = player?.folded
    ? "text-destructive"
    : player?.allIn
      ? "text-crimson"
      : connLabel || missed >= MISSED_TURN_LIMIT
        ? "text-destructive"
        : isTurn
          ? "text-gold"
          : waitLabel === "READY"
            ? "text-jade"
            : "text-foreground/70";

  return (
    <div
      className={cn("relative", player?.folded && "opacity-60")}
      style={{ width: spec.width, height: spec.height }}
    >
      <SeatShell spec={spec} glow={isTurn || (isWinner && revealed)} />

      <SeatNumberBadge seat={seat.seat} />

      {/* 선(dealer) 배지 — 좌석번호 오른쪽 보조 anchor, avatar zone 위를 덮지 않는다 */}
      {isDealer && (
        <span
          className="pointer-events-none absolute flex items-center justify-center"
          style={{
            left: BADGES.dealer.x,
            top: BADGES.dealer.y,
            width: BADGES.dealer.width,
            height: BADGES.dealer.height,
            zIndex: Z.badges,
          }}
        >
          <img
            src={SUTDA_UI.dealerBadge}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />
          <span className="relative font-display text-[10px] text-gold">선</span>
        </span>
      )}

      {/* 차례 배지 — HUD 상단 중앙 1회 (상태줄과 겹치지 않는다) */}
      {isTurn && (
        <span
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full border border-gold/70 bg-black/85 px-2.5 py-0.5 font-display text-[11px] tracking-widest text-gold shadow-[0_0_14px_-2px_var(--gold)]"
          style={{ top: BADGES.turnTop, zIndex: Z.badges }}
        >
          차례
        </span>
      )}

      <SeatAvatar
        source={avatarSrc ?? resolveMasterAvatarSource(seat.characterUrl).src}
        nickname={seat.nickname}
        spec={spec}
        glow={isTurn}
        frameUrl={loadout?.frame ?? null}
      />

      <SeatInfo
        spec={spec}
        titleLabel={titleLabel}
        nickname={seat.nickname}
        rank={(seat.rank as AppRank | null) ?? null}
        points={seat.points}
        nameEffect={!!loadout?.nameEffect}
      />

      <SeatCards
        spec={spec}
        slots={layout.cardSlots}
        faces={faces}
        hiddenCount={hiddenCount}
        backSkin={back}
        {...(me && cardVisuals ? { visuals: cardVisuals } : {})}
        {...(me && onRevealed ? { onRevealed } : {})}
        dimmed={!!player?.folded}
        selectable={me && selectable}
        selected={selected}
        {...(me && onToggleCard ? { onToggleCard } : {})}
        openCard={openCard}
      />


      {/* 현재 최고패 — 내 카드 바로 아래 한 줄 (표시 전용, 본인 화면만) */}
      {me && handPreview && spec.handPreviewZone && (
        <div
          data-sutda-hand-preview
          className="pointer-events-none flex items-center justify-center gap-1.5 overflow-hidden rounded-md border border-gold/25 bg-black/55 leading-none"
          style={zoneStyle(spec.handPreviewZone, Z.info)}
        >
          <span className="shrink-0 font-display text-[12px] tracking-wide text-gold-soft/80">
            현재 최고패
          </span>
          <span className="truncate font-display text-[16px] font-bold text-gold">
            {handPreview}
          </span>
        </div>
      )}

      {/* STATUS ZONE — HUD 하단 전용 한 줄 (avatar/card zone 아래) */}
      <div
        data-sutda-status
        className="pointer-events-none flex items-center gap-2 overflow-hidden leading-none"
        style={{ ...zoneStyle(spec.statusZone, Z.info), fontSize: spec.statusFontSize }}
      >
        <span className={cn("truncate font-display tracking-wide", statusTone)}>{statusText}</span>
        {!!player && player.bet > 0 && (
          <span className="shrink-0 font-display text-gold-soft">{formatPoints(player.bet)}</span>
        )}
        {player?.lastAction && !player.folded && (
          <span className="shrink-0 text-jade">{ACTION_LABEL[player.lastAction as BetAction]}</span>
        )}
        {revealed && player?.hand?.name && (
          <span className="shrink-0 text-gold-soft">{player.hand.name}</span>
        )}
      </div>

      {reactionEmote && (
        <span
          className="animate-result pointer-events-none absolute -top-3 right-2 whitespace-nowrap rounded-full border border-gold/50 bg-black/85 px-2 py-0.5 text-[10px] text-gold-soft"
          style={{ zIndex: Z.badges }}
        >
          {reactionEmote.glyph} {reactionEmote.label}
        </span>
      )}
    </div>
  );
}

/** 빈 좌석 — 동일 safe zone 기준 [기본 프로필][대기중 + 착석], 카드 zone 미렌더 */
export function Sutda2EmptySeat({
  seat,
  onSelect,
  disabled = false,
  reason,
  layout = SUTDA2_LAYOUT,
}: {
  seat: number;
  onSelect?: ((seat: number) => void) | undefined;
  disabled?: boolean;
  reason?: string | undefined;
  layout?: SutdaCleanLayout;
}) {
  const spec = layout.empty;

  const clickable = !!onSelect && !disabled;
  return (
    <div className="relative" style={{ width: spec.width, height: spec.height }}>
      <SeatShell spec={spec} glow={false} />
      <SeatNumberBadge seat={seat} />

      {/* 기본 프로필 — 좌석당 1개 */}
      <div
        className="pointer-events-none overflow-hidden rounded-[10px] border border-gold/20"
        style={zoneStyle(spec.avatarZone, Z.avatar)}
      >
        <img
          src={DEFAULT_CHARACTER}
          alt=""
          aria-hidden
          draggable={false}
          className="h-full w-full select-none object-cover opacity-45"
          style={{ objectPosition: "center top" }}
        />
      </div>

      <div
        className="flex min-w-0 flex-col items-start justify-center gap-2"
        style={zoneStyle(spec.infoZone, Z.info)}
      >
        <span className="font-display text-[12px] tracking-widest text-gold-soft/80">대기중</span>
        <button
          type="button"
          disabled={!clickable}
          onClick={clickable && onSelect ? () => onSelect(seat) : undefined}
          title={clickable ? `${seat}번 좌석에 앉기` : reason}
          className={cn(
            "pointer-events-auto rounded-lg border px-4 py-1 font-display text-[13px] tracking-widest transition",
            clickable
              ? "border-gold/70 bg-gold/15 text-gold hover:bg-gold/25"
              : "border-gold/20 bg-black/40 text-gold-soft/50",
          )}
        >
          {clickable ? "착석" : "착석 불가"}
        </button>
      </div>
    </div>
  );
}
