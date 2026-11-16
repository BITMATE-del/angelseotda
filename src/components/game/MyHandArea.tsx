import { RankBadge } from "@/components/rank/RankBadge";
import { tierOf, type AppRank } from "@/lib/game/rankTiers";
import { ACTION_LABEL, type BetAction } from "@/lib/game/types";
import { formatPoints } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";
import { CardRow, HiddenCardRow, type CardVisual } from "./HwatuCard";
import { SeatPortrait, seatPrefixLabel, type TableSeat } from "./PlayerSeatHUD";
import type { SeatLoadout } from "@/lib/game/roomLoadout";
import { sutdaSelfFrame } from "@/lib/game/sutdaAssets";

/**
 * MyHandArea — 테이블 가장 아래, 내 패를 게임의 핵심 요소로 크게 표시한다.
 * POT SAFE ZONE과 별도 layout zone이므로 중앙 판돈과 절대 겹치지 않는다.
 */
export function MyHandArea({
  seat,
  isTurn,
  revealed,
  backSkin,
  cardVisuals,
  onRevealed,
  loadout = null,
  cardMode = 2,
}: {
  seat: TableSeat | null;
  isTurn: boolean;
  revealed: boolean;
  backSkin: string;
  cardVisuals?: readonly CardVisual[];
  onRevealed?: (cardId?: string) => void;
  /** 장착 아이템 연출 */
  loadout?: SeatLoadout | null;
  /** 방 게임모드 카드 장수 (2장/3장) — 내 좌석 프레임 이미지 선택용 (UI 전용) */
  cardMode?: 2 | 3;
}) {
  if (!seat) {
    return (
      <p className="text-center text-[11px] text-muted-foreground">
        좌석을 배정하는 중입니다…
      </p>
    );
  }
  const player = seat.player;
  const allCards = player?.cards ?? [];
  /** SHOWDOWN 결과에서는 최종 승부패 2장만 남긴다 (선택하지 않은 카드는 결과 UI에서 제거) */
  const finalCards =
    revealed && player?.selectedCards?.length === 2
      ? allCards.filter((c) => player.selectedCards!.includes(c))
      : allCards;
  const cards = finalCards;
  const hiddenCount = Math.max(seat.cardCount, allCards.length);
  const back = loadout?.cardBack || backSkin;


  return (
    <div
      className={cn(
        "relative flex min-h-[204px] w-[780px] max-w-full items-center justify-center gap-8 rounded-2xl px-12 py-5",
        isTurn && "ring-1 ring-gold/60",
        player?.folded && "opacity-55",
      )}
    >
      {/* 내 좌석 프레임 — 실제 이미지 에셋 */}
      <img
        src={sutdaSelfFrame(cardMode)}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full select-none rounded-2xl object-fill"
        draggable={false}
      />
      <div className="relative z-10 flex w-[212px] min-w-0 flex-col items-center gap-1 text-center">
        <SeatPortrait seat={seat} size={86} isTurn={isTurn} frameUrl={loadout?.frame ?? null} />
        {/* 1줄 — 칭호 | 닉네임 */}
        <p className="flex min-w-0 max-w-full items-center justify-center gap-1 whitespace-nowrap text-[13.5px] font-semibold">
          <span className="max-w-[92px] truncate text-gold-soft" title={seatPrefixLabel(seat)}>
            {seatPrefixLabel(seat)}
          </span>
          <span className="text-gold/50">|</span>
          <span
            className={cn(
              "max-w-[112px] truncate",
              loadout?.nameEffect ? "name-glow" : "text-foreground",
            )}
            title={loadout?.nameEffect ? `${seat.nickname} · 닉네임 효과` : seat.nickname}
          >
            {seat.nickname}
          </span>
        </p>
        {/* 2줄 — 계급 */}
        <p className="flex min-w-0 items-center justify-center gap-1 whitespace-nowrap text-[10.5px] text-gold/80">
          <RankBadge rank={(seat.rank as AppRank | null) ?? "UNRANKED"} size="sm" />
          <span className="truncate">{tierOf((seat.rank as AppRank | null) ?? "UNRANKED").label}</span>
        </p>


        <p className="font-display text-[15px] leading-tight text-gold">
          {formatPoints(seat.points)}
        </p>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-1">
        <div className="flex items-end justify-center gap-2">
          {cards.length > 0 ? (
            <CardRow
              cards={cards}
              size="lg"
              backSkin={back}
              {...(cardVisuals && cards.length === allCards.length
                ? { visuals: cardVisuals }
                : cards.length !== allCards.length
                  ? { visuals: cards.map(() => "FACE_UP" as const) }
                  : {})}

              {...(onRevealed ? { onRevealed } : {})}
              {...(player?.folded ? { dimmed: true } : {})}
            />

          ) : hiddenCount > 0 ? (
            <HiddenCardRow count={hiddenCount} size="lg" backSkin={back} />
          ) : (
            <p className="py-2 text-[11px] text-muted-foreground">판 시작을 기다리는 중…</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px]">
          <span className="rounded-full bg-black/45 px-2 py-0.5 text-gold-soft">
            이번 판 {formatPoints(player?.bet ?? 0)}
          </span>
          <span className="rounded-full bg-black/30 px-2 py-0.5 text-muted-foreground">
            누적 {formatPoints(Number(player?.totalBet ?? 0))}
          </span>
          {player?.folded ? (
            <span className="rounded bg-crimson/20 px-2 py-0.5 text-crimson">다이 FOLD</span>
          ) : player?.lastAction ? (
            <span className="rounded bg-jade/15 px-2 py-0.5 text-jade">
              {ACTION_LABEL[player.lastAction as BetAction]}
            </span>
          ) : null}
          {player?.allIn && !player.folded && (
            <span className="rounded bg-gold/25 px-2 py-0.5 font-display text-gold">올인 ALL-IN</span>
          )}
          {revealed && player?.hand?.name && (
            <span className="rounded bg-gold/15 px-2 py-0.5 text-gold-soft">{player.hand.name}</span>
          )}
          {seat.leavePending && (
            <span className="rounded bg-charcoal px-2 py-0.5 text-gold-soft">나가기예약</span>
          )}
        </div>
      </div>
    </div>
  );
}
