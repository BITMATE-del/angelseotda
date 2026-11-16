import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineState } from "@/lib/game/engine";
import type { RoomSeat, SidePot } from "@/lib/services/serverGameService";
import { cn } from "@/lib/utils";
import type { CardVisual } from "./HwatuCard";
import { MyHandArea } from "./MyHandArea";
import { EmptySeatSlot, PlayerSeatHUD, type TableSeat } from "./PlayerSeatHUD";
import { PotCenter } from "./PotCenter";
import { bundlesForBet } from "./CashStack";
import { flyCash } from "./cashFlight";
import type { RoomLoadouts } from "@/lib/game/roomLoadout";
import { SUTDA_UI } from "@/lib/game/sutdaAssets";
import { Sutda2Board, type Sutda2RoomInfo } from "./sutda2/Sutda2Board";
import { SUTDA2_LAYOUT, type SutdaCleanLayout } from "@/lib/game/sutda2CleanLayout";


interface Props {
  state: EngineState | null;
  roomSeats: RoomSeat[];
  mySeat: number | null;
  backSkin?: string;
  cardCounts?: Record<string, number>;
  cardIntegrityOk?: boolean;
  rematch?: boolean;
  pots?: SidePot[];
  isRematchRound?: boolean;
  carryIn?: number;
  myCardVisuals?: readonly CardVisual[];
  onMyCardRevealed?: (cardId?: string) => void;
  reactions?: Record<string, string>;
  /** 판 대기 상태 (READY 배지 표시) */
  waiting?: boolean;
  /** 서버 availableActions 기준 CALL 금액 */
  callAmount?: number | null;
  /** 이번 판 내 총 투자액 (서버 값) */
  myContribution?: number | null;
  /** 서버 POT 합계 검증 결과 */
  potSumOk?: boolean;
  /** SHOWDOWN 카드 공개 시점 (route 의 useShowdownReveal 결과) */
  revealed?: boolean;
  /** TABLE ZONE 고정 높이 (px, stage 좌표계) */
  height?: number;
  /** 좌석별 장착 아이템 연출 (카드 뒷면 · 프레임 · 닉네임 효과 · 테이블 스킨) */
  loadouts?: RoomLoadouts;
  /** 방 좌석 수 (좌석번호 1..maxPlayers 고정) */
  maxPlayers?: number;
  /** 이 판의 선(先) 좌석번호 — 서버 dealer_seat */
  dealerSeat?: number | null;
  /** 빈 좌석 클릭 착석 (WAITING 상태에서만 전달된다) */
  onSelectSeat?: (seat: number) => void;
  /** 착석/이동 불가 안내 */
  seatSelectReason?: string;
  /** 방 게임모드 카드 장수 (2장/3장) — 좌석 프레임 이미지 선택용 (UI 전용) */
  cardMode?: 2 | 3;
  /** 좌상단 로고 아래 방 정보 overlay (UI 전용) */
  roomInfo?: Sutda2RoomInfo;
  /** 2장 섯다 진행 단계 배지 (UI 전용) */
  phaseBadge?: string;
  /** 2장 섯다 턴 안내 문구 (UI 전용) */
  turnNotice?: string;
  /** 2장 섯다 코인/포인트 연출 레이어 (UI 전용) */
  fx?: React.ReactNode;
  /** 2장 섯다 우상단 컨트롤 (UI 전용) */
  topControls?: React.ReactNode;
  /** 2장 섯다 하단 READY/액션 공용 슬롯 (UI 전용) */
  bottomBar?: React.ReactNode;
  /** 2장 섯다 — 바깥 컨테이너 높이를 그대로 사용한다 (고정 height 미사용) */
  fill?: boolean;
  /**
   * CLEAN BOARD 좌표 bundle (UI 전용).
   * 지정하면 2장 섯다와 동일한 게임판을 해당 좌표로 렌더링한다 (3장 섯다 = 카드 영역만 확장).
   */
  cleanLayout?: SutdaCleanLayout;
  /** 3장 최종 승부패 선택 (내 좌석 카드 선택 · 확정은 서버) */
  selectable?: boolean;
  selectedCards?: readonly string[];
  onToggleCard?: (card: string) => void;
  /** 내 카드 아래 "현재 족보" 미리보기 (표시 전용) */
  handPreview?: string | null;
  /** 3장 섯다 공개패 (userId → 카드 · 서버가 공개를 허용한 값만) */
  openCards?: Record<string, string | null>;
  /** 서버 deadline 기준 타이머 배지 (표시 전용) */
  timerBadge?: React.ReactNode;
}


/** 테이블 슬롯 — 착석 좌석 또는 빈 좌석(EMPTY) */
type Slot = { kind: "seat"; seat: TableSeat } | { kind: "empty"; number: number };

/** TABLE ZONE 내부 고정 블록 높이 (stage 좌표계) */
const TOP_SEAT_H = 196;
/** 내 좌석 블록 — 콘텐츠(카드 lg 144px + 텍스트) 기준 최소 높이만 사용한다 */
const MY_SEAT_H = 220;
const ROW_GAP = 10;
/** 좌석번호·선(先) 배지가 HUD 상단 밖으로 나오는 만큼 확보하는 안전영역 (px) */
const SEAT_BADGE_PAD = 14;
/** 좌/우 좌석 전용 컬럼 폭 — HUD + 카드(최대 3장) 를 모두 담고 POT SAFE ZONE 과 겹치지 않는다 */
const SIDE_SEAT_W = 440;


/**
 * GameTableLayout — B. GAME TABLE ZONE 전용.
 *
 * 이 zone 안에는 좌석 · 카드 · 중앙 POT · 현금다발만 존재한다.
 * READY / 쪼기 / 최종 승부패 선택 / 결과 안내는 이 컴포넌트에 들어오지 않고
 * 상위 route 의 DECISION ZONE 블록에서 렌더링된다.
 *
 * 내부 구조 (모두 고정 높이 grid row — absolute 좌표/z-index 로 겹침을 해결하지 않는다):
 *
 *   row 1 : 상단 좌석 블록          (TOP_SEAT_H)
 *   row 2 : [좌 좌석] POT SAFE ZONE [우 좌석]   (남는 높이 전체)
 *   row 3 : 내 좌석 블록            (MY_SEAT_H)
 */
export function GameTableLayout({
  state,
  roomSeats,
  mySeat,
  backSkin = "classic-red",
  cardCounts = {},
  cardIntegrityOk = true,
  rematch = false,
  pots = [],
  isRematchRound = false,
  carryIn = 0,
  myCardVisuals,
  onMyCardRevealed,
  reactions = {},
  waiting = false,
  callAmount = null,
  myContribution = null,
  potSumOk = true,
  revealed = false,
  height = 540,
  loadouts = {},
  maxPlayers = 5,
  dealerSeat = null,
  onSelectSeat,
  seatSelectReason,
  cardMode = 2,
  roomInfo,
  phaseBadge,
  turnNotice,
  fx,
  topControls,
  bottomBar,
  fill = false,
  cleanLayout,
  selectable = false,
  selectedCards = [],
  onToggleCard,
  handPreview = null,
  openCards = {},
  timerBadge = null,


}: Props) {
  const flightLayer = useRef<HTMLDivElement | null>(null);
  const potAnchor = useRef<HTMLDivElement | null>(null);
  const seatEls = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const prevBets = useRef<Map<string, number>>(new Map());
  const paidRound = useRef<string | null>(null);
  const showdown = state?.phase === "showdown";
  /** CLEAN BOARD 사용 여부 — 2장 섯다는 항상, 3장 섯다는 cleanLayout 전달 시 */
  const cleanBoard = cardMode === 2 || !!cleanLayout;
  const cleanBoardLayout = cleanLayout ?? SUTDA2_LAYOUT;

  /**
   * 결과 공개 중에는 직전 라운드 참가자를 잠시 유지하지만, 무한정 유지하면
   * 최종 정산 후 AUTO KICK 된 유저가 화면에 남는다(ghost seat).
   * 라운드 결과 표시 후 RESULT_KEEP_MS 가 지나면 서버 좌석만 렌더링한다.
   */
  const RESULT_KEEP_MS = 8000;
  const [resultKeep, setResultKeep] = useState(false);
  useEffect(() => {
    if (!showdown) {
      setResultKeep(false);
      return;
    }
    setResultKeep(true);
    const t = setTimeout(() => setResultKeep(false), RESULT_KEEP_MS);
    return () => clearTimeout(t);
  }, [showdown, state?.roundId]);

  const seats: TableSeat[] = useMemo(() => {
    const merged = new Map<string, TableSeat>();
    for (const s of roomSeats.filter((r) => !r.isSpectator)) {
      merged.set(s.userId, {
        userId: s.userId,
        seat: s.seat,
        nickname: s.nickname,
        rank: s.rank,
        title: s.title?.name ?? null,
        characterUrl: s.character?.assetUrl ?? null,
        points: Number(s.points ?? 0),
        isMe: s.isMe,
        connection: s.connection,
        player: null,
        cardCount: 0,
        leavePending: !!s.leavePending,
        isReady: !!s.isReady,
        missedTurns: Number(s.missedTurns ?? 0),
      });
    }
    // 서버의 active game_room_players 가 좌석의 source of truth 다.
    // 퇴장/AUTO KICK 된 유저는 라운드 스냅샷에 남아 있어도 좌석에 그리지 않는다.
    // 단 결과 공개(showdown/정산) 중에는 직전 라운드 참가자를 잠시 유지한다.
    const keepUnseated = showdown && resultKeep;
    for (const p of state?.players ?? []) {
      const base = merged.get(p.userId);
      if (!base && !keepUnseated) continue;

      merged.set(p.userId, {
        userId: p.userId,
        seat: p.seat,
        nickname: p.nickname,
        rank: p.rank ?? base?.rank ?? null,
        title: p.title ?? base?.title ?? null,
        characterUrl: p.characterUrl ?? base?.characterUrl ?? null,
        points: p.points,
        isMe: base?.isMe ?? p.seat === mySeat,
        connection: p.connection ?? base?.connection ?? "CONNECTED",
        player: p,
        cardCount: cardCounts[p.userId] ?? p.cards.length,
        leavePending: base?.leavePending ?? false,
        isReady: base?.isReady ?? false,
        missedTurns: base?.missedTurns ?? 0,
      });
    }
    return [...merged.values()].sort((a, b) => a.seat - b.seat);
  }, [state, roomSeats, mySeat, cardCounts, showdown, resultKeep]);

  const me = seats.find((s) => s.isMe) ?? null;
  const others = seats.filter((s) => !s.isMe);

  /**
   * 좌석 슬롯 — 좌석번호 1..maxPlayers 가 항상 같은 자리에 고정된다.
   * 누가 나가도 남은 좌석번호는 당겨지지 않고, 나간 자리만 EMPTY 로 표시된다.
   */
  const slots = useMemo<Slot[]>(() => {
    const bySeat = new Map(others.map((s) => [s.seat, s]));
    const highest = Math.max(maxPlayers, ...others.map((s) => s.seat), me?.seat ?? 1);
    const out: Slot[] = [];
    for (let n = 1; n <= highest; n += 1) {
      if (me && me.seat === n) continue;
      const s = bySeat.get(n);
      out.push(s ? { kind: "seat", seat: s } : { kind: "empty", number: n });
    }
    return out;
  }, [others, me, maxPlayers]);

  /** 관전자가 점유한 좌석번호도 착석 대상이 아니다 (서버 unique(room_id, seat) 기준) */
  const reservedSeats = useMemo(
    () => new Set(roomSeats.map((s) => s.seat)),
    [roomSeats],
  );

  /** 좌석 분산: 좌 · 상단 · 우 (본인은 항상 테이블 최하단 블록) */
  const { left, top, right } = useMemo(() => {
    const l: Slot[] = [];
    const t: Slot[] = [];
    const r: Slot[] = [];
    slots.forEach((s, i) => {
      const n = slots.length;
      if (n <= 2) t.push(s);
      else if (n === 3) (i === 0 ? l : i === 1 ? t : r).push(s);
      else if (i === 0) l.push(s);
      else if (i === n - 1) r.push(s);
      else t.push(s);
    });
    return { left: l, top: t, right: r };
  }, [slots]);

  /** 베팅 성공(서버 total_bet 증가) → 좌석에서 POT으로 현금다발 이동 */
  useEffect(() => {
    if (!state) return;
    // 2장 섯다는 전용 코인 레이어(Sutda2CoinFx)가 담당한다 → 현금다발 연출 중복 금지
    if (cleanBoard) {
      for (const p of state.players) prevBets.current.set(p.userId, Number(p.totalBet ?? 0));
      return;
    }
    for (const p of state.players) {
      const before = prevBets.current.get(p.userId);
      const now = Number(p.totalBet ?? 0);
      if (before !== undefined && now > before) {
        flyCash({
          layer: flightLayer.current,
          from: seatEls.current.get(p.userId) ?? null,
          to: potAnchor.current,
          count: bundlesForBet(now - before, state.baseBet),
          glow: !!p.allIn,
          size: p.allIn ? 40 : 34,
        });
      }
      prevBets.current.set(p.userId, now);
    }
  }, [state]);

  /** 라운드 전환 시 베팅 기준값 초기화 (재경기 carry는 POT stack이 그대로 유지된다) */
  useEffect(() => {
    if (!state) return;
    if (paidRound.current !== state.roundId) prevBets.current = new Map();
  }, [state?.roundId]);

  /** 정산 성공 → POT에서 승자 좌석으로 현금다발 이동 (재경기에서는 이동하지 않는다) */
  useEffect(() => {
    if (!state || !revealed || rematch) return;
    if (cleanBoard) return; // CLEAN BOARD 는 Sutda2CoinFx 가 POT→승자 이동을 담당한다
    if (!state.winners.length || paidRound.current === state.roundId) return;
    paidRound.current = state.roundId;
    for (const userId of state.winners) {
      flyCash({
        layer: flightLayer.current,
        from: potAnchor.current,
        to: seatEls.current.get(userId) ?? null,
        count: bundlesForBet(state.pot / Math.max(1, state.winners.length), state.baseBet),
        size: 40,
        duration: 760,
        glow: true,
      });
    }
  }, [state, revealed, rematch]);

  const seatProps = (seat: TableSeat, side: "top" | "left" | "right" = "top") => ({
    seat,
    side,
    isTurn: state?.turnSeat === seat.seat,
    revealed: showdown && revealed,
    backSkin,
    isWinner: !!state?.winners.includes(seat.userId),
    waiting,
    ...(reactions[seat.userId] ? { reaction: reactions[seat.userId]! } : {}),
    loadout: loadouts[seat.userId] ?? null,
    isDealer: dealerSeat != null && dealerSeat === seat.seat,
    cardMode,
  });

  /**
   * 슬롯 렌더 — 착석 좌석은 HUD, 빈 좌석은 클릭 착석 가능한 EMPTY.
   * 좌석번호/선(先) 배지는 HUD 상단 밖으로 나오므로 슬롯마다 상단 안전영역(SEAT_BADGE_PAD)을 두고
   * 슬롯 자체는 clipping 하지 않는다 (배지 잘림 방지).
   */
  const renderSlot = (slot: Slot, side: "top" | "left" | "right") =>
    slot.kind === "seat" ? (
      <div
        key={`seat-${slot.seat.seat}`}
        style={{ paddingTop: SEAT_BADGE_PAD }}
        ref={(el) => {
          seatEls.current.set(slot.seat.userId, el);
        }}
      >
        <PlayerSeatHUD {...seatProps(slot.seat, side)} />
      </div>
    ) : (
      <div key={`empty-${slot.number}`} style={{ paddingTop: SEAT_BADGE_PAD }}>
        <EmptySeatSlot
          seat={slot.number}
          {...(onSelectSeat ? { onSelect: onSelectSeat } : {})}
          disabled={!onSelectSeat || reservedSeats.has(slot.number)}
          {...(seatSelectReason ? { reason: seatSelectReason } : {})}
        />
      </div>
    );

  /** 테이블 스킨은 내 장착 아이템만 적용한다 (좌석마다 배경이 바뀌지 않도록) */
  const tableBackground = me ? loadouts[me.userId]?.tableBackground ?? null : null;

  /**
   * 2장 섯다 — PHASE 1 고정 좌표 게임판 (실제 에셋 조립).
   * 3장 섯다는 기존 레이아웃을 그대로 사용한다.
   */
  if (cleanBoard) {
    return (
      <Sutda2Board
        layout={cleanBoardLayout}
        hideOpponentCards={cardMode === 2}
        selectable={selectable}
        selectedCards={selectedCards}
        handPreview={handPreview}
        {...(onToggleCard ? { onToggleCard } : {})}
        {...(fill ? {} : { height })}
        {...(topControls ? { topControls } : {})}
        {...(bottomBar ? { bottomBar } : {})}
        state={state}
        seats={seats}
        mySeat={mySeat}
        maxPlayers={maxPlayers}
        dealerSeat={dealerSeat}
        backSkin={backSkin}
        revealed={showdown && revealed}
        waiting={waiting}
        loadouts={loadouts}
        reactions={reactions}
        reservedSeats={reservedSeats}
        {...(onSelectSeat ? { onSelectSeat } : {})}
        {...(seatSelectReason ? { seatSelectReason } : {})}
        {...(myCardVisuals ? { myCardVisuals } : {})}
        {...(onMyCardRevealed ? { onMyCardRevealed } : {})}
        pot={state?.pot ?? 0}
        baseBet={state?.baseBet ?? 1000}
        pots={pots}
        isRematchRound={isRematchRound}
        carryIn={carryIn}
        cardIntegrityOk={cardIntegrityOk}
        callAmount={callAmount}
        myContribution={myContribution}
        potSumOk={potSumOk}
        potAnchorRef={potAnchor}
        flightLayerRef={flightLayer}
        registerSeatEl={(userId, el) => {
          seatEls.current.set(userId, el);
        }}
        {...(roomInfo ? { roomInfo } : {})}
        {...(phaseBadge ? { phaseBadge } : {})}
        {...(turnNotice ? { turnNotice } : {})}
        openCards={openCards}
        {...(timerBadge ? { timerBadge } : {})}
        {...(fx ? { fx } : {})}
      />
    );
  }



  return (
    <div className="table-rail relative w-full overflow-hidden rounded-3xl p-2" style={{ height }}>
      <div
        className={cn(
          "table-felt relative grid h-full w-full overflow-hidden rounded-3xl px-3 py-2 ring-1 ring-gold/20",
          tableBackground && "ring-2 ring-gold/45",
        )}
        style={{
          gridTemplateRows: `${TOP_SEAT_H}px minmax(0,1fr) ${MY_SEAT_H}px`,
          rowGap: ROW_GAP,
        }}
      >
        {/* 게임판 배경 — 실제 이미지 에셋 (딥그린 펠트 + 전통 프레임) */}
        <img
          src={SUTDA_UI.tableBg}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full select-none rounded-3xl object-cover"
          draggable={false}
        />
        {/* 좌상단 로고 — 순수 장식 레이어 */}
        <img
          src={SUTDA_UI.logo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-2 z-[2] h-10 w-auto select-none object-contain opacity-90"
          draggable={false}
        />
        {/* 테이블 스킨 — 펠트를 덮어 색감을 바꾸고, 중앙 비네트로 카드/POT 가독성을 유지한다 */}
        {tableBackground && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-3xl opacity-[0.68]"
              style={{ background: tableBackground }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-3xl"
              style={{
                background:
                  "radial-gradient(closest-side at 50% 50%, oklch(0 0 0/0.62), oklch(0 0 0/0.18) 70%, oklch(0 0 0/0.05))",
              }}
            />
          </>
        )}

        {/* row 1 — 상단 좌석 블록 */}
        <div className="relative z-[1] flex min-h-0 items-start justify-center gap-3 overflow-hidden">
          {top.map((s) => renderSlot(s, "top"))}
        </div>

        {/* row 2 — [좌 좌석] POT SAFE ZONE [우 좌석] */}
        <div
          className="relative z-[1] grid min-h-0 items-center gap-2 overflow-hidden"
          style={{ gridTemplateColumns: `${SIDE_SEAT_W}px minmax(0,1fr) ${SIDE_SEAT_W}px` }}
        >
          <div className="flex min-h-0 flex-col items-start gap-2 overflow-hidden">
            {left.map((s) => renderSlot(s, "left"))}
          </div>

          {/* POT SAFE ZONE — POT 금액 / MAIN·SIDE POT / 현금다발 / 보조 info band 전용 */}
          <div
            data-pot-safe-zone
            className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden"
          >
            <PotCenter
              pot={state?.pot ?? 0}
              baseBet={state?.baseBet ?? 1000}
              pots={pots}
              isRematchRound={isRematchRound}
              carryIn={carryIn}
              cardIntegrityOk={cardIntegrityOk}
              callAmount={callAmount}
              myContribution={myContribution}
              currentBet={state ? state.currentBet : null}
              potSumOk={potSumOk}
              potAnchorRef={potAnchor}
            />
          </div>


          <div className="flex min-h-0 flex-col items-end gap-2 overflow-hidden">
            {right.map((s) => renderSlot(s, "right"))}
          </div>
        </div>

        {/* row 3 — 내 좌석 블록 (카드가 커져도 이 블록 밖으로 나가지 않는다) */}
        <div
          data-my-seat-block
          className="relative z-[1] flex min-h-0 items-end justify-center overflow-hidden"
          ref={(el) => {
            if (me) seatEls.current.set(me.userId, el);
          }}
        >
          <MyHandArea
            cardMode={cardMode}
            seat={me}
            isTurn={!!me && state?.turnSeat === me.seat}
            revealed={showdown && revealed}
            backSkin={backSkin}
            {...(me && loadouts[me.userId] ? { loadout: loadouts[me.userId]! } : {})}
            {...(myCardVisuals ? { cardVisuals: myCardVisuals } : {})}
            {...(onMyCardRevealed ? { onRevealed: onMyCardRevealed } : {})}
          />
        </div>
      </div>

      {/* 현금다발 이동 연출 레이어 — 클릭을 막지 않는 순수 애니메이션 전용 */}
      <div ref={flightLayer} className="pointer-events-none absolute inset-0 overflow-visible" />
    </div>
  );
}
