import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { GameErrorBoundary } from "@/components/game/GameErrorBoundary";
import { DoriGameStage } from "@/components/game/dori/DoriGameStage";
import { DoriSeatHUD } from "@/components/game/dori/DoriSeatHUD";
import { DEFAULT_CHARACTER } from "@/components/game/PlayerSeatHUD";

import { DoriMakeSelector } from "@/components/game/dori/DoriMakeSelector";
import { DoriBettingControls } from "@/components/game/dori/DoriBettingControls";
import { DoriResultPanel } from "@/components/game/dori/DoriResultPanel";
import { DoriAssetButton } from "@/components/game/dori/DoriAssetButton";
import { DoriPotDisplay } from "@/components/game/dori/DoriPotDisplay";
import { DoriCoinFx } from "@/components/game/dori/DoriCoinFx";
import { DoriResultOverlay } from "@/components/game/dori/DoriResultOverlay";
import { useDoriRoundResult } from "@/components/game/dori/useDoriRoundResult";


import { DoriLogPanel } from "@/components/game/dori/DoriLogPanel";
import { useDoriSound } from "@/components/game/dori/useDoriSound";
import { useMyTurnAlert } from "@/components/game/useMyTurnAlert";
import { DORI_UI } from "@/components/game/dori/doriAssets";
import { DORI_HUD_EMPTY } from "@/components/game/dori/doriHudLayout";
import { doriCurrentHandLabel } from "@/lib/game/currentHandLabel";
import { DORI_Z } from "@/components/game/dori/doriLayers";
import { useFullscreen } from "@/components/game/GameStage";


import {
  getSoundVolume,
  isSoundEnabled,
  playActionLocal,
  playSoundPreview,
  preloadGameSounds,
  setSoundEnabled,
  setSoundVolume,
  unlockAudioPlayback,
} from "@/lib/services/gameSound";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { friendlyErrorMessage, logGameError } from "@/lib/services/opsService";
import { formatPoints } from "@/lib/services/walletService";
import {
  chooseDoriReveal,
  doriActionOptions,
  doriHeartbeat,
  doriTick,
  isDoriBettingPhase,
  fetchDoriRoomState,
  joinDoriSeat,
  leaveDoriRoom,
  placeDoriBet,
  setDoriReady,
  startDoriRound,
  submitDoriMake,
  type DoriActionOption,
  type DoriRoomState,
  type DoriSeatState,
} from "@/lib/services/doriService";
import { DORI_MAX_SEAT, DORI_MIN_PLAYERS } from "@/lib/game/dori/doriRules";
import { doriGradeName } from "@/lib/game/dori/doriRooms";

export const Route = createFileRoute("/dori_/game/$roomId")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "도리짓고땡 대국 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content:
          "4인 도리짓고땡 실시간 대국. 5장 중 3장을 10·20·30으로 짓고 남은 2장의 족보로 승부합니다.",
      },
      { property: "og:title", content: "도리짓고땡 대국 · 엔젤섯다" },
      { property: "og:description", content: "짓기와 남은 두 장으로 겨루는 4인 도리짓고땡." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DoriGameRoute,
});

const PHASE_LABEL: Record<string, string> = {
  DEALING: "카드 배분",
  BETTING_1: "1차 베팅 (3장)",
  BETTING_2: "2차 베팅 (4장)",
  MAKE_SELECTION: "짓기 (5장)",
  BETTING_FINAL: "최종 베팅",
  SHOWDOWN: "쇼다운",
  FINISHED: "정산 완료",
};

/** 내 좌석이 항상 하단이 되도록 좌석을 회전 배치한다 (하단 → 좌 → 상 → 우) */
function rotate(seats: DoriSeatState[], mySeat: number | null) {
  const base = mySeat ?? 1;
  const slots: (DoriSeatState | null)[] = [null, null, null, null];
  for (let i = 0; i < DORI_MAX_SEAT; i++) {
    const seatNo = ((base - 1 + i) % DORI_MAX_SEAT) + 1;
    slots[i] = seats.find((s) => s.seat === seatNo) ?? null;
  }
  return slots;
}

/**
 * 좌석 앵커는 1536×864 stage 고정 좌표계 기준이다 (해상도별 재배치 없이 stage scale 로만 대응).
 *   slot0 = 하단(본인) · slot1 = 좌측 · slot2 = 상단 · slot3 = 우측
 */
const SLOT_CLASS = [
  "absolute bottom-[40px] left-1/2 -translate-x-1/2",
  "absolute left-[62px] top-[375px] -translate-y-1/2",
  "absolute top-[38px] left-1/2 -translate-x-1/2",
  "absolute right-[62px] top-[375px] -translate-y-1/2",
];




function DoriGameRoute() {
  return (
    <GameErrorBoundary>
      <DoriGame />
    </GameErrorBoundary>
  );
}

function DoriGame() {
  const { roomId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [focusMode, setFocusMode] = useState(true);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const [volume, setVolume] = useState(() => getSoundVolume());
  /** 전체화면 대상 루트 — ESC/브라우저 종료도 fullscreenchange 로 동기화된다 */
  const gameRootRef = useRef<HTMLDivElement | null>(null);
  const fullscreen = useFullscreen(gameRootRef);


  const [realtimeOk, setRealtimeOk] = useState(false);

  const state = useQuery<DoriRoomState>({
    queryKey: ["dori-room-state", roomId],
    queryFn: () => fetchDoriRoomState(roomId),
    enabled: !!user,
    // Realtime 이 연결된 동안에는 변경이 이벤트로 즉시 도착하므로 polling 은 safety sync 로 낮춘다.
    refetchInterval: realtimeOk ? 4000 : 1500,
  });

  /**
   * Realtime 이벤트 폭주(한 액션에 room/players UPDATE 가 연달아 도착)를 1회 재조회로 합친다.
   * 마지막 이벤트도 반영되도록 짧은 지연 뒤 1회만 invalidate 한다.
   */
  const coalesceRef = useRef<number | null>(null);
  const coalesceInvalidate = useCallback(() => {
    if (coalesceRef.current !== null) return;
    coalesceRef.current = window.setTimeout(() => {
      coalesceRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ["dori-room-state", roomId] });
    }, 220);
  }, [queryClient, roomId]);
  useEffect(
    () => () => {
      if (coalesceRef.current !== null) window.clearTimeout(coalesceRef.current);
    },
    [],
  );

  /** 도리 게임방 입장 시 음원 preload + 첫 제스처에서 autoplay unlock */
  useEffect(() => {
    preloadGameSounds();
    const unlock = () => unlockAudioPlayback();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // 도리 전용 Realtime — 방/좌석 변경 시 상태를 즉시 다시 읽는다 (카드값은 절대 broadcast 하지 않음)
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`dori-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dori_rooms", filter: `id=eq.${roomId}` },
        () => coalesceInvalidate(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dori_room_players", filter: `room_id=eq.${roomId}` },
        () => coalesceInvalidate(),
      )
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        setRealtimeOk(ok);
        if (ok) void queryClient.invalidateQueries({ queryKey: ["dori-room-state", roomId] });
      });
    return () => {
      setRealtimeOk(false);
      void supabase.removeChannel(channel);
    };
  }, [roomId, queryClient, user, coalesceInvalidate]);

  useEffect(() => {
    if (!user) return;
    // 재접속·새로고침 직후 접속 상태가 최대 15초 늦게 반영되는 문제를 막기 위해 즉시 1회 전송한다.
    void doriHeartbeat(roomId).catch(() => undefined);
    void doriTick(roomId).catch(() => undefined);
    const timer = setInterval(() => {
      void doriHeartbeat(roomId);
      void doriTick(roomId).catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [roomId, user]);

  const data = state.data;
  const me = data?.seats.find((s) => s.isMe) ?? null;
  const round = data?.round ?? null;
  const phase = round?.phase ?? null;
  const showdown = phase === "SHOWDOWN" || phase === "FINISHED";
  const myTurn = !!round && round.turnUserId === user?.id;
  const seated = data?.seats.length ?? 0;
  const readyCount = data?.seats.filter((s) => s.isReady).length ?? 0;

  const options = useMemo<DoriActionOption[]>(
    () => (data && user ? doriActionOptions(data, user.id) : []),
    [data, user],
  );

  // 라운드 종료 결과 오버레이 (서버 확정 결과만 표시 · 진행에는 개입하지 않는다)
  const { view: resultView, refresh: refreshResult } = useDoriRoundResult(data, user?.id ?? null);
  const revealChoice = useMutation({
    mutationFn: (reveal: boolean) => chooseDoriReveal(resultView?.roundId ?? "", reveal),
    onSuccess: () => {
      void refreshResult();
      void refresh();
    },
    onError: (e) => fail("DORI_REVEAL_CHOICE", e),
  });
  const nextNotice =
    seated < DORI_MIN_PLAYERS
      ? "다른 참가자를 기다리는 중입니다."
      : resultView?.rematch
        ? "재경기를 준비합니다…"
        : "다음 판을 준비합니다…";

  useDoriSound(data, soundOn);

  /** 내 턴 음성 알림 (UX 전용 · 서버 turn state 기준) */
  const turnAlertKey =
    round && round.status === "PLAYING"
      ? `${round.roundId}:${phase}:${round.turnDeadline ?? ""}`
      : null;
  useMyTurnAlert({
    enabled: soundOn,
    active:
      myTurn &&
      isDoriBettingPhase(phase) &&
      !!me?.inRound &&
      !me?.folded &&
      options.some((o) => o.enabled),
    turnKey: turnAlertKey,
  });
  useMyTurnAlert({
    enabled: soundOn,
    active: phase === "MAKE_SELECTION" && !!me && !me.folded && me.makeStatus === "PENDING",
    turnKey: turnAlertKey,
    kind: "DORI_MAKE",
  });



  const refresh = () => queryClient.invalidateQueries({ queryKey: ["dori-room-state", roomId] });

  function fail(code: string, e: unknown) {
    toast.error(friendlyErrorMessage(e));
    void logGameError({ fn: code, error: e, roomId });
  }

  const sit = useMutation({
    mutationFn: (seat: number) => joinDoriSeat(roomId, seat, password || null),
    onSuccess: () => void refresh(),
    onError: (e) => fail("DORI_JOIN_SEAT", e),
  });
  const ready = useMutation({
    mutationFn: (v: boolean) => setDoriReady(roomId, v),
    onSuccess: () => void refresh(),
    onError: (e) => fail("DORI_SET_READY", e),
  });
  const start = useMutation({
    mutationFn: () => startDoriRound(roomId),
    onSuccess: () => void refresh(),
    onError: (e) => fail("DORI_START_ROUND", e),
  });
  const bet = useMutation({
    mutationFn: (o: DoriActionOption) =>
      placeDoriBet(roomId, o.action),
    onSuccess: () => void refresh(),
    onError: (e) => fail("DORI_PLACE_BET", e),
  });
  const make = useMutation({
    mutationFn: () => submitDoriMake(roomId, selected),
    onSuccess: () => {
      setSelected([]);
      void refresh();
    },
    onError: (e) => fail("DORI_SUBMIT_MAKE", e),
  });
  const leave = useMutation({
    mutationFn: () => leaveDoriRoom(roomId),
    onSuccess: (result) => {
      if (result === "LEAVE_PENDING") toast.info("현재 판이 끝나면 자리에서 나갑니다.");
      else void navigate({ to: "/dori" });
      void refresh();
    },
    onError: (e) => fail("DORI_LEAVE", e),
  });

  // 라운드 종료 후 자동 다음 판 (준비 재입력 없이 진행)
  useEffect(() => {
    if (!data || !me) return;
    if (round && round.status === "PLAYING") return;
    if (data.room.readyRequired) return;
    if (seated < DORI_MIN_PLAYERS) return;
    const timer = setTimeout(() => start.mutate(), 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.round?.roundId, data?.round?.status, seated, me?.seat]);

  useEffect(() => {
    setSelected([]);
  }, [round?.roundId, phase]);

  if (!user) {
    return (
      <AppShell>
        <section className="panel-surface rounded-2xl p-6 text-sm text-foreground/75">
          로그인 후 입장할 수 있습니다.
        </section>
      </AppShell>
    );
  }

  const slots = rotate(data?.seats ?? [], me?.seat ?? null);
  const hwang = !!data && data.makeOptions.length === 0 && (data.myCards.length ?? 0) === 5;
  /** "현재 최고패" — 내 카드 기준 표시 전용. 서버 정산/승패/짓기 확정과 무관하다. */
  const myHandPreview = me
    ? doriCurrentHandLabel(data?.myCards ?? [], me.selectedCards ?? null, me.remainingCards ?? null)
    : null;

  return (
    <AppShell chrome={!focusMode}>
      {/* [게임 화면] | [채팅/로그] — 가로 2열 (세로로 쌓지 않는다) */}
      <div
        ref={gameRootRef}
        className="grid h-[calc(100dvh-24px)] min-w-0 items-stretch gap-3 overflow-hidden bg-background"
        style={{ gridTemplateColumns: "minmax(0,1fr) clamp(272px, 20vw, 392px)" }}
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col justify-center gap-2">

          <DoriGameStage bottomGap={16}>

            <div className="relative h-full w-full overflow-hidden rounded-3xl">
              {/* 그래픽 레이어 — 실제 게임판 배경 에셋 */}
              <img
                src={DORI_UI.tableBg}
                alt=""
                aria-hidden
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
              />

              {/* 좌상단 로고 + 방 정보 */}
              <img
                src={DORI_UI.logo}
                alt=""
                aria-hidden
                draggable={false}
                className="pointer-events-none absolute left-[30px] top-[18px] w-[230px] select-none"
              />
              <div className="pointer-events-none absolute left-[30px] top-[116px] rounded-lg bg-black/45 px-3 py-1.5 text-[12px] leading-relaxed">
                <p className="font-display text-gold">
                  #{data?.room.roomNumber ?? "-"} {data?.room.title ?? "도리짓고땡"}
                </p>
                <p className="text-foreground/70">
                  {doriGradeName(data?.room.roomType)} · 기본 {formatPoints(data?.room.ante ?? 0)} ·{" "}
                  {seated}/{DORI_MAX_SEAT}명
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {phase && (
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">
                      {PHASE_LABEL[phase] ?? phase}
                    </span>
                  )}
                  {round && round.currentBet > 0 && (
                    <span className="text-[11px] text-gold-soft">
                      최고 베팅 {formatPoints(round.currentBet)}
                    </span>
                  )}
                </div>
              </div>

              {/* 우상단 — 설정(사운드/게임모드) / 전체화면 / 방이동 / 나가기.
                  항상 최상단 + pointer-events-auto (다른 레이어가 절대 덮지 않는다) */}
              <div
                data-dori-top-controls
                style={{ zIndex: DORI_Z.TOP_CONTROLS }}
                className="pointer-events-auto absolute right-[26px] top-[20px] flex items-center gap-2"
              >

                <button
                  type="button"
                  aria-label={soundOn ? "사운드 끄기" : "사운드 켜기"}
                  onClick={() => {
                    const next = !soundOn;
                    setSoundOn(next);
                    setSoundEnabled(next);
                    if (next) playSoundPreview();
                  }}
                  className="min-h-[32px] rounded-lg border border-gold/35 bg-black/55 px-2.5 py-1 font-display text-[12px] text-gold hover:bg-black/75"
                >
                  {soundOn ? "🔊 사운드" : "🔇 음소거"}
                </button>
                {soundOn && (
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(volume * 100)}
                    aria-label="사운드 볼륨"
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      setVolume(v);
                      setSoundVolume(v);
                    }}
                    className="h-1 w-[76px] accent-[var(--gold)]"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setFocusMode((v) => !v)}
                  className="min-h-[32px] rounded-lg border border-gold/35 bg-black/55 px-2.5 py-1 font-display text-[12px] text-gold hover:bg-black/75"
                >
                  ⚙ {focusMode ? "게임모드" : "일반모드"}
                </button>
                <button
                  type="button"
                  aria-label={fullscreen.active ? "전체화면 종료" : "전체화면"}
                  aria-pressed={fullscreen.active}
                  onClick={fullscreen.toggle}
                  className="min-h-[32px] rounded-lg border border-gold/35 bg-black/55 px-2.5 py-1 font-display text-[12px] text-gold hover:bg-black/75"
                >
                  {fullscreen.active ? "⤡ 창모드" : "⛶ 전체화면"}
                </button>

                <button
                  type="button"
                  onClick={() => void navigate({ to: "/dori" })}
                  className="min-h-[32px] rounded-lg border border-gold/35 bg-black/55 px-2.5 py-1 font-display text-[12px] text-gold hover:bg-black/75"

                >
                  ↩ 방이동
                </button>
                <DoriAssetButton
                  tone="red"
                  className="h-[32px] min-w-[86px]"
                  onClick={() => leave.mutate()}
                >
                  ✕ 나가기
                </DoriAssetButton>
              </div>

              {/* 좌석/POT 좌표계 — stage 전체(1536×864) 기준, 시각 요소 없음.
                  이 레이어 자체는 클릭을 가로채지 않는다 (상단 컨트롤 hit-test 보호). */}
              <div className="pointer-events-none absolute inset-0" style={{ zIndex: DORI_Z.SEATS }}>

                {/* 현재 진행 단계 배지 — POT 위쪽 */}
                <div className="pointer-events-none absolute left-1/2 top-[228px] -translate-x-1/2">
                  <span className="rounded-full border border-gold/50 bg-black/70 px-3.5 py-1 font-display text-[13px] tracking-wide text-gold shadow-[0_0_16px_-6px_var(--gold)]">
                    {phase ? (PHASE_LABEL[phase] ?? phase) : "대기중"}
                  </span>
                </div>

                {/* POT (게임판 중심) */}
                <div
                  data-dori-pot
                  className="absolute left-1/2 top-[375px] flex h-[220px] w-[470px] -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                >

                  <DoriPotDisplay
                    pot={round?.pot ?? data?.room.carryPot ?? 0}
                    currentBet={round?.currentBet ?? 0}
                  />
                </div>


                {slots.map((seat, i) => {
                  const seatNo = (((me?.seat ?? 1) - 1 + i) % DORI_MAX_SEAT) + 1;
                  return (
                    <div
                      key={i}
                      className={`${SLOT_CLASS[i]} pointer-events-none`}
                      data-dori-seat={seat?.seat ?? seatNo}
                    >


                      {seat ? (
                        <DoriSeatHUD
                          seat={seat}
                          isTurn={!!round && round.turnUserId === seat.userId}
                          isDealer={!!round && round.dealerSeat === seat.seat}
                          showdown={showdown}
                          myCards={seat.isMe ? (data?.myCards ?? []) : null}
                          handPreview={seat.isMe ? myHandPreview : null}
                        />
                      ) : (
                        <div
                          className="relative"
                          style={{
                            width: DORI_HUD_EMPTY.width,
                            height: DORI_HUD_EMPTY.height,
                          }}
                        >
                          <img
                            src={DORI_UI.seatEmpty}
                            alt=""
                            aria-hidden
                            draggable={false}
                            className="pointer-events-none absolute inset-0 h-full w-full select-none"
                          />
                          {/* 좌석 번호 — 좌상단 배지 1개 */}
                          <span
                            className="pointer-events-none absolute flex items-center justify-center rounded-full border border-gold/40 bg-black/70 font-display text-[14px] text-gold/80"
                            style={{
                              left: DORI_HUD_EMPTY.seatBadge.x,
                              top: DORI_HUD_EMPTY.seatBadge.y,
                              width: DORI_HUD_EMPTY.seatBadge.width,
                              height: DORI_HUD_EMPTY.seatBadge.height,
                            }}
                          >
                            {seatNo}
                          </span>
                          {/* 실루엣 — 프로필 뷰포트 1개 */}
                          <div
                            className="pointer-events-none absolute overflow-hidden rounded-[9px] bg-black/40"
                            style={{
                              left: DORI_HUD_EMPTY.avatar.x,
                              top: DORI_HUD_EMPTY.avatar.y,
                              width: DORI_HUD_EMPTY.avatar.width,
                              height: DORI_HUD_EMPTY.avatar.height,
                            }}
                          >
                            <img
                              src={DEFAULT_CHARACTER}
                              alt=""
                              aria-hidden
                              draggable={false}
                              className="h-full w-full select-none object-cover opacity-35"
                              style={{ objectPosition: "center top" }}
                            />
                          </div>
                          <div
                            className="pointer-events-auto absolute flex flex-col items-center gap-2"

                            style={{
                              left: DORI_HUD_EMPTY.info.x,
                              top: DORI_HUD_EMPTY.info.y,
                            }}
                          >
                            <p className="text-[13px] text-foreground/70">대기중</p>
                            <DoriAssetButton
                              disabled={!!me || sit.isPending}
                              onClick={() => sit.mutate(seatNo)}
                            >
                              착석
                            </DoriAssetButton>
                          </div>
                        </div>

                      )}
                    </div>
                  );
                })}

                {/* 코인 이동 연출 (visual only) */}
                <DoriCoinFx data={data} />

                {/* 라운드 종료 결과 오버레이 (게임판 위에만 표시 — 채팅은 가리지 않는다) */}
                {resultView && (
                  <DoriResultOverlay
                    view={resultView}
                    nextNotice={nextNotice}
                    onReveal={(v) => revealChoice.mutate(v)}
                    revealBusy={revealChoice.isPending}
                  />
                )}
              </div>




              {/* 짓기 단계 전용 카드 선택 (그 외 단계의 내 패는 좌석 HUD 안에 통합) */}
              {phase === "MAKE_SELECTION" && me && !me.folded && me.makeStatus === "PENDING" && (
                <div
                  style={{ zIndex: DORI_Z.ACTION_BAR }}
                  className="pointer-events-auto absolute bottom-[18px] left-1/2 -translate-x-1/2 rounded-2xl border border-gold/35 bg-black/70 px-4 py-2 shadow-[0_-6px_20px_-10px_var(--gold)]"
                >

                  <DoriMakeSelector
                    cards={data?.myCards ?? []}
                    selected={selected}
                    hwang={hwang}
                    submitting={make.isPending}
                    onToggle={(card) =>
                      setSelected((prev) =>
                        prev.includes(card)
                          ? prev.filter((c) => c !== card)
                          : prev.length >= 3
                            ? prev
                            : [...prev, card],
                      )
                    }
                    onSubmit={() => make.mutate()}
                  />
                </div>
              )}
              {/* 액션바 — stage 내부 우측 하단 safe area (게임판 아래 빈 영역 없음) */}
              <div
                style={{ zIndex: DORI_Z.ACTION_BAR }}
                className="pointer-events-auto absolute bottom-[24px] right-[26px] flex w-[390px] flex-col items-end gap-2"
              >

                {!me && data?.room.isPrivate && (
                  <div className="flex w-full items-center gap-2 rounded-xl border border-gold/25 bg-black/60 px-3 py-2">
                    <span className="shrink-0 text-[12px] text-foreground/70">방 비밀번호</span>
                    <Input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-8 min-w-0 flex-1 border-gold/25 bg-black/60 text-[13px]"
                    />
                  </div>
                )}

                {round && isDoriBettingPhase(phase) && me?.inRound && (
                  <DoriBettingControls
                    options={options}
                    myTurn={myTurn}
                    busy={bet.isPending}
                    onAction={(o) => {
                      // 활성 버튼 정상 클릭 → 즉시 재생 후 서버 RPC
                      playActionLocal(o.action);
                      bet.mutate(o);
                    }}
                  />
                )}
              </div>

              {/* 준비/시작 안내 · 결과 — stage 내부 좌측 하단 safe area */}
              <div
                style={{ zIndex: DORI_Z.ACTION_BAR }}
                className="pointer-events-auto absolute bottom-[24px] left-[26px] flex w-[380px] flex-col gap-2"
              >

                {me && (!round || round.status !== "PLAYING") && (
                  <div className="rounded-2xl border border-gold/30 bg-black/65 px-3 py-2">
                    <p className="font-display text-[13px] text-gold">
                      준비 {readyCount}/{seated}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-snug text-foreground/80">
                      {seated < DORI_MIN_PLAYERS
                        ? `상대 플레이어를 기다리는 중입니다. (최소 ${DORI_MIN_PLAYERS}명)`
                        : data?.room.readyRequired
                          ? "모두 준비하면 판이 시작됩니다."
                          : "다음 판이 곧 자동으로 시작됩니다."}
                    </p>
                    {data?.room.readyRequired && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <DoriAssetButton
                          tone={me.isReady ? "red" : "gold"}
                          onClick={() => ready.mutate(!me.isReady)}
                        >
                          {me.isReady ? "준비 취소" : "준비 READY"}
                        </DoriAssetButton>
                        <DoriAssetButton
                          disabled={
                            seated < DORI_MIN_PLAYERS || readyCount < seated || start.isPending
                          }
                          onClick={() => start.mutate()}
                        >
                          판 시작
                        </DoriAssetButton>
                      </div>
                    )}
                  </div>
                )}

                {round && showdown && <DoriResultPanel round={round} seats={data?.seats ?? []} />}
              </div>
            </div>
          </DoriGameStage>

        </div>

        {/* 오른쪽 세로 채팅/로그 패널 — 게임판 높이와 동일 */}
        {user && (
          <DoriLogPanel
            roomId={roomId}
            userId={user.id}
            nickname={me?.nickname ?? "플레이어"}
            data={data}
            className="h-full"
          />
        )}
      </div>
    </AppShell>
  );
}

