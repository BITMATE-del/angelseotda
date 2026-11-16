import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineState } from "@/lib/game/engine";
import type { SidePot } from "@/lib/services/serverGameService";
import type { RoomLoadouts } from "@/lib/game/roomLoadout";
import type { TableSeat } from "@/components/game/PlayerSeatHUD";
import type { CardVisual } from "@/components/game/HwatuCard";
import { formatPoints } from "@/lib/services/walletService";
import { SUTDA_UI } from "@/lib/game/sutdaAssets";
import { SUTDA2_LAYOUT, Z, type SutdaCleanLayout } from "@/lib/game/sutda2CleanLayout";

import { Sutda2EmptySeat, Sutda2SeatHUD } from "./Sutda2SeatHUD";

export interface Sutda2RoomInfo {
  roomNumber: number | null;
  gradeLabel: string;
  baseBet: number;
  seatedCount: number;
  maxPlayers: number;
}

type Slot = { kind: "seat"; seat: TableSeat } | { kind: "empty"; number: number };

/**
 * POT count-up — 서버 POT 값이 증가하면 약 400ms 동안 숫자를 올린다.
 * 마지막 프레임은 항상 서버 확정 값이며, reduced-motion 에서는 즉시 확정 값을 표시한다.
 */
function useSutda2PotCountUp(pot: number) {
  const [shown, setShown] = useState(pot);
  const [bumped, setBumped] = useState(false);
  const prev = useRef(pot);

  useEffect(() => {
    const from = prev.current;
    prev.current = pot;
    if (pot === from) return;
    if (pot < from) {
      setShown(pot);
      return;
    }
    setBumped(true);
    const bump = window.setTimeout(() => setBumped(false), 500);

    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduce = false;
    }
    if (reduce || document.hidden) {
      setShown(pot);
      return () => window.clearTimeout(bump);
    }

    const start = performance.now();
    const DURATION = 420;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setShown(t >= 1 ? pot : Math.round(from + (pot - from) * t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(bump);
      setShown(pot);
    };
  }, [pot]);

  return { shown, bumped };
}

/**
 * Sutda2Board — 2장 섯다 게임판 (CLEAN SHELL REBUILD).
 *
 * STAGE(1500×760) 안에 background · top bar · seat1~5 · POT · progress · bottom bar 가 모두 들어간다.
 * 바깥 컨테이너 크기만 관찰해 uniform scale 로 축소하므로 카드 지급/HUD 내용은 좌표에 영향을 주지 않는다.
 */
export function Sutda2Board({
  height,
  state,
  seats,
  mySeat,
  maxPlayers,
  dealerSeat,
  backSkin,
  revealed,
  waiting,
  loadouts,
  reactions,
  reservedSeats,
  onSelectSeat,
  seatSelectReason,
  myCardVisuals,
  onMyCardRevealed,
  pot,
  baseBet,
  pots,
  isRematchRound,
  carryIn,
  cardIntegrityOk,
  callAmount,
  myContribution,
  potSumOk,
  potAnchorRef,
  registerSeatEl,
  roomInfo,
  phaseBadge,
  turnNotice,
  topControls,
  bottomBar,
  fx,
  flightLayerRef,
  layout = SUTDA2_LAYOUT,
  selectable = false,
  selectedCards = [],
  onToggleCard,
  handPreview = null,
  hideOpponentCards = false,
  openCards = {},
  timerBadge = null,
}: {
  /**
   * 3장 섯다 공개패 (userId → 카드).
   * 서버(get_round_state)가 공개를 허용한 값만 담긴다 — 공개 전 상대 카드는 애초에 오지 않는다.
   */
  openCards?: Record<string, string | null>;
  /** 서버 deadline 기준 타이머 배지 (표시 전용 · 자체 갱신) */
  timerBadge?: React.ReactNode | undefined;
  /** 2장 섯다 전용 — SHOWDOWN 이전 상대 카드 앞면 렌더 금지 (표시 전용) */
  hideOpponentCards?: boolean;
  /** 좌표 bundle — 2장 섯다(기본) 또는 3장 섯다 (디자인 동일 · 카드 영역만 확장) */
  layout?: SutdaCleanLayout;
  /** 3장 최종 승부패 선택 단계 (내 좌석 카드 선택 · 확정은 서버) */
  selectable?: boolean;
  selectedCards?: readonly string[];
  onToggleCard?: ((card: string) => void) | undefined;
  /** 내 카드 아래 "현재 족보" 미리보기 (표시 전용) */
  handPreview?: string | null;
  /** 고정 높이 (미지정 시 바깥 컨테이너 높이를 그대로 사용한다) */
  height?: number | undefined;
  state: EngineState | null;
  seats: TableSeat[];
  mySeat: number | null;
  maxPlayers: number;
  dealerSeat: number | null;
  backSkin: string;
  revealed: boolean;
  waiting: boolean;
  loadouts: RoomLoadouts;
  reactions: Record<string, string>;
  reservedSeats: ReadonlySet<number>;
  onSelectSeat?: ((seat: number) => void) | undefined;
  seatSelectReason?: string | undefined;
  myCardVisuals?: readonly CardVisual[] | undefined;
  onMyCardRevealed?: ((cardId?: string) => void) | undefined;
  pot: number;
  baseBet: number;
  pots: SidePot[];
  isRematchRound: boolean;
  carryIn: number;
  cardIntegrityOk: boolean;
  callAmount: number | null;
  myContribution: number | null;
  potSumOk: boolean;
  potAnchorRef?: React.RefObject<HTMLDivElement | null> | undefined;
  registerSeatEl?: ((userId: string, el: HTMLDivElement | null) => void) | undefined;
  roomInfo?: Sutda2RoomInfo | undefined;
  /** 현재 진행 단계 배지 (표시 전용) */
  phaseBadge?: string | undefined;
  /** 턴 안내 문구 (표시 전용) */
  turnNotice?: string | undefined;
  /** 우상단 컨트롤 (사운드/전체화면/게임모드/나가기 등) */
  topControls?: React.ReactNode | undefined;
  /** 하단 공용 슬롯 — READY compact bar 또는 액션바 */
  bottomBar?: React.ReactNode | undefined;
  /** 코인/포인트 연출 레이어 (표시 전용 · 클릭 차단 없음) */
  fx?: React.ReactNode | undefined;
  flightLayerRef?: React.RefObject<HTMLDivElement | null> | undefined;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  /** 바깥 컨테이너만 관찰한다 (stage 내부 콘텐츠 변화로 재측정되지 않는다) */
  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = el.clientWidth || rect.width;
    const avail = height ?? (el.clientHeight || rect.height);
    const next = Math.min(width / layout.stage.width, avail / layout.stage.height);
    const clamped = Math.max(0.3, Number.isFinite(next) && next > 0 ? next : 1);
    setScale((prev) => (Math.abs(prev - clamped) < 0.002 ? prev : clamped));
  }, [height]);

  useEffect(() => {
    measure();
    const el = viewportRef.current;
    const ro = new ResizeObserver(() => measure());
    if (el) ro.observe(el);
    window.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("fullscreenchange", measure);
    };
  }, [measure]);

  /** POT 금액 count-up + 증가 강조 (표시 전용 · 마지막 값은 항상 서버 확정 POT) */
  const { shown: shownPot, bumped } = useSutda2PotCountUp(pot);

  const me = seats.find((s) => s.isMe) ?? null;

  /**
   * 시각 좌석 배치 — DB 좌석번호는 그대로 두고, 내 좌석을 하단 중앙으로 두기 위해
   * 나머지 좌석번호를 (내 좌석 + 1) 부터 순환 순서로 채운다.
   */
  const slots = useMemo<Slot[]>(() => {
    const bySeat = new Map(seats.filter((s) => !s.isMe).map((s) => [s.seat, s]));
    const highest = Math.max(maxPlayers, ...seats.map((s) => s.seat), 1);
    const base = me?.seat ?? mySeat ?? 0;
    const out: Slot[] = [];
    for (let i = 1; i <= highest; i += 1) {
      const n = ((base + i - 1) % highest) + 1;
      if (me && me.seat === n) continue;
      if (!me && n === mySeat) continue;
      const s = bySeat.get(n);
      out.push(s ? { kind: "seat", seat: s } : { kind: "empty", number: n });
    }
    return out.slice(0, layout.opponentSlots.length);
  }, [seats, me, mySeat, maxPlayers]);

  const seatNode = (slot: Slot) =>
    slot.kind === "seat" ? (
      <div
        ref={(el) => registerSeatEl?.(slot.seat.userId, el)}
        data-sutda-seat={slot.seat.userId}
        className="pointer-events-none"
      >
        <Sutda2SeatHUD
          seat={slot.seat}
          isTurn={state?.turnSeat === slot.seat.seat}
          isDealer={dealerSeat != null && dealerSeat === slot.seat.seat}
          revealed={revealed}
          backSkin={backSkin}
          isWinner={!!state?.winners.includes(slot.seat.userId)}
          waiting={waiting}
          loadout={loadouts[slot.seat.userId] ?? null}
          layout={layout}
          hideOpponentCards={hideOpponentCards}
          openCard={openCards[slot.seat.userId] ?? null}
          {...(reactions[slot.seat.userId] ? { reaction: reactions[slot.seat.userId]! } : {})}
        />
      </div>
    ) : (
      <Sutda2EmptySeat
        seat={slot.number}
        layout={layout}
        {...(onSelectSeat ? { onSelect: onSelectSeat } : {})}
        disabled={!onSelectSeat || reservedSeats.has(slot.number)}
        {...(seatSelectReason ? { reason: seatSelectReason } : {})}
      />
    );

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full overflow-hidden rounded-3xl"
      {...(height ? { style: { height } } : {})}
    >
      <div
        className="absolute"
        style={{
          width: layout.stage.width,
          height: layout.stage.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          left: `calc(50% - ${(layout.stage.width * scale) / 2}px)`,
          // scaled stage 는 game viewport 안에서 정중앙 정렬한다
          top: `calc(50% - ${(layout.stage.height * scale) / 2}px)`,
        }}
      >
        {/* 배경 — 실제 섯다 테이블 에셋 */}
        <img
          src={SUTDA_UI.tableBg}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none rounded-3xl object-cover"
          style={{ zIndex: Z.background }}
        />

        {/* 좌상단 — 로고 */}
        <img
          src={SUTDA_UI.logo}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute select-none object-contain"
          style={{
            left: layout.topbar.logo.x,
            top: layout.topbar.logo.y,
            width: layout.topbar.logo.width,
            height: layout.topbar.logo.height,
            zIndex: Z.info,
          }}
        />

        {/* 방 정보 */}
        {roomInfo && (
          <div
            className="pointer-events-none absolute flex items-center gap-2 rounded-lg border border-gold/25 bg-black/55 px-2 py-1 text-[11px] leading-tight text-gold-soft"
            style={{
              left: layout.topbar.roomInfo.x,
              top: layout.topbar.roomInfo.y,
              height: layout.topbar.roomInfo.height,
              zIndex: Z.info,
            }}
          >
            <span className="font-display text-gold">
              {roomInfo.roomNumber !== null ? `#${roomInfo.roomNumber} · ` : ""}
              {roomInfo.gradeLabel}
            </span>
            <span>기본 {formatPoints(roomInfo.baseBet)}</span>
            <span>
              인원 {roomInfo.seatedCount}/{roomInfo.maxPlayers}
            </span>
          </div>
        )}

        {/* 우상단 컨트롤 — 항상 클릭 가능 */}
        {topControls && (
          <div
            data-sutda-top-controls
            className="pointer-events-auto absolute flex items-center gap-1.5"
            style={{
              right: layout.topbar.controls.right,
              top: layout.topbar.controls.top,
              height: layout.topbar.controls.height,
              zIndex: Z.topControls,
            }}
          >
            {topControls}
          </div>
        )}

        {/*
         * ROUND PROGRESS — 상태 안내 row 와 타이머 row 를 세로로 분리한다.
         * 컨테이너 하단은 POT 상단(layout.pot.y)에 정확히 맞춰 두어 POT 과 절대 겹치지 않는다.
         */}
        <div
          data-sutda-progress
          className="pointer-events-none absolute flex flex-col items-center justify-end gap-1.5"
          style={{
            left: layout.progress.x - 120,
            top: layout.pot.y - (layout.progress.height + 60),
            width: layout.progress.width + 240,
            height: layout.progress.height + 58,
            zIndex: Z.info,
          }}
        >
          {/* 1행 — 현재 단계 / 턴 안내 (타이머가 이 행의 폭을 침범하지 않는다) */}
          <div
            data-sutda-status-row
            className="flex w-full items-center justify-center gap-2"
            style={{ height: layout.progress.height }}
          >
            {phaseBadge && (
              <span className="shrink-0 rounded-full border border-gold/45 bg-black/70 px-3 py-1 font-display text-[14px] tracking-widest text-gold">
                {phaseBadge}
              </span>
            )}
            {turnNotice && (
              <span className="max-w-[420px] truncate rounded-full bg-black/55 px-3 py-1 text-[13px] text-gold-soft/90">
                {turnNotice}
              </span>
            )}
          </div>

          {/* 2행 — 타이머 전용 row */}
          {timerBadge && (
            <div data-sutda-timer-row className="flex w-full items-center justify-center">
              {timerBadge}
            </div>
          )}
        </div>

        {/* 중앙 POT — 하나의 wrapper (frame · 금액 · sub info 모두 wrapper 기준) */}
        <div
          className="pointer-events-none absolute"
          data-sutda-pot=""
          style={{
            left: layout.pot.x,
            top: layout.pot.y,
            width: layout.pot.width,
            height: layout.pot.height,
            zIndex: Z.pot,
          }}
        >
          <div ref={potAnchorRef} className="absolute left-1/2 top-1/2 h-0 w-0" />
          <img
            src={SUTDA_UI.potFrame}
            alt=""
            aria-hidden
            draggable={false}
            data-sutda-pot-frame=""
            className="absolute inset-0 h-full w-full select-none object-contain transition-[transform,filter] duration-300"
            style={
              bumped
                ? { transform: "scale(1.06)", filter: "drop-shadow(0 0 18px var(--gold))" }
                : { transform: "scale(1)" }
            }
          />
          {/* POT 금액 — frame 에 POT 라벨이 이미 인쇄되어 있어 금액만 얹는다 */}
          <div className="absolute inset-x-0 bottom-[12%] text-center">
            <p
              data-testid="pot-amount"
              className="font-display text-[30px] leading-tight text-gold drop-shadow-[0_0_14px_var(--gold)]"
            >
              {formatPoints(shownPot)}
            </p>
          </div>

          {/* SUB INFO — frame 하단 중앙 */}
          <div className="absolute inset-x-0 -bottom-[26px] flex flex-wrap items-center justify-center gap-1.5 text-[10px]">
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-gold-soft/85">
              내 투자{" "}
              <span data-testid="pot-my-total" className="font-display text-foreground">
                {myContribution == null ? "-" : formatPoints(myContribution)}
              </span>
            </span>
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-gold-soft/85">
              CALL{" "}
              <span data-testid="pot-call" className="font-display text-gold">
                {callAmount == null
                  ? "-"
                  : callAmount > 0
                    ? formatPoints(callAmount)
                    : "0 P · 체크 가능"}
              </span>
            </span>
            {state && (
              <span className="rounded-full bg-black/60 px-2 py-0.5 text-gold-soft/85">
                현재 베팅 {formatPoints(state.currentBet)} · 기본 {formatPoints(baseBet)}
              </span>
            )}
            {pots.length > 1 &&
              pots.map((p, i) => (
                <span
                  key={`${p.level}-${i}`}
                  className="rounded-full bg-black/60 px-2 py-0.5 text-gold-soft"
                >
                  {i === 0 ? "MAIN" : `SIDE ${i}`} {formatPoints(p.amount)} · {p.eligible.length}명
                </span>
              ))}
            {!potSumOk && (
              <span
                className="rounded-full bg-destructive/25 px-2 py-0.5 text-destructive"
                data-testid="pot-sum-mismatch"
              >
                POT 합계 불일치 · 서버 확인 중
              </span>
            )}
            {isRematchRound && (
              <span className="rounded-full bg-crimson/25 px-2 py-0.5 font-display tracking-widest text-gold">
                재경기{carryIn > 0 ? ` · 이월 ${formatPoints(carryIn)}` : ""}
              </span>
            )}
            {!cardIntegrityOk && (
              <span className="animate-pulse rounded-full bg-black/70 px-2 py-0.5 text-gold">
                카드 배분 중…
              </span>
            )}
          </div>
        </div>

        {/* 상대/빈 좌석 */}
        {slots.map((slot, i) => {
          const pos = layout.opponentSlots[i]!;
          return (
            <div
              key={slot.kind === "seat" ? `seat-${slot.seat.seat}` : `empty-${slot.number}`}
              className="absolute"
              data-sutda-slot={`slot-${i}`}
              style={{ left: pos.x, top: pos.y, zIndex: Z.seatShell }}
            >
              {seatNode(slot)}
            </div>
          );
        })}

        {/* 본인 좌석 — 하단 중앙 */}
        <div
          className="absolute"
          data-sutda-slot="self"
          {...(me ? { "data-sutda-seat": me.userId } : {})}
          style={{ left: layout.selfSlot.x, top: layout.selfSlot.y, zIndex: Z.seatShell }}
          ref={(el) => {
            if (me) registerSeatEl?.(me.userId, el);
          }}
        >
          {me ? (
            <Sutda2SeatHUD
              seat={me}
              isTurn={state?.turnSeat === me.seat}
              isDealer={dealerSeat != null && dealerSeat === me.seat}
              revealed={revealed}
              backSkin={backSkin}
              isWinner={!!state?.winners.includes(me.userId)}
              waiting={waiting}
              loadout={loadouts[me.userId] ?? null}
              layout={layout}
              selectable={selectable}
              selected={selectedCards}
              handPreview={handPreview}
              openCard={openCards[me.userId] ?? null}
              {...(onToggleCard ? { onToggleCard } : {})}
              {...(myCardVisuals ? { cardVisuals: myCardVisuals } : {})}
              {...(onMyCardRevealed ? { onRevealed: onMyCardRevealed } : {})}
            />
          ) : (
            <p className="pointer-events-none text-center text-[12px] text-muted-foreground">
              좌석을 배정하는 중입니다…
            </p>
          )}
        </div>

        {/* BOTTOM BAR — READY / 액션바 공용 슬롯 (STAGE 내부) */}
        {bottomBar && (
          <div
            data-sutda-bottom-bar
            className="pointer-events-auto absolute flex items-center justify-center"
            style={{
              left: layout.bottomBar.x,
              top: layout.bottomBar.y,
              width: layout.bottomBar.width,
              height: layout.bottomBar.height,
              zIndex: Z.bottomBar,
            }}
          >
            {bottomBar}
          </div>
        )}

        {/* 연출 레이어 — 클릭을 막지 않는다 */}
        <div
          ref={flightLayerRef}
          className="pointer-events-none absolute inset-0 overflow-visible"
          style={{ zIndex: Z.effects }}
        />
        {fx}
      </div>
    </div>
  );
}
