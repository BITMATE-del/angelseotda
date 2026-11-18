import type { EnginePlayerState } from "@/lib/game/engine";
import { ACTION_LABEL, type BetAction } from "@/lib/game/types";
import { RankBadge } from "@/components/rank/RankBadge";
import { tierOf, type AppRank } from "@/lib/game/rankTiers";
import { getEmoticon } from "@/lib/game/emoticons";
import { formatPoints } from "@/lib/services/walletService";
import { useShopImage } from "@/lib/shop/shopImage";
import { useResolvedAvatar } from "@/lib/profile/resolveAvatar";
import { cn } from "@/lib/utils";
import { CardRow, HiddenCardRow } from "./HwatuCard";
import type { SeatLoadout } from "@/lib/game/roomLoadout";
import { SUTDA_UI, sutdaOpponentFrame } from "@/lib/game/sutdaAssets";

/** 미장착 기본 캐릭터 — ANGEL ROOKIE */
export const DEFAULT_CHARACTER = "/characters/angel-rookie.jpg";

/** 칭호가 없는 회원 표시 (계급명을 칭호 자리에 쓰지 않는다) */
export const NO_TITLE_LABEL = "칭호없음";

/** 장기 미접속 퇴장 기준 (실제 action turn 소진 횟수) */
export const MISSED_TURN_LIMIT = 3;

/** 좌석에 표시할 통합 데이터 (라운드 참가자 + 방 착석자) */
export interface TableSeat {
  userId: string;
  seat: number;
  nickname: string;
  rank: string | null;
  title: string | null;
  characterUrl: string | null;
  points: number;
  isMe: boolean;
  connection: string;
  player: EnginePlayerState | null;
  cardCount: number;
  leavePending: boolean;
  /** 준비(READY) 상태 — 대기 중에만 표시 */
  isReady?: boolean;
  /** 연결 끊김 상태에서 놓친 실제 action turn 수 */
  missedTurns?: number;
}

/** 연결 끊김 좌석 안내 — 놓친 턴 누적이 있으면 재접속 대기 n/3 */
export function seatConnectionLabel(seat: TableSeat) {
  if (!seat.connection || seat.connection === "CONNECTED") return null;
  const missed = Math.min(Math.max(seat.missedTurns ?? 0, 0), MISSED_TURN_LIMIT);
  if (missed <= 0) return "연결 끊김";
  return `재접속 대기 ${missed}/${MISSED_TURN_LIMIT}`;
}

/** 대기/진행 상태 배지 텍스트 (좌석 상태 즉시 파악용) */
export function seatWaitingLabel(seat: TableSeat, waiting: boolean) {
  const conn = seatConnectionLabel(seat);
  if (conn) return conn;
  if (seat.leavePending) return "나가기 예약";
  if (!waiting) return null;
  return seat.isReady ? "READY" : "대기 중";
}

/**
 * 칭호 라벨 — 계급과 칭호는 완전히 다른 체계다.
 * 칭호가 없으면 "칭호없음"이며, 계급명(언랭크/챌린저 등)을 칭호 자리에 넣지 않는다.
 */
export function seatPrefixLabel(seat: TableSeat) {
  return seat.title?.trim() || NO_TITLE_LABEL;
}


export function SeatPortrait({
  seat,
  size = 56,
  isTurn,
  frameUrl = null,
}: {
  seat: TableSeat;
  size?: number;
  isTurn?: boolean;
  /** 장착 프로필 프레임 오버레이 */
  frameUrl?: string | null;
}) {
  /**
   * 장착 캐릭터가 최우선이다. items.asset_url 에는 storage 경로가 저장될 수 있으므로
   * 조회 URL 로 해석한 뒤 사용하고, 장착 캐릭터가 없거나 로드 실패일 때만 기본 캐릭터로 대체한다.
   */
  const character = useShopImage(seat.characterUrl);
  const frame = useShopImage(frameUrl);
  // 프로필 이미지 우선순위는 공통 resolver 하나로 통일한다 (커스텀 → 장착 캐릭터 → 기본).
  const src =
    useResolvedAvatar(seat.userId, {
      equippedCharacterUrl: character.url,
      defaultProfileUrl: DEFAULT_CHARACTER,
    }) ?? DEFAULT_CHARACTER;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border bg-black/50",
        isTurn ? "border-gold shadow-[0_0_14px_-2px_var(--gold)]" : "border-gold/30",
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt={`${seat.nickname} 캐릭터`}
        className="h-full w-full object-cover"
        onError={character.onError}
      />
    </div>

    {/* 장착 프레임 — 초상화 위에 겹치는 순수 연출 레이어.
        프레임 에셋 중앙이 불투명한 경우에도 얼굴이 가려지지 않도록 중앙을 마스크로 비운다. */}
    {frame.url && (
      <>
        <img
          src={frame.url}

          alt="프로필 프레임"
          className="pointer-events-none absolute -inset-[14%] h-[128%] w-[128%] object-contain"
          style={{
            maskImage:
              "radial-gradient(circle at 50% 50%, transparent 0 39%, black 47%, black 100%)",
            WebkitMaskImage:
              "radial-gradient(circle at 50% 50%, transparent 0 39%, black 47%, black 100%)",
          }}
        />
        {/* 프레임 장착 시 초상화 테두리에 골드 링 + 글로우를 더해 장착 여부가 즉시 보인다 */}
        <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-gold/80 shadow-[0_0_18px_-2px_var(--gold)]" />
      </>
    )}

    </div>
  );
}

/**
 * PlayerSeatHUD — 섯다형 평면 테이블의 상대 좌석.
 *
 * 구조는 모든 좌석에서 동일하다:
 *   [초상화] [1줄: 칭호 | 닉네임 / 2줄: 계급 / 보유 P]  [카드 2~3장 가로 정렬]
 *
 * · 카드는 HUD 옆 전용 컬럼에 고정되므로 아바타/텍스트/배지와 겹치지 않는다.
 * · READY / TURN / FOLD / ALL-IN 배지는 카드 컬럼 밖(상단·하단 줄)에만 놓는다.
 * · 폭이 고정되어 POT SAFE ZONE 을 침범하지 않는다.
 */
export function PlayerSeatHUD({
  seat,
  isTurn,
  revealed,
  backSkin,
  isWinner,
  reaction,
  waiting = false,
  loadout = null,
  side = "top",
  isDealer = false,
  cardMode = 2,
}: {
  seat: TableSeat;
  isTurn: boolean;
  /** SHOWDOWN 카드 공개 시점 */
  revealed: boolean;
  backSkin: string;
  isWinner: boolean;
  reaction?: string;
  /** 판이 진행 중이 아닌 대기 상태 (READY 배지 표시) */
  waiting?: boolean;
  /** 장착 아이템 연출 (프레임 · 닉네임 효과 · 카드 뒷면) */
  loadout?: SeatLoadout | null;
  /** 좌석 위치 — 우측 좌석은 카드를 안쪽(좌측)에 배치한다 */
  side?: "top" | "left" | "right";
  /** 이 판의 선(先) — 서버 dealer_seat 기준, 모든 클라이언트 동일 */
  isDealer?: boolean;
  /** 방 게임모드(2장/3장) — 좌석 프레임 이미지 선택용 (UI 전용) */
  cardMode?: 2 | 3;
}) {
  const player = seat.player;
  const reveal = revealed && !!player && !player.folded;
  const allCards = player?.cards ?? [];
  /** SHOWDOWN 결과에서는 최종 승부패로 제출된 2장만 표시한다 (3장 섯다 제3카드 숨김) */
  const finalCards =
    player?.selectedCards?.length === 2
      ? allCards.filter((c) => player.selectedCards!.includes(c))
      : allCards;
  const cards = reveal ? finalCards : allCards;
  const hiddenCount = Math.max(seat.cardCount, allCards.length);

  const disconnected = !!seat.connection && seat.connection !== "CONNECTED";
  const connLabel = seatConnectionLabel(seat);
  const missed = Math.min(Math.max(seat.missedTurns ?? 0, 0), MISSED_TURN_LIMIT);
  const waitLabel = seatWaitingLabel(seat, waiting);
  const delta =
    player && player.initialPoints != null && player.finalPoints != null
      ? player.finalPoints - player.initialPoints
      : null;
  const reactionEmote = reaction ? getEmoticon(reaction) : null;
  const back = loadout?.cardBack || backSkin;
  const rankLabel = tierOf((seat.rank as AppRank | null) ?? "UNRANKED").label;
  const titleLabel = seatPrefixLabel(seat);


  /** 카드 컬럼 — 항상 가로 정렬 · 간격 일정 · 잘림 없음 */
  const cardColumn = (
    <div className="flex w-[158px] shrink-0 items-center justify-center">
      {reveal ? (
        <CardRow cards={cards} size="smx" backSkin={back} />
      ) : cards.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <CardRow cards={cards} size="smx" backSkin={back} />
          {hiddenCount > cards.length && (
            <HiddenCardRow
              count={hiddenCount - cards.length}
              size="smx"
              backSkin={back}
              {...(player?.folded ? { dimmed: true } : {})}
            />
          )}
        </div>
      ) : hiddenCount > 0 ? (
        <HiddenCardRow
          count={hiddenCount}
          size="smx"
          backSkin={back}
          {...(player?.folded ? { dimmed: true } : {})}
        />
      ) : (
        <p
          className={cn(
            "text-[11px]",
            waitLabel === "READY" ? "text-jade" : "text-muted-foreground",
          )}
        >
          {waitLabel ?? "대기 중"}
        </p>
      )}
    </div>
  );

  const infoColumn = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <SeatPortrait seat={seat} size={78} isTurn={isTurn} frameUrl={loadout?.frame ?? null} />
      <div className="min-w-0 flex-1 text-left">
        {/* 1줄 — 칭호 | 닉네임 (한 줄 고정, 넉넉한 텍스트 폭 확보 + hover 전체 표시) */}
        <p className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[15px] font-semibold">
          <span className="max-w-[86px] shrink truncate text-gold-soft" title={titleLabel}>
            {titleLabel}
          </span>
          <span className="shrink-0 text-gold/50">|</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              loadout?.nameEffect ? "name-glow" : "text-foreground",
            )}
            title={loadout?.nameEffect ? `${seat.nickname} · 닉네임 효과` : seat.nickname}
          >
            {seat.nickname}
          </span>
        </p>
        {/* 2줄 — 계급 (배지 라벨로 한 번만 표시) */}
        <p
          className="mt-1 flex min-w-0 items-center whitespace-nowrap text-[12px] text-gold/80"
          title={rankLabel}
        >
          <RankBadge rank={(seat.rank as AppRank | null) ?? "UNRANKED"} size="md" />
        </p>

        {/* 3줄 — 보유 포인트 */}
        <p className="mt-0.5 truncate whitespace-nowrap font-display text-[17px] leading-tight text-gold">
          {formatPoints(seat.points)}
        </p>
      </div>
    </div>
  );




  return (
    <div
      className={cn(
        "relative w-[428px] rounded-xl px-3.5 py-2.5 transition",
        isTurn && "ring-1 ring-gold/60",
        waiting && seat.isReady && "ring-1 ring-jade/40",
        isWinner && revealed && "ring-2 ring-gold shadow-[0_0_28px_-6px_var(--gold)]",
        player?.folded && "opacity-45",
      )}
    >
      {/* 좌석 프레임 — 실제 이미지 에셋 그래픽 레이어 (CSS 재현 금지) */}
      <img
        src={sutdaOpponentFrame(cardMode)}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full select-none rounded-xl object-fill"
        draggable={false}
      />

      {/* 좌석번호 · 선(先) 배지 — 서버 좌석번호/dealer_seat 기준 (모든 클라이언트 동일) */}
      <span className="absolute -top-3 left-1 z-20 flex items-center gap-1">
        <span className="relative flex h-9 w-8 items-center justify-center">
          <img
            src={SUTDA_UI.seatNumberBadge}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          <span className="relative font-display text-[10px] text-gold-soft">{seat.seat}</span>
        </span>
        {isDealer && (
          <span className="relative flex h-9 w-9 items-center justify-center">
            <img
              src={SUTDA_UI.dealerBadge}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
            <span className="relative font-display text-[10px] text-gold">선</span>
          </span>
        )}
      </span>


      {reactionEmote && (
        <span className="animate-result absolute -top-3 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold/50 bg-black/85 px-2 py-0.5 text-[10px] text-gold-soft">
          {reactionEmote.glyph} {reactionEmote.label}
        </span>
      )}

      {/* HUD + 카드 — 우측 좌석은 카드를 테이블 안쪽(좌측)에 둔다 */}
      <div className="relative z-10 flex min-h-[112px] min-w-0 items-center gap-3">

        {side === "right" ? (
          <>
            {cardColumn}
            {infoColumn}
          </>
        ) : (
          <>
            {infoColumn}
            {cardColumn}
          </>
        )}
      </div>

      {/* 상태 배지 — 카드 위를 절대 가리지 않는 전용 줄 */}
      <div className="relative z-10 mt-1.5 flex flex-wrap items-center justify-center gap-1 text-[10px]">
        {isTurn ? (
          <span className="rounded bg-gold/25 px-1.5 py-0.5 font-display tracking-widest text-gold">
            TURN
          </span>
        ) : waitLabel === "READY" ? (
          <span className="rounded bg-jade/25 px-1.5 py-0.5 font-display tracking-widest text-jade">
            READY
          </span>
        ) : null}
        {!!player && player.bet > 0 && (
          <span className="rounded-full bg-black/45 px-1.5 py-0.5 text-gold-soft">
            {formatPoints(player.bet)}
          </span>
        )}

        {player?.folded ? (
          <span className="rounded bg-crimson/20 px-1.5 py-0.5 text-crimson">다이 FOLD</span>
        ) : player?.lastAction ? (
          <span className="rounded bg-jade/15 px-1.5 py-0.5 text-jade">
            {ACTION_LABEL[player.lastAction as BetAction]}
          </span>
        ) : null}
        {player?.allIn && !player.folded && (
          <span className="rounded bg-gold/25 px-1.5 py-0.5 font-display text-gold">올인</span>
        )}
        {seat.leavePending && (
          <span className="rounded bg-charcoal px-1.5 py-0.5 text-gold-soft">나가기예약</span>
        )}
        {disconnected && (
          <span
            className="rounded bg-destructive/20 px-1.5 py-0.5 text-destructive"
            title={
              missed >= MISSED_TURN_LIMIT
                ? "장기 미접속으로 라운드 종료 후 퇴장됩니다."
                : "재접속 대기 중입니다."
            }
          >
            {connLabel}
          </span>
        )}
        {missed >= MISSED_TURN_LIMIT && (
          <span className="rounded bg-crimson/20 px-1.5 py-0.5 text-crimson">
            라운드 종료 후 퇴장
          </span>
        )}

        {revealed && player?.hand?.name && (
          <span className="rounded bg-gold/15 px-1.5 py-0.5 text-gold-soft">{player.hand.name}</span>
        )}
        {revealed && delta !== null && delta !== 0 && (
          <span className={cn("font-display", delta > 0 ? "text-jade" : "text-crimson")}>
            {delta > 0 ? "+" : ""}
            {delta.toLocaleString("ko-KR")}P
          </span>
        )}
      </div>
    </div>
  );
}


/**
 * EmptySeatSlot — 빈 좌석(EMPTY). 좌석번호는 서버 값 그대로 고정되며,
 * 클릭 시 select_seat RPC 로 착석을 요청한다(동시 착석은 서버에서 한 명만 성공).
 */
export function EmptySeatSlot({
  seat,
  onSelect,
  disabled = false,
  reason,
}: {
  seat: number;
  onSelect?: (seat: number) => void;
  disabled?: boolean;
  /** 착석할 수 없는 이유 (게임 진행 중 좌석 이동 금지 등) */
  reason?: string;
}) {
  const clickable = !!onSelect && !disabled;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? () => onSelect(seat) : undefined}
      title={clickable ? `${seat}번 좌석에 앉기` : reason}
      className={cn(
        "relative flex min-h-[112px] w-[428px] items-center justify-center rounded-xl px-3.5 py-2.5 text-center transition",
        clickable ? "hover:brightness-110" : "opacity-55",
      )}
    >
      {/* 빈 좌석 프레임 — 실제 이미지 에셋 */}
      <img
        src={SUTDA_UI.seatEmpty}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full select-none rounded-xl object-fill"
        draggable={false}
      />
      <span className="absolute -top-3 left-1 z-20 flex h-9 w-8 items-center justify-center">
        <img
          src={SUTDA_UI.seatNumberBadge}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <span className="relative font-display text-[10px] text-gold-soft">{seat}</span>
      </span>
      {/* 빈 좌석 프레임 이미지에 "대기중 · 착석" 그래픽이 포함되어 있어 별도 라벨을 겹치지 않는다 */}
      {!clickable && (
        <span className="relative z-10 rounded bg-black/60 px-2 py-0.5 font-display text-[10px] tracking-widest text-gold-soft/70">
          착석 불가
        </span>
      )}
    </button>
  );
}
