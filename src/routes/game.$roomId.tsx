import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { GameActionBar } from "@/components/game/GameActionBar";
import { GameErrorBoundary } from "@/components/game/GameErrorBoundary";
import { GameStatusBar } from "@/components/game/GameStatusBar";
import { GameTableLayout } from "@/components/game/GameTableLayout";
import {
  HAND_LABEL_PENDING,
  sutda2CurrentHandLabel,
  sutda3CurrentHandLabel,
} from "@/lib/game/currentHandLabel";

import { SUTDA3_LAYOUT } from "@/lib/game/sutda3CleanLayout";
import { DecisionZone } from "@/components/game/DecisionZone";
import { RoundResultPanel } from "@/components/game/RoundResultPanel";
import { useShowdownReveal } from "@/components/game/useShowdownReveal";
import { useMyTurnAlert } from "@/components/game/useMyTurnAlert";
import { GamePanel } from "@/components/game/GamePanel";
import { Sutda2SidePanel } from "@/components/game/sutda2/Sutda2SidePanel";
import { Sutda2CoinFx } from "@/components/game/sutda2/Sutda2CoinFx";
import { Sutda2ResultOverlay } from "@/components/game/sutda2/Sutda2ResultOverlay";
import { useSutda2RoundResult } from "@/components/game/sutda2/useSutda2RoundResult";
import { sutda2ResultLogLines } from "@/lib/game/sutda2Result";
import { ReadyBar } from "@/components/game/ReadyBar";
import { HandSelection } from "@/components/game/HandSelection";
import { CardRow, HwatuCard, type CardVisual } from "@/components/game/HwatuCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useRoomReactions } from "@/hooks/useRoomReactions";
import {
  AUTO_WIN_REACTION_CODE,
  isAutoWinReactionOn,
  setAutoWinReaction as persistAutoWinReaction,
} from "@/lib/game/emoticons";
import { supabase } from "@/integrations/supabase/client";
import { markDisconnected, selectSeat, sendHeartbeat } from "@/lib/services/gameService";
import { friendlyErrorMessage, logGameError } from "@/lib/services/opsService";
import {
  advanceRoundState,
  enforceRoomMinBalance,

  enforceTurnTimeout,
  fetchCurrentRoundId,
  fetchMyCardSlots,
  fetchRoomTableState,
  fetchRoundState,
  fetchRoundSnapshot,
  type ServerRoundState,
  cancelLeaveRoom,
  confirmCardSqueeze,
  requestLeaveRoom,
  sendBetAction,
  sendFinalHand,
  selectOpenCard,
  setFoldWinReveal,
  resolveFoldWinReveal,
  serverActionOptions,
  setRoomReady,
  sidePots,
  startServerRound,
  toEngineState,
} from "@/lib/services/serverGameService";
import { SutdaRevealChoiceModal } from "@/components/game/sutda2/SutdaRevealChoiceModal";

import { GAME_RULES } from "@/lib/game/rankConfig";
import { GAME_MODE_LABEL, type BetAction, type GameMode } from "@/lib/game/types";
import { formatPoints } from "@/lib/services/walletService";
import {
  getSfxVolume,
  getSoundVolume,
  getVoiceVolume,
  isSoundEnabled,
  playAction,
  playActionLocal,
  preloadGameSounds,
  unlockAudioPlayback,
  playEvent,
  playHand,
  playSoundPreview,
  setSfxVolume,
  setSoundEnabled,
  setSoundVolume,
  setVoiceVolume,
} from "@/lib/services/gameSound";
import { GameStage, STAGE_HEIGHT, useFullscreen } from "@/components/game/GameStage";
import { FullscreenPortal } from "@/components/game/FullscreenPortal";
import { ServerCountdownPanel } from "@/components/game/ServerCountdown";
import { fetchRoomLoadouts } from "@/lib/game/roomLoadout";
import { GAME_ROOM_COLUMNS } from "@/lib/rooms/roomColumns";

export const Route = createFileRoute("/game/$roomId")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
      { title: "게임 테이블 · 엔젤섯다 ANGEL SUTDA" },
      {
        name: "description",
        content: "실시간 섯다 테이블. 삥·따당·하프·다이로 베팅하고 족보로 승부를 가리세요.",
      },
      { property: "og:title", content: "게임 테이블 · 엔젤섯다" },
      { property: "og:description", content: "실시간 섯다 한 판, 지금 시작하세요." },
    ],
  }),
  errorComponent: () => (
    <AppShell>
      <p className="panel-surface rounded-2xl p-8 text-center text-sm">
        방 정보를 불러오지 못했습니다.{" "}
        <Link to="/rooms" className="text-gold underline">
          게임방 목록
        </Link>
      </p>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <p className="panel-surface rounded-2xl p-8 text-center text-sm">존재하지 않는 방입니다.</p>
    </AppShell>
  ),
  component: GameRoomBoundary,
});

function GameRoomBoundary() {
  const { roomId } = Route.useParams();
  const queryClient = useQueryClient();
  return (
    <GameErrorBoundary
      roomId={roomId}
      onRecover={() => {
        void queryClient.invalidateQueries({ queryKey: ["current-round", roomId] });
        void queryClient.invalidateQueries({ queryKey: ["round-state"] });
      }}
    >
      <GameRoom />
    </GameErrorBoundary>
  );
}

function GameRoom() {
  const { roomId } = Route.useParams();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [nextRoundIn, setNextRoundIn] = useState<number | null>(null);
  /** 쪼아서 공개한 카드 코드 — 좌석/선택창에서 다시 뒷면으로 돌아가지 않는다 */
  const [revealedCards, setRevealedCards] = useState<string[]>([]);
  const [revealRound, setRevealRound] = useState<string | null>(null);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [sfxVol, setSfxVol] = useState(1);
  const [voiceVol, setVoiceVol] = useState(1);
  const [showMixer, setShowMixer] = useState(false);
  /** 우측 compact sidebar 접기/펼치기 (메인 테이블 폭 확보) */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** 게임모드(집중모드) — 사이트 글로벌 헤더/네비/여백/푸터를 숨기고 보드를 확대한다 */
  const [gameMode, setGameMode] = useState(false);
  const [autoWinReaction, setAutoWinReaction] = useState(false);
  const autoReactionRef = useRef<string | null>(null);
  /** 전체화면 대상 — Stage 는 재배치되지 않고 같은 비율로 확대된다 */
  const screenRef = useRef<HTMLDivElement | null>(null);
  const fullscreen = useFullscreen(screenRef);

  useEffect(() => {
    setSoundOn(isSoundEnabled());
    setVolume(getSoundVolume());
    setSfxVol(getSfxVolume());
    setVoiceVol(getVoiceVolume());
    setAutoWinReaction(isAutoWinReactionOn());
  }, []);

  /** 게임방 입장 시 음원 preload + 첫 제스처에서 autoplay unlock (재생 지연 제거) */
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

  /** 좌석 위 일시적 리액션 — DB 저장 없이 Realtime broadcast 로만 전달된다 */
  const { reactions, send: broadcastReaction } = useRoomReactions(roomId);

  /** 쪼아서 공개한 카드 기록 (라운드가 바뀌면 초기화) */
  const markRevealed = useCallback((cardId?: string) => {
    if (!cardId) return;
    setRevealedCards((prev) => (prev.includes(cardId) ? prev : [...prev, cardId]));
  }, []);

  const fireReaction = useCallback(
    (code: string) => {
      if (!user) return;
      // 저장 없는 UI 리액션 (쿨다운은 hook 내부에서 처리)
      broadcastReaction(user.id, code);
    },
    [broadcastReaction, user],
  );

  const toggleAutoWinReaction = useCallback((on: boolean) => {
    setAutoWinReaction(on);
    persistAutoWinReaction(on);
  }, []);


  const [realtimeOk, setRealtimeOk] = useState(true);
  const settledRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  /** 서버가 좌석을 정리(오링/최소 입장 미달)했는지 — 재입장 시도 방지 */
  const kickedRef = useRef(false);
  const wasSeatedRef = useRef(false);
  /** 내가 직접 나가기(예약)를 요청했는지 — 퇴장 사유 판단 근거 */
  const leaveRequestedRef = useRef(false);
  /** 마지막으로 관측된 내 좌석 상태 (퇴장 사유 판단용) */
  const lastSeatRef = useRef<{
    leavePending: boolean;
    missedTurns: number;
    connection: string;
  } | null>(null);

  /**
   * Realtime 이벤트 폭주(한 액션에 pot/turn/phase UPDATE 가 연달아 도착)를 하나의 재조회로 합친다.
   * 마지막 이벤트도 반드시 반영되도록 짧은 지연(기본 220ms) 뒤 1회만 invalidate 한다.
   */
  const coalesceTimersRef = useRef<Map<string, number>>(new Map());
  const coalesceLastRef = useRef<Map<string, number>>(new Map());
  const coalesceInvalidate = useCallback(
    (key: (string | null)[], gapMs = 220) => {
      const id = key.join("|");
      const timers = coalesceTimersRef.current;
      if (timers.has(id)) return;
      const last = coalesceLastRef.current.get(id) ?? 0;
      const wait = Math.max(0, gapMs - (Date.now() - last));
      const t = window.setTimeout(() => {
        timers.delete(id);
        coalesceLastRef.current.set(id, Date.now());
        void queryClient.invalidateQueries({ queryKey: key.filter((k) => k !== null) });
      }, wait);
      timers.set(id, t);
    },
    [queryClient],
  );
  useEffect(
    () => () => {
      for (const t of coalesceTimersRef.current.values()) window.clearTimeout(t);
      coalesceTimersRef.current.clear();
    },
    [],
  );

  const room = useQuery({
    queryKey: ["room", roomId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_rooms")
        .select(GAME_ROOM_COLUMNS)
        .eq("id", roomId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // 방 좌석 전체 (본인 필터링 없음 — ACTIVE/OCCUPIED 플레이어 전원 렌더링)
  const table = useQuery({
    queryKey: ["room-players", roomId],
    queryFn: () => fetchRoomTableState(roomId),
    enabled: !!user,
    // 좌석 변경은 Realtime 으로 즉시 도착한다. polling 은 safety sync.
    refetchInterval: realtimeOk ? 5000 : 2000,
  });

  /** 좌석별 장착 아이템(코스메틱) — 게임 진행/정산과 무관한 연출 데이터 */
  const loadouts = useQuery({
    queryKey: ["room-loadouts", roomId],
    queryFn: () => fetchRoomLoadouts(roomId),
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const roomSeats = table.data?.seats ?? [];
  /**
   * 서버가 이미 종료/삭제한 방 — 좌석을 다시 잡지 않고 로비로 복귀시킨다.
   * (빈 방 정리와 좌석 배정이 겹칠 때 "좌석을 배정하는 중" 상태로 갇히던 문제)
   */
  const roomGone =
    !room.isLoading &&
    !room.isError &&
    (!room.data ||
      !!room.data.deleted_at ||
      room.data.status === "closed" ||
      room.data.status === "deleted");
  const isHost = !!user && room.data?.host_id === user.id;

  const mySeat = roomSeats.find((s) => s.isMe)?.seat ?? null;
  const seatedCount = roomSeats.filter((s) => !s.isSpectator).length;
  const myLeavePending = roomSeats.find((s) => s.isMe)?.leavePending ?? false;
  const roomNumber = table.data?.roomNumber ?? null;
  const readyRequired = table.data?.readyRequired ?? true;
  const readyCount = roomSeats.filter((s) => !s.isSpectator && s.isReady).length;
  const iAmReady = roomSeats.find((s) => s.isMe)?.isReady ?? false;
  const allReady = seatedCount >= 2 && readyCount === seatedCount;

  /** 좌석번호 1..maxPlayers (서버 고정) · 이 판의 선(先) 좌석 */
  const maxPlayers = table.data?.maxPlayers ?? 5;
  const activeRound = !!table.data?.activeRound;
  /**
   * 빈 좌석 착석은 진행 중인 판이 없을 때(WAITING)만 허용한다.
   * 최종 판정은 서버 select_seat 이 담당하고, 여기서는 UI 안내만 맞춘다.
   */
  const canSelectSeat = !activeRound && !myLeavePending;
  const onSelectSeat = async (seat: number) => {
    try {
      await selectSeat(roomId, seat);
      await queryClient.invalidateQueries({ queryKey: ["room-players", roomId] });
      await queryClient.invalidateQueries({ queryKey: ["room-loadouts", roomId] });
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "좌석을 배정할 수 없습니다."));
    }
  };


  // 좌석 확보 — 최소 입장 포인트 검증과 좌석 배정은 서버(join_room RPC)에서 처리
  const joinFailedRef = useRef(false);
  useEffect(() => {
    if (!user || !room.data || table.isLoading) return;
    // 이미 종료/삭제된 방에는 좌석을 다시 잡지 않는다.
    if (roomGone) return;
    // 서버가 잔액 부족으로 좌석을 정리한 뒤에는 다시 앉히지 않는다.
    if (kickedRef.current) return;
    // 내가 직접 나가기를 요청한 뒤에는 좌석을 다시 잡지 않는다.
    // (나가기 직후 room-players 갱신으로 이 effect가 다시 실행되어 좌석이 되살아나던 문제)
    if (leaveRequestedRef.current) return;
    // 서버가 착석을 거절한 뒤에는 2초 폴링마다 재시도하지 않는다.
    if (joinFailedRef.current) return;
    if (roomSeats.some((s) => s.userId === user.id)) return;

    void supabase.rpc("join_room", { _room_id: roomId, _spectator: false }).then(({ error }) => {
      if (error) {
        joinFailedRef.current = true;
        toast.error(friendlyErrorMessage(error, "입장할 수 없습니다."));
        void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["room-players", roomId] });
    });
  }, [user, room.data, roomGone, roomSeats, table.isLoading, roomId, queryClient]);



  // 접속 유지 신호 · 이탈 시 재접속 유예 (서버가 유예 초과 시 자동 다이)
  useEffect(() => {
    if (!user) return;
    void sendHeartbeat(roomId);
    const timer = setInterval(
      () => void sendHeartbeat(roomId),
      GAME_RULES.reconnect.heartbeatSeconds * 1000,
    );
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        void markDisconnected(roomId, GAME_RULES.reconnect.graceSeconds);
      } else {
        void sendHeartbeat(roomId);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [roomId, user]);

  /**
   * 현재 라운드 id (새로고침/재접속 시 서버 상태로 그대로 복구된다).
   *
   * Realtime game_rounds INSERT 이벤트만으로 갱신하면 이벤트가 누락/지연될 때
   * 클라이언트가 "이미 끝난 직전 판" 을 계속 조회하며 대기 화면에 갇힌다.
   * (서버 DB 는 이미 BETTING 인데 화면은 WAITING → 이후 다른 이벤트가 도착하는 순간
   *  여러 상태가 한꺼번에 갱신되는 증상)
   * 이 쿼리만 짧은 주기로 자기 치유(authoritative refetch)한다. 진행/생성은 서버 권한 그대로다.
   */
  const roundQuery = useQuery({
    queryKey: ["current-round", roomId],
    queryFn: () => fetchCurrentRoundId(roomId),
    enabled: !!user,
    // Realtime 이 정상 연결된 동안에는 새 판 생성/삭제가 이벤트로 즉시 도착하므로
    // 이 쿼리는 낮은 빈도의 safety sync 로만 유지한다 (연결이 끊기면 기존 3초로 복귀).
    refetchInterval: realtimeOk ? 8000 : 3000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const roundId = roundQuery.data ?? null;

  /**
   * 오래된 응답이 최신 서버 상태를 덮어쓰지 않도록 서버 시각(serverNow)을 기준으로 단조 증가만 허용한다.
   * (polling 응답이 액션 직후 refetch 보다 늦게 도착하는 경우)
   */
  const snapAtRef = useRef<{ roundId: string; at: number } | null>(null);

  // 서버 권한 라운드 상태 (카드 마스킹은 서버에서 수행)
  const stateQuery = useQuery({
    queryKey: ["round-state", roundId],
    enabled: !!roundId && !!user,
    // Realtime 이 살아 있으면 상대 액션이 이벤트로 도착하므로 polling 은 safety sync 로 낮춘다.
    refetchInterval: realtimeOk ? 4000 : 1200,
    queryFn: async () => {
      if (!roundId) return null;
      /**
       * 라운드 상태와 내 카드 슬롯을 서버 래퍼로 한 번에 조회한다 (왕복 2회 → 1회).
       * 서버 래퍼는 기존 get_round_state / get_my_cards 를 그대로 호출하며 마스킹 규칙은 동일하다.
       */
      const snap = await fetchRoundSnapshot(roundId);
      if (!snap) return null;
      const at = snap.server.serverNow
        ? new Date(snap.server.serverNow).getTime()
        : Date.now();
      const prev = snapAtRef.current;
      const cached = queryClient.getQueryData<{
        server: ServerRoundState;
        myCards: string[];
        slots: { code: string; order: number }[];
      } | null>(["round-state", roundId]);
      // stale 응답(서버 시각이 더 과거)은 버리고 이미 반영된 최신 상태를 유지한다.
      if (prev && prev.roundId === roundId && at < prev.at && cached) return cached;
      snapAtRef.current = { roundId, at };
      // 카드 슬롯(card_order)까지 그대로 받아 "마지막에 받은 카드"를 서버 값으로 식별한다
      const mine = snap.server.seats.some((s) => s.isMe) ? snap.slots : [];
      return { server: snap.server, myCards: mine.map((s) => s.code), slots: mine };
    },
  });

  const server = stateQuery.data?.server ?? null;
  const engineState = stateQuery.data
    ? toEngineState(stateQuery.data.server, stateQuery.data.myCards)
    : null;

  const resync = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["room-players", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["current-round", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["round-state"] });
    void queryClient.invalidateQueries({ queryKey: ["profile"] });
  }, [queryClient, roomId]);

  // 실시간 동기화 (좌석 · 라운드 · 행동) — event를 놓쳐도 DB 상태가 source of truth다.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`room-live:${roomId}`)
      /**
       * 좌석 변경(UPDATE 포함)은 좌석 상태 조회만 다시 한다.
       * 장착 정보(room-loadouts)는 착석/퇴장(INSERT/DELETE) 때만 바뀌므로,
       * 접속 신호·준비 토글 같은 잦은 UPDATE 마다 재조회하지 않는다.
       * (측정: 60초 주기 쿼리가 약 2.4초마다 재조회되어 인원수에 비례해 요청이 증폭됐다)
       */
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_room_players", filter: `room_id=eq.${roomId}` },
        (payload) => {
          coalesceInvalidate(["room-players", roomId]);
          if (payload.eventType === "INSERT" || payload.eventType === "DELETE") {
            coalesceInvalidate(["room-loadouts", roomId]);
          }
        },
      )
      // DELETE 이벤트는 replica identity(PK)만 전달되어 room_id 필터에 걸리지 않는다.
      // 필터 없는 DELETE 리스너를 따로 두어 퇴장/강제퇴장 좌석이 화면에 남지 않게 한다.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "game_room_players" },
        () => {
          coalesceInvalidate(["room-players", roomId]);
          coalesceInvalidate(["room-loadouts", roomId]);
        },
      )
      /**
       * 라운드 변경: UPDATE(베팅·턴·단계 진행)는 라운드 상태만 다시 조회한다.
       * 현재 라운드 id 는 새 판 생성/삭제(INSERT/DELETE)에서만 바뀌므로 그때만 재조회한다.
       * (측정: 액션 1회에 UPDATE 가 여러 번 도착해 game_rounds 조회가 3~7회로 증폭됐다)
       */
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_rounds", filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType !== "UPDATE") {
            coalesceInvalidate(["current-round", roomId]);
          }
          coalesceInvalidate(["round-state"]);
        },
      )
      .subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        setRealtimeOk(ok);
        // 재연결 성공 시 서버 상태를 다시 fetch해 로컬 UI를 동기화한다.
        if (ok) resync();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, queryClient, user, resync, coalesceInvalidate]);

  // 브라우저 네트워크 복귀 시에도 서버 상태를 다시 fetch한다.
  useEffect(() => {
    const onOnline = () => {
      setRealtimeOk(true);
      resync();
    };
    const onOffline = () => setRealtimeOk(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [resync]);


  /**
   * 서버 상태 최신값을 ref로 유지한다.
   * (interval 의존성에 server 객체를 넣으면 polling 마다 interval이 재생성되어
   *  타임아웃/freeze watchdog이 실제로 발화하지 못한다 → 진행 정지 원인)
   */
  const serverRef = useRef(server);
  serverRef.current = server;

  // 턴 제한시간 초과 → 서버가 시간을 재검증하고 자동 행동을 확정한다
  useEffect(() => {
    if (!roundId) return;
    const timer = setInterval(() => {
      const s = serverRef.current;
      if (!s || s.status === "finished" || !s.turnDeadline) return;
      if (new Date(s.turnDeadline).getTime() > Date.now()) return;
      /**
       * 3장 섯다 공개패 단계의 자동선택은 서버 watchdog(advance_round_state)이 담당한다.
       * (기존 서버 규칙/기존 deadline 그대로 사용 · 클라이언트가 카드를 고르지 않는다)
       */
      if (s.phase === "OPEN_CARD_SELECTION") {
        void advanceRoundState(roundId)
          .then(() => queryClient.invalidateQueries({ queryKey: ["round-state", roundId] }))
          .catch(() => undefined);
        return;
      }
      void enforceTurnTimeout(roundId)
        .then(() => queryClient.invalidateQueries({ queryKey: ["round-state", roundId] }))
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [roundId, queryClient]);

  /**
   * 진행 정지(freeze) 감시.
   * 서버 상태(phase/turn/pot/카드수)가 10초 이상 변하지 않으면 서버 watchdog을 호출한다.
   * 실제 진행 판단은 100% 서버가 하고, 안전하지 않으면 서버가 아무것도 하지 않는다.
   */
  const stallRef = useRef<{ key: string; at: number }>({ key: "", at: Date.now() });
  useEffect(() => {
    if (!roundId) return;
    const timer = setInterval(() => {
      const s = serverRef.current;
      if (!s || s.status === "finished") return;
      const key = [
        s.roundId,
        s.phase,
        s.stage,
        s.pot,
        s.currentBet,
        s.turnUserId ?? "-",
        s.seats.map((x) => `${x.userId}:${x.cardCount ?? 0}:${x.folded ? 1 : 0}`).join(","),
      ].join("|");
      if (stallRef.current.key !== key) {
        stallRef.current = { key, at: Date.now() };
        return;
      }
      if (Date.now() - stallRef.current.at < 10_000) return;
      stallRef.current.at = Date.now();
      void advanceRoundState(roundId)
        .then(() => resync())
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [roundId, resync]);

  // 정산 완료 → 모든 플레이어 잔액을 서버에서 다시 fetch (프론트 재계산 금지)
  useEffect(() => {
    if (!server || server.status !== "finished") return;
    if (settledRef.current === server.roundId) return;
    settledRef.current = server.roundId;
    void queryClient.invalidateQueries({ queryKey: ["profile"] });
    void queryClient.invalidateQueries({ queryKey: ["room-players", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["round-state", server.roundId] });
  }, [server, queryClient, roomId]);

  /**
   * 오링/잔액 부족 자동 퇴장.
   * 결과창을 약 4초 확인한 뒤 서버가 최신 잔액과 방 최소 입장 포인트를 비교해 좌석을 정리한다.
   * 판정·제거는 100% 서버(enforce_room_min_balance)에서 수행하고, 프론트는 안내 후 로비로 이동한다.
   */
  type ExitReason =
    | "USER_LEAVE"
    | "LEAVE_PENDING"
    | "ZERO_BALANCE"
    | "MIN_POINTS"
    | "LONG_ABSENCE"
    | "ADMIN_KICK"
    | "DISCONNECT_TIMEOUT"
    | "ROOM_CLOSED"
    | "UNKNOWN";

  const [kickNotice, setKickNotice] = useState<{
    min: number;
    points: number;
    reason: ExitReason;
  } | null>(null);
  const kickRef = useRef<string | null>(null);
  useEffect(() => {
    if (!server || server.status !== "finished" || !user) return;
    if (kickRef.current === server.roundId) return;
    kickRef.current = server.roundId;
    const timer = window.setTimeout(() => {
      void enforceRoomMinBalance(roomId)
        .then((res) => {
          resync();
          const mine = res.removed.find((r) => r.userId === user.id);
          if (!mine) return;
          const points = Number(mine.points ?? 0);
          setKickNotice({
            min: Number(res.minPoints ?? 0),
            points,
            // 최종 정산 완료 + 잔액 0P 인 경우에만 ZERO_BALANCE 로 안내한다.
            reason: points <= 0 ? "ZERO_BALANCE" : "MIN_POINTS",
          });
          window.setTimeout(() => void navigate({ to: "/rooms" }), 3000);
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.roundId, server?.status, user?.id, roomId]);

  /**
   * 방 자체가 종료/삭제된 경우 — 좌석 배정 대기 상태로 갇히지 않고 안내 후 로비로 이동한다.
   * (서버가 SOURCE OF TRUTH · 클라이언트는 어떤 row 도 직접 삭제하지 않는다)
   */
  useEffect(() => {
    if (!user || !roomGone || kickedRef.current) return;
    kickedRef.current = true;
    setKickNotice({
      min: Number(room.data?.min_points ?? 0),
      points: Number(profile?.game_points ?? 0),
      reason: "ROOM_CLOSED",
    });
    window.setTimeout(() => void navigate({ to: "/rooms" }), 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomGone, user?.id]);

  /**
   * 서버가 좌석을 이미 정리한 경우(정산 트리거 등)에도 반드시 로비로 나간다.
   * 판정은 서버가 하고, 프론트는 "내 좌석이 사라졌다"는 서버 상태만 보고 안내·이동한다.
   */
  useEffect(() => {
    if (!user || table.isLoading || !room.data || roomGone) return;
    const mineSeat = roomSeats.find((s) => s.userId === user.id);
    if (mineSeat) {

      wasSeatedRef.current = true;
      lastSeatRef.current = {
        leavePending: !!mineSeat.leavePending,
        missedTurns: Number(mineSeat.missedTurns ?? 0),
        connection: mineSeat.connection ?? "CONNECTED",
      };
      return;
    }
    if (!wasSeatedRef.current || kickedRef.current) return;
    kickedRef.current = true;
    const last = lastSeatRef.current;
    const points = Number(profile?.game_points ?? 0);
    /**
     * 퇴장 사유 분리 — 마지막으로 관측된 내 좌석 상태를 근거로 판단하고,
     * 근거가 없으면 ZERO_BALANCE 로 단정하지 않고 일반 안내를 사용한다.
     */
    const reason: ExitReason = leaveRequestedRef.current
      ? last?.leavePending
        ? "LEAVE_PENDING"
        : "USER_LEAVE"
      : (last?.missedTurns ?? 0) >= 3
        ? "LONG_ABSENCE"
        : last?.connection && last.connection !== "CONNECTED"
          ? "DISCONNECT_TIMEOUT"
          : "UNKNOWN";
    setKickNotice({ min: Number(room.data.min_points ?? 0), points, reason });
    window.setTimeout(() => void navigate({ to: "/rooms" }), 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomSeats, table.isLoading, room.data, user?.id, profile?.game_points]);


  /**
   * ROUND_RESULT 유지(약 8초) → 자동으로 다음 판 시작.
   *
   * 남은 시간은 "시작 예정 시각 - 현재시각" 으로 계산한다.
   * (백그라운드 탭에서 setInterval 이 throttling 되어도 실제 대기 시간이 늘어나지 않는다)
   * 시작 요청이 실패/누락되면 판이 끝난 화면에 갇히므로, 서버가 다음 판을 만들 때까지
   * 같은 요청을 3초 간격으로 재시도한다. 라운드 생성/직렬화는 100% 서버(start_game_round)가 한다.
   */
  useEffect(() => {
    if (!server || server.status !== "finished" || seatedCount < 2 || kickNotice) {
      setNextRoundIn(null);
      return;
    }
    // SHOWDOWN 카드 공개(약 2초) + 결과 확인(약 6초) = 총 8초 유지 후 다음 판
    const startAt = Date.now() + 8000;
    setNextRoundIn(8);
    let lastTry = 0;

    const tick = () => {
      const s = serverRef.current;
      // 서버가 이미 다음 판을 만들었다 → 카운트다운 종료 (재시도 중단)
      if (!s || s.status !== "finished") {
        setNextRoundIn(null);
        return;
      }
      const remain = Math.ceil((startAt - Date.now()) / 1000);
      if (remain > 0) {
        setNextRoundIn(remain);
        return;
      }
      setNextRoundIn(null);
      if (Date.now() - lastTry < 3000) return;
      lastTry = Date.now();
      // 동시 호출도 서버가 방 단위 lock으로 직렬화 → 라운드는 하나만 생성된다.
      void startServerRound(roomId)
        .then(() => resync())
        .catch(() => undefined);
    };

    const timer = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        resync();
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.roundId, server?.status, seatedCount, roomId]);


  /** READY 토글 — 서버가 좌석/진행 상태를 검증한다 */
  const toggleReady = useCallback(
    (ready: boolean) => {
      void setRoomReady(roomId, ready)
        .then(() => queryClient.invalidateQueries({ queryKey: ["room-players", roomId] }))
        .catch((e: unknown) => toast.error(friendlyErrorMessage(e, "준비 상태를 변경할 수 없습니다.")));
    },
    [roomId, queryClient],
  );

  /** 전원 READY 충족 시 첫 판 자동 시작 (동시 호출은 서버가 방 단위로 직렬화) */
  const startedRef = useRef<string | null>(null);
  useEffect(() => {
    if (roundId || !readyRequired || !allReady) return;
    const key = `${roomId}:${readyCount}`;
    if (startedRef.current === key) return;
    startedRef.current = key;
    void startServerRound(roomId)
      .then(() => resync())
      .catch(() => undefined);
  }, [roundId, readyRequired, allReady, readyCount, roomId, resync]);

  const mode = (room.data?.game_mode as GameMode) ?? "sutda2";
  const baseBet = room.data?.base_bet ?? 1000;

  /** 서버 응답 대기 중 중복 호출을 차단한다 (더블클릭 방지) */
  async function guarded(
    fn: string,
    action: string | null,
    run: () => Promise<void>,
    fallback: string,
  ) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    try {
      await run();
    } catch (error) {
      void logGameError({
        fn,
        error,
        roomId,
        roundId,
        phase: server?.phase ?? null,
        action,
      });
      toast.error(friendlyErrorMessage(error, fallback));
      // 서버가 거부했다면 화면 상태가 낡았을 가능성이 높다 → 서버 기준으로 즉시 재동기화
      resync();
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!user) return;
    await guarded(
      "start_game_round",
      null,
      async () => {
        await startServerRound(roomId);
        await queryClient.invalidateQueries({ queryKey: ["current-round", roomId] });
        await queryClient.invalidateQueries({ queryKey: ["profile"] });
      },
      "판을 시작할 수 없습니다.",
    );
  }

  async function act(action: BetAction) {
    if (!roundId) return;
    // 활성 버튼의 정상 클릭 시점에 즉시 재생 (RPC 전).
    // 서버 확정 사운드는 playAction 에서 같은 액션 1건을 흡수하므로 중복 재생되지 않는다.
    playActionLocal(action);
    await guarded(
      "place_bet_action",
      action,
      async () => {
        await sendBetAction(roundId, action);
        await queryClient.invalidateQueries({ queryKey: ["round-state", roundId] });
        await queryClient.invalidateQueries({ queryKey: ["profile"] });
      },
      "행동을 처리할 수 없습니다.",
    );
  }

  async function confirmSelection(cards: [string, string]) {
    if (!roundId) return;
    await guarded(
      "select_final_hand",
      "hand_selection",
      async () => {
        await sendFinalHand(roundId, cards);
        await queryClient.invalidateQueries({ queryKey: ["round-state", roundId] });
      },
      "승부패를 확정할 수 없습니다.",
    );
  }

  async function chooseOpenCard(card: string) {
    if (!roundId) return;
    await guarded(
      "select_open_card",
      "open_card",
      async () => {
        await selectOpenCard(roundId, card);
        await queryClient.invalidateQueries({ queryKey: ["round-state", roundId] });
      },
      "공개패를 선택할 수 없습니다.",
    );
  }

  async function chooseFoldWinReveal(reveal: boolean) {
    if (!roundId) return;
    await guarded(
      "set_fold_win_reveal",
      reveal ? "reveal" : "hide",
      async () => {
        // 서버 확정이 유일한 기준 — 확정 후 라운드 상태와 결과를 다시 읽어 즉시 반영한다.
        await setFoldWinReveal(roundId, reveal);
        await queryClient.invalidateQueries({ queryKey: ["round-state", roundId] });
        await refreshResult();
      },
      "선택을 처리할 수 없습니다.",
    );
  }

  /**
   * 두 번째 패 확인 완료를 서버에 확정한다.
   *
   * 진행의 source of truth 는 서버(confirm_card_squeeze) 다.
   * 쪼기 애니메이션/animationend 같은 UI 이벤트는 표현 전용이며,
   * 이벤트가 누락되더라도(백그라운드 탭·DOM unmount) 아래 재시도 루프가 서버 확정을 보장한다.
   * 같은 라운드에서 여러 번 호출되어도 서버가 멱등 처리하고, 이미 완료/phase 이동은 정상 거부다.
   */
  const squeezeSendingRef = useRef(false);
  const [squeezeAckRound, setSqueezeAckRound] = useState<string | null>(null);
  const sendSqueezeConfirm = useCallback(async () => {
    const s = serverRef.current;
    if (!s || s.mode !== "sutda2" || s.phase !== "SQUEEZING" || !roundId) return;
    const me = s.seats.find((x) => x.isMe);
    if (!me || me.folded) return;
    if (squeezeSendingRef.current) return;
    squeezeSendingRef.current = true;
    try {
      await confirmCardSqueeze(roundId);
      // 서버가 수락했거나 정상 거부(이미 완료)한 경우 모두 "내 확인은 끝났다"로 간주한다.
      setSqueezeAckRound(roundId);
    } catch (error) {
      void logGameError({
        fn: "confirm_card_squeeze",
        error,
        roomId,
        roundId,
        phase: s.phase,
        action: "squeeze_complete",
      });
    } finally {
      squeezeSendingRef.current = false;
      await queryClient.invalidateQueries({ queryKey: ["round-state", roundId] });
    }
  }, [queryClient, roomId, roundId]);

  /** 이번 라운드 쪼기 대상(마지막) 카드 — 아래에서 계산 후 주입 (표시 전용 ref) */
  const lastCardRef = useRef<string | null>(null);
  const completeSqueeze = useCallback(
    (card?: string) => {
      if (card) markRevealed(card);
      // 첫 장 확인은 표시 전용이다. 서버 쪼기 확정은 쪼기 대상 카드에만 보낸다.
      if (card && lastCardRef.current && card !== lastCardRef.current) return;
      void sendSqueezeConfirm();
    },
    [markRevealed, sendSqueezeConfirm],
  );

  async function handleLeave() {
    await guarded(
      "request_leave_room",
      "leave",
      async () => {
        leaveRequestedRef.current = true;
        const result = await requestLeaveRoom(roomId);
        setLeaveAsk(false);
        await queryClient.invalidateQueries({ queryKey: ["room-players", roomId] });
        // 로비 "게임으로 복귀" 배너는 서버 좌석 상태만 근거로 하므로 즉시 다시 확인한다.
        await queryClient.invalidateQueries({ queryKey: ["my-active-game"] });
        if (result === "LEAVE_PENDING") {
          toast.success("현재 판 종료 후 게임방에서 나갑니다.");
        } else {
          toast.success("게임방에서 정상적으로 퇴장했습니다.");
          void navigate({ to: "/rooms" });
        }
      },
      "나가기를 처리할 수 없습니다.",
    );
  }

  async function handleCancelLeave() {
    await guarded(
      "cancel_leave_room",
      "cancel_leave",
      async () => {
        leaveRequestedRef.current = false;
        await cancelLeaveRoom(roomId);
        await queryClient.invalidateQueries({ queryKey: ["room-players", roomId] });
        toast.success("나가기 예약을 취소했습니다.");
      },
      "예약을 취소할 수 없습니다.",
    );
  }

  /**
   * 베팅 액션 사운드 — 서버 game_actions 에 확정된 행동만 재생한다.
   * action id(서버 PK)로 dedupe 하므로 realtime refetch/재연결로 같은 행동이 다시 들어와도
   * 같은 효과음이 두 번 재생되지 않는다. 최초 진입(재접속) 시의 과거 행동은 재생하지 않는다.
   */
  const seenActionsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!server) return;
    const ids = server.actions.map((a, i) => String(a.id ?? a.actionId ?? `${a.userId}-${a.at}-${i}`));
    if (seenActionsRef.current === null) {
      // 최초 스냅샷은 "이미 지난 행동"으로 간주한다
      seenActionsRef.current = new Set(ids);
      return;
    }
    const seen = seenActionsRef.current;
    server.actions.forEach((a, i) => {
      const id = ids[i]!;
      if (seen.has(id)) return;
      seen.add(id);
      if (a.type === "ante") return;
      playAction(a.type, id, a.userId === user?.id);
    });
  }, [server]);

  /** 라운드 시작 · 카드 배분 · 쪼기 시작 · 사이드팟 이벤트 사운드 */
  useEffect(() => {
    if (!server) return;
    playEvent("ROUND_START", server.roundId);
    // 카드 지급 — 단계(stage)별 1회만 재생한다 (렌더마다 재생 금지)
    if (Number(server.stage ?? 0) >= 1) playEvent("CARD_FIRST", `${server.roundId}:1`);
    if (Number(server.stage ?? 0) >= 2) playEvent("CARD_SECOND", `${server.roundId}:2`);
    if (Number(server.stage ?? 0) >= 3) playEvent("CARD_THIRD", `${server.roundId}:3`);
    if (server.phase === "HAND_SELECTION" || server.phase === "FINAL_HAND_SUBMIT")
      playEvent("FINAL_SELECT", `${server.roundId}:final`);
    if (server.phase === "SQUEEZING" || server.phase === "LAST_CARD_DEALT")
      playEvent("PEEL_START", `${server.roundId}:${server.stage}`);
    if ((server.pots?.length ?? 0) > 1)
      playEvent("SIDE_POT", `${server.roundId}:${server.pots.length}`);
  }, [server]);

  /** POT 증가 사운드 — 서버 확정 POT 값 기준 1회 (증가할 때만) */
  const prevPotRef = useRef<{ round: string; pot: number } | null>(null);
  useEffect(() => {
    if (!server) return;
    const pot = Number(server.pot ?? 0);
    const prev = prevPotRef.current;
    prevPotRef.current = { round: server.roundId, pot };
    if (!prev || prev.round !== server.roundId) return;
    if (pot > prev.pot) playEvent("POT_INCREASE", `${server.roundId}:pot:${pot}`);
  }, [server]);

  /** 결과 사운드 (SHOWDOWN → 족보 보이스 → 승리/재경기) — 서버 판정 결과 기준 */
  useEffect(() => {
    if (!server || server.status !== "finished") return;
    const rid = server.roundId;
    playEvent("SHOWDOWN", rid);
    if (server.rematch) {
      playHand(server.rematchReason?.startsWith("GUSA") ? "gusa" : null, rid);
      playEvent("REMATCH", rid, 750);
      return;
    }
    const me = server.seats.find((s) => s.isMe);
    const winner = server.seats.find((s) => s.resultType === "WIN");
    // 족보 보이스는 서버 hand_code 기준으로만 재생한다 (프론트 카드 판정 금지)
    playHand(winner?.handCode ?? null, rid);
    playEvent("WINNER", rid, 950);
    if (me?.resultType === "WIN") playEvent("POT_WIN", rid, 1500);
    else if (me && me.resultType !== null) playEvent("ROUND_LOSE", rid, 950);
  }, [server]);

  /**
   * 3장 섯다 최종 승부패 선택 — 내 좌석 카드 위에서 2장을 고른다 (표시 전용).
   * 실제 확정/족보/정산은 서버(select_final_hand)가 판정한다.
   */
  const [pickedCards, setPickedCards] = useState<string[]>([]);
  const meSeat = server?.seats.find((s) => s.isMe) ?? null;
  const myCards = stateQuery.data?.myCards ?? [];
  const mySlots = stateQuery.data?.slots ?? [];
  /** 최종 승부패 선택은 "최종 베팅이 모두 끝난 뒤"에만 열린다 */
  const needsSelection =
    !!server &&
    (server.phase === "FINAL_HAND_SUBMIT" || server.phase === "HAND_SELECTION") &&
    !!meSeat &&
    !meSeat.folded &&
    myCards.length === 3 &&
    !meSeat.selectedCards;
  // "현재 최고패" 미리보기는 쪼기 대상 카드 판정 이후에 계산한다 (아래 handPreviewLabel 참고)

  const options = serverActionOptions(server);
  const inProgress = !!server && server.status !== "finished";
  const finished = !!server && server.status === "finished";
  /** 내 차례 여부 — 서버가 내려준 availableActions 기준 */
  const isMyTurn =
    !!engineState && mySeat !== null && engineState.turnSeat === mySeat && options.length > 0;

  /** SHOWDOWN 카운트다운 / 카드 공개 타이밍 (표시 전용) */
  const { countdown, revealed: showdownRevealed } = useShowdownReveal(
    engineState?.phase === "showdown",
    server?.roundId ?? null,
  );

  /**
   * 카드 공개 / 쪼기 규칙 (2장·3장 공통).
   *
   *   "마지막에 새로 받는 카드 1장만 쪼기(PEEL) 대상이다."
   *
   * - 2장방: slot 1 = OPEN, slot 2 = PEEL
   * - 3장방: slot 1 = OPEN, slot 2 = OPEN, slot 3 = PEEL
   * - 슬롯 판정은 CSS/배열 순서가 아니라 서버 game_cards.card_order 기준이다.
   * - 아직 마지막 카드가 지급되지 않았으면(3장방 2장 보유 등) 보유 카드는 전부 OPEN 이다.
   * - 이미 공개된 카드는 phase 변경/hover/쪼기 애니메이션과 무관하게 앞면으로 고정된다.
   */
  const totalSlots = (server?.mode ?? mode) === "sutda3" ? 3 : 2;
  /** 쪼기 대상 = 이 라운드 최종 슬롯 번호의 카드 (지급 전에는 없음) */
  const peelSlot = mySlots.some((s) => s.order === totalSlots) ? totalSlots : null;
  /** 2장방: 첫 장 자동 공개 금지 — 내 카드는 모두 쪼기 전까지 뒷면 유지 */
  const isSutda2Mode = (server?.mode ?? mode) !== "sutda3";
  const myCardVisuals: CardVisual[] = mySlots.map((slot) => {
    if (finished) return "FACE_UP";
    if (revealedCards.includes(slot.code)) return "REVEALED";
    if (isSutda2Mode) return "SQUEEZE_READY";
    return peelSlot !== null && slot.order === peelSlot ? "SQUEEZE_READY" : "FACE_UP";
  });
  /** 마지막 패를 아직 확인하지 않았다면 쪼기 안내를 노출한다 (최종 베팅과 병행) */
  const lastCard = peelSlot !== null
    ? (mySlots.find((s) => s.order === peelSlot)?.code ?? null)
    : null;
  lastCardRef.current = lastCard;
  /**
   * "현재 최고패" 미리보기 (내 화면 전용 · 표시 전용).
   * 쪼기 대상 카드를 아직 공개하지 않았으면 실제 족보를 절대 표시하지 않는다(판정 대기).
   * 최종 확정/승패/정산은 언제나 서버가 판정한다.
   */
  const peelPending =
    !finished &&
    (isSutda2Mode
      ? /* 2장방: 아직 확인하지 않은 내 카드가 하나라도 있으면 족보 미리보기 대기 */
        mySlots.some((s) => !revealedCards.includes(s.code))
      : !!lastCard && !revealedCards.includes(lastCard));
  const handPreviewLabel = useMemo(() => {
    if (!meSeat || meSeat.folded) return null;
    if (mode === "sutda3") {
      if (needsSelection) return sutda3CurrentHandLabel(myCards, pickedCards, true);
      if (peelPending) return HAND_LABEL_PENDING;
      return sutda3CurrentHandLabel(myCards);
    }
    if (peelPending) return HAND_LABEL_PENDING;
    return sutda2CurrentHandLabel(myCards);
  }, [meSeat, mode, myCards, needsSelection, peelPending, pickedCards]);

  /**
   * 쪼기 안내/확인 버튼 유지 조건.
   * 로컬에서 카드를 공개했더라도 서버 phase 가 아직 SQUEEZING 이고 내 확인이 확정되지 않았으면
   * "패 확인 완료"를 계속 노출한다 (UI 상태만으로 진행이 끝났다고 판단하지 않는다).
   */
  const squeezeConfirmed = !!server && squeezeAckRound === server.roundId;
  const needsSqueeze =
    !!server &&
    !finished &&
    !!meSeat &&
    !meSeat.folded &&
    !!lastCard &&
    (!revealedCards.includes(lastCard) ||
      (server.phase === "SQUEEZING" && !squeezeConfirmed));

  /**
   * 쪼기 단계 진행 보장 루프 (서버 권한).
   * - 내 카드를 공개했는데 서버 확정이 누락되면 다시 확정 요청한다.
   * - 서버 watchdog(advance_round_state)을 호출해 SQUEEZING 타임아웃 fallback 을 진행시킨다.
   *   실제 진행 판단·시간 검증은 100% 서버가 하고, 안전하지 않으면 서버가 아무것도 하지 않는다.
   */
  const peelRevealedRef = useRef(false);
  peelRevealedRef.current = !!lastCard && revealedCards.includes(lastCard);
  const squeezeConfirmedRef = useRef(false);
  squeezeConfirmedRef.current = squeezeConfirmed;
  useEffect(() => {
    if (!roundId) return;
    const timer = setInterval(() => {
      const s = serverRef.current;
      if (!s || s.mode !== "sutda2" || s.phase !== "SQUEEZING" || s.status === "finished") return;
      const me = s.seats.find((x) => x.isMe);
      if (me && !me.folded && peelRevealedRef.current && !squeezeConfirmedRef.current) {
        void sendSqueezeConfirm();
      }
      void advanceRoundState(roundId).catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [roundId, sendSqueezeConfirm]);
  /** 3장 섯다 공개패 선택 단계 (내 2장 중 상대에게 보여줄 1장) */
  const needsOpenCard =
    !!server &&
    server.phase === "OPEN_CARD_SELECTION" &&
    !!meSeat &&
    !meSeat.folded &&
    !meSeat.openCard &&
    myCards.length >= 2;
  /**
   * 공개패 선택은 마쳤고 아직 서버가 공개 상태로 전환하지 않은 대기 구간.
   * 대상 인원 판단은 서버 상태(openCardPending)만 사용한다 (접속자 수로 계산하지 않는다).
   */
  const openCardWaiting =
    !!server &&
    server.phase === "OPEN_CARD_SELECTION" &&
    !!meSeat &&
    !meSeat.folded &&
    !!meSeat.openCardSelected;
  const openCardPending = Math.max(Number(server?.openCardPending ?? 0), 0);
  /** 공개패 표시용 map — 서버가 공개를 허용한 값만 담긴다 */
  const openCards = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const s of server?.seats ?? []) out[s.userId] = s.openCard ?? null;
    return out;
  }, [server]);
  /** FOLD WIN 승자의 패 공개 선택 */
  const needsFoldWinChoice =
    !!server && server.foldWinChoice === "PENDING" && !!server.iAmFoldWinner;
  /** 2장 섯다 결과 표시 — 서버 확정 결과만 읽는다 (진행/정산에 개입하지 않음) */
  const { view: resultView, refresh: refreshResult } = useSutda2RoundResult(
    server,
    user?.id ?? null,
    mode === "sutda2" || mode === "sutda3",
  );

  /**
   * 선택 시간이 지나면 서버에서 비공개로 확정한다.
   * 클라이언트가 모달만 닫고 서버가 PENDING 으로 남는 상황을 방지한다.
   */
  const revealResolveRef = useRef<string | null>(null);
  useEffect(() => {
    if (!roundId || !server || server.foldWinChoice !== "PENDING") return undefined;
    const deadline = server.foldWinDeadline ? new Date(server.foldWinDeadline).getTime() : 0;
    const wait = Math.max(0, deadline - Date.now()) + 400;
    const timer = window.setTimeout(() => {
      if (revealResolveRef.current === roundId) return;
      revealResolveRef.current = roundId;
      void resolveFoldWinReveal(roundId)
        .then(async () => {
          await queryClient.invalidateQueries({ queryKey: ["round-state", roundId] });
          await refreshResult();
        })
        .catch(() => undefined);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [roundId, server, queryClient, refreshResult]);
  /** 게임기록 결과 상세 — 판별 1회 */
  const resultLogLines = useMemo(
    () => (resultView ? sutda2ResultLogLines(resultView) : []),
    [resultView],
  );
  /** 현재 진행 단계 한글 라벨 — 사용자가 지금 무엇을 해야 하는지 즉시 파악 */
  const phaseLabel = (() => {
    if (!server) return "플레이어 대기 중";
    if (server.rematch) return "재경기 준비";
    if (server.status === "finished") return "SHOWDOWN · 결과";
    switch (server.phase) {
      case "DEALING":
        return "첫 패 배분";
      case "OPEN_CARD_SELECTION":
        return "공개패 선택";
      case "BETTING":
      case "FIRST_BETTING":
        return server.mode === "sutda2" && server.stage < 2 ? "첫 패 · 1차 베팅" : "1차 베팅";
      case "SQUEEZING":
        return "패 쪼기";
      case "FINAL_BETTING":
        return server.mode === "sutda2" ? "두 번째 패 · 마지막 베팅" : "마지막 패 · 마지막 베팅";
      case "HAND_SELECTION":
      case "FINAL_HAND_SUBMIT":
        return "최종 승부패 선택";
      case "SHOWDOWN":
      case "SETTLING":
      case "ROUND_RESULT":
        return "SHOWDOWN";
      default:
        return "게임 진행 중";
    }
  })();

  const cardCounts = Object.fromEntries(
    (server?.seats ?? []).map((s) => [s.userId, Number(s.cardCount ?? 0)]),
  );

  /** 라운드가 바뀌면 쪼기 공개 기록을 초기화한다 */
  useEffect(() => {
    const rid = server?.roundId ?? null;
    if (rid !== revealRound) {
      setRevealRound(rid);
      setRevealedCards([]);
      setSqueezeAckRound(null);
      setPickedCards([]);
    }
  }, [server?.roundId, revealRound]);

  /** 승리 시 자동 리액션 (설정 ON일 때 1회) */
  useEffect(() => {
    if (!autoWinReaction || !finished || !server || !meSeat) return;
    if (autoReactionRef.current === server.roundId) return;
    if (meSeat.resultType !== "WIN") return;
    autoReactionRef.current = server.roundId;
    fireReaction(AUTO_WIN_REACTION_CODE);
  }, [autoWinReaction, finished, server, meSeat, fireReaction]);


  /** 선택 단계에서는 베팅 액션을 잠근다 (서버 phase 로직은 그대로) */
  const actionsLocked =
    needsSelection || needsOpenCard || openCardWaiting || needsFoldWinChoice;

  /**
   * 내 턴 음성 알림 (UX 전용 · 서버 turn state 기준).
   * turnKey = roundId + phase + 서버 turn deadline → 같은 턴에서는 1회만 재생된다.
   * hook 순서 보장을 위해 조건부 return 이전에 호출한다.
   */
  const turnAlertKey =
    server && server.status !== "finished"
      ? `${server.roundId}:${server.phase}:${server.turnDeadline ?? ""}`
      : null;
  useMyTurnAlert({
    enabled: soundOn,
    active: isMyTurn && !actionsLocked,
    turnKey: turnAlertKey,
  });
  useMyTurnAlert({
    enabled: soundOn,
    active: needsOpenCard,
    turnKey: turnAlertKey,
    kind: "OPEN_CARD",
  });
  /** 3장 최종 승부패 선택 단계 — 사용자 입력이 필요하므로 1회만 안내한다 */
  useMyTurnAlert({
    enabled: soundOn,
    active: needsSelection && !needsOpenCard,
    turnKey: turnAlertKey,
    kind: "MAKE",
  });

  if (!user) {
    return (
      <AppShell>
        <div className="panel-surface rounded-2xl p-10 text-center">
          <p className="text-sm text-foreground/80">게임 참가는 로그인 후 가능합니다.</p>
          <Button variant="gold" className="mt-4" asChild>
            <Link to="/auth">로그인 / 회원가입</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  /* =====================================================================
   * 1600x900 STAGE ZONE 정의 (px 좌표 patch 없이 고정 grid row/column 으로만 분리)
   *
   *   A. TOP BAR      : 방 정보 / 사운드 / 전체화면 / 사이드바
   *   B. GAME TABLE   : 좌석 · 카드 · 중앙 POT · 현금다발
   *   C. DECISION     : READY / 쪼기 / 공개패 / 최종 승부패 / 결과
   *   D. ACTION BAR   : 베팅 액션 (항상 클릭 가능한 최상위 인터랙션 블록)
   *   E. STATUS BAR   : 현재 상태 / 남은 시간 / 서버 안내
   * ===================================================================== */
  const STAGE_PAD = 8;
  const TOP_BAR_H = 46;
  const ACTION_H = 80;
  const STATUS_H = 32;
  const ZONE_GAP = 12;
  /** 2장 섯다는 우측 채팅/게임로그 패널을 조금 더 넓게 사용한다 (게임판 좌표 영향 없음) */
  const SIDEBAR_W = mode === "sutda2" ? 300 : 216;
  const BODY_H = STAGE_HEIGHT - STAGE_PAD * 2 - TOP_BAR_H - ZONE_GAP;

  /** 선택형 UI(카드 선택/쪼기)는 DECISION ZONE 을 넓게 사용한다 (카드가 잘리지 않는 높이) */
  const decisionExpanded = needsSelection || needsOpenCard || (needsSqueeze && !!lastCard);
  /**
   * 2장 섯다는 쪼기 단계에서도 DECISION 높이를 바꾸지 않는다.
   * (높이가 바뀌면 좌석/POT 좌표가 이동해 layout shift 가 발생한다)
   */
  const DECISION_H = mode === "sutda2" ? 290 : decisionExpanded ? 290 : 160;
  const TABLE_H = BODY_H - DECISION_H - ACTION_H - STATUS_H - ZONE_GAP * 3;
  /**
   * 2장 섯다 게임모드 전용 — root 를 100vh 로 고정하고 stage 를 세로까지 맞춘다.
   * (일반 페이지 / 3장 섯다 / 도리짓고땡 스크롤 동작은 그대로)
   */
  const twoCardFitMode = gameMode && mode === "sutda2";




  const decisionTitle = needsSelection
    ? "최종 승부패 선택"
    : needsOpenCard
      ? "공개패 선택"
      : openCardWaiting
        ? "공개패 선택 완료"
        : needsFoldWinChoice
        ? "패 공개 선택"
        : needsSqueeze && lastCard
          ? "패 쪼기"
          : finished
            ? countdown
              ? "SHOWDOWN"
              : "ROUND RESULT"
            : !server
              ? "준비 READY"
              : phaseLabel;

  const decisionBody = needsSelection ? (
    <HandSelection
      cards={myCards}
      confirmed={meSeat?.selectedCards ?? null}
      onConfirm={(cards) => void confirmSelection(cards)}
    />
  ) : needsOpenCard ? (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-[13px] text-foreground/80">
        상대에게 보여줄 공개패 1장을 선택하세요. 나머지 패는 끝까지 비공개입니다.
      </p>
      <p className="text-[11px] text-foreground/60">
        선택한 카드는 전원이 고른 뒤 동시에 공개됩니다.
      </p>
      <ServerCountdownPanel
        deadline={server?.turnDeadline ?? null}
        serverNow={server?.serverNow ?? null}
        suffixLabel="자동 공개까지"
      />
      <div className="flex items-end justify-center gap-4">
        {myCards.slice(0, 2).map((card) => (
          <button
            key={card}
            type="button"
            disabled={busy}
            className="rounded-xl transition hover:scale-105 disabled:opacity-50"
            onClick={() => void chooseOpenCard(card)}
          >
            <HwatuCard cardId={card} visual="FACE_UP" size="lg" />
          </button>
        ))}
      </div>
    </div>
  ) : openCardWaiting ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-[15px] text-gold">공개패 선택 완료</p>
      <p className="text-[12px] text-foreground/75">
        {openCardPending > 0
          ? `남은 ${openCardPending}명의 선택을 기다리는 중입니다. 전원이 고르면 동시에 공개됩니다.`
          : "곧 모든 공개패가 동시에 공개됩니다."}
      </p>
      <ServerCountdownPanel
        deadline={server?.turnDeadline ?? null}
        serverNow={server?.serverNow ?? null}
        suffixLabel="자동 공개까지"
      />
    </div>
  ) : needsFoldWinChoice ? (
    // 공개 선택은 중앙 모달(SutdaRevealChoiceModal)에서만 받는다 — 작은 보조 문구를 두지 않는다.
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-[15px] text-gold">상대 전원 다이 승리 · 패 공개 선택 중</p>
    </div>
  ) : needsSqueeze && lastCard ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-[12px] text-foreground/80">
        {server?.phase === "SQUEEZING"
          ? "두 번째 패가 도착했습니다. 확인을 마치면 최종 베팅이 시작됩니다."
          : "마지막 패가 도착했습니다. 카드를 눌러 천천히 쪼아보세요."}
      </p>
      <div className="flex items-end justify-center gap-3">
        <CardRow cards={myCards.slice(0, -1)} size="md" />
        <HwatuCard cardId={lastCard} visual="SQUEEZE_READY" size="lg" onRevealed={completeSqueeze} />
        <Button variant="gold" size="sm" disabled={busy} onClick={() => completeSqueeze(lastCard)}>
          패 확인 완료
        </Button>
      </div>
    </div>
  ) : finished && countdown ? (
    <div className="flex h-full items-center justify-center">
      <span
        key={countdown}
        className="animate-deal font-display text-4xl text-gold drop-shadow-[0_0_24px_var(--gold)]"
      >
        {countdown}
      </span>
    </div>
  ) : finished && engineState && showdownRevealed ? (
    <div className="flex h-full flex-col justify-center gap-1">
      <RoundResultPanel
        state={engineState}
        nextRoundIn={nextRoundIn}
        rematch={!!server?.rematch}
        rematchReason={server?.rematchReason ?? null}
        carryPot={Number(server?.carryPot ?? 0)}
      />
      {readyRequired && (
        <ReadyBar
          seatedCount={seatedCount}
          readyCount={readyCount}
          iAmReady={iAmReady}
          readyRequired={readyRequired}
          starting={allReady}
          disabled={busy}
          onToggle={toggleReady}
        />
      )}
    </div>
  ) : !server ? (
    <div className="flex h-full items-center">
      <ReadyBar
        seatedCount={seatedCount}
        readyCount={readyCount}
        iAmReady={iAmReady}
        readyRequired={readyRequired}
        starting={allReady}
        disabled={busy}
        onToggle={toggleReady}
      />
    </div>
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      {/* 내 차례 강조 — 크기/레이아웃은 그대로 유지하고 색·글로우만 강조한다 */}
      <p
        className={
          isMyTurn && !actionsLocked
            ? "animate-pulse text-[12px] font-semibold text-gold [text-shadow:0_0_12px_var(--gold)]"
            : "text-[12px] text-foreground/75"
        }
      >
        {isMyTurn ? "내 차례입니다. 아래 액션바에서 행동을 선택하세요." : "상대 차례를 기다리는 중입니다…"}
      </p>
      {myLeavePending && <p className="text-[11px] text-gold-soft">현재 판 종료 후 게임방에서 나갑니다.</p>}
    </div>
  );

  /** 2장 섯다 — STAGE 우상단 컨트롤 (항상 클릭 가능) */
  const sutda2TopControls = (
    <>
      <Button
        variant={soundOn ? "goldOutline" : "table"}
        size="sm"
        onClick={() => {
          const next = !soundOn;
          setSoundOn(next);
          setSoundEnabled(next);
          if (next) playSoundPreview();
        }}
      >
        사운드 {soundOn ? "ON" : "OFF"}
      </Button>
      <Button variant="table" size="sm" onClick={() => setShowMixer(true)}>
        볼륨
      </Button>
      <Button
        variant={gameMode ? "goldOutline" : "table"}
        size="sm"
        onClick={() => setGameMode((v) => !v)}
      >
        게임모드 {gameMode ? "ON" : "OFF"}
      </Button>
      <Button variant="table" size="sm" onClick={() => void fullscreen.toggle()}>
        {fullscreen.active ? "창모드" : "전체화면"}
      </Button>
      <Button variant="table" size="sm" onClick={() => setSidebarOpen((v) => !v)}>
        {sidebarOpen ? "패널 접기" : "패널 열기"}
      </Button>
      {myLeavePending ? (
        <Button
          variant="goldOutline"
          size="sm"
          disabled={busy}
          onClick={() => void handleCancelLeave()}
        >
          예약 취소
        </Button>
      ) : (
        <Button
          variant="table"
          size="sm"
          disabled={busy}
          onClick={() => (inProgress ? setLeaveAsk(true) : void handleLeave())}
        >
          나가기
        </Button>
      )}
    </>
  );

  /** 2장 섯다 — 하단 공용 슬롯: READY compact bar 와 액션바가 같은 자리를 사용한다 */
  const sutda2BottomBar = needsOpenCard ? (
    <div className="flex w-full items-center justify-center gap-3 rounded-xl border border-gold/25 bg-black/55 px-4 py-3">
      <span className="font-display text-[13px] tracking-widest text-gold">공개패 선택</span>
      <span className="text-[12px] text-foreground/80">
        내 패를 눌러 상대에게 보여줄 1장을 고르세요. (전원 선택 후 동시 공개)
      </span>
      <ServerCountdownPanel
        deadline={server?.turnDeadline ?? null}
        serverNow={server?.serverNow ?? null}
        suffixLabel="자동 공개까지"
      />
    </div>
  ) : openCardWaiting ? (
    <div className="flex w-full items-center justify-center gap-3 rounded-xl border border-gold/25 bg-black/55 px-4 py-3">
      <span className="font-display text-[13px] tracking-widest text-gold">공개패 선택 완료</span>
      <span className="text-[12px] text-foreground/80">
        {openCardPending > 0
          ? `남은 ${openCardPending}명의 선택 대기 중`
          : "곧 동시에 공개됩니다."}
      </span>
      <ServerCountdownPanel
        deadline={server?.turnDeadline ?? null}
        serverNow={server?.serverNow ?? null}
        suffixLabel="자동 공개까지"
      />
    </div>
  ) : needsSelection ? (
    <div className="flex w-full items-center justify-center gap-3 rounded-xl border border-gold/25 bg-black/55 px-4 py-3">
      <span className="font-display text-[13px] tracking-widest text-gold">최종 승부패 선택</span>
      <span className="text-[12px] text-foreground/80">
        {pickedCards.length}/2 선택 · 내 패를 눌러 승부할 2장을 고르세요.
      </span>
      <Button
        variant="gold"
        size="sm"
        disabled={busy || pickedCards.length !== 2}
        onClick={() => {
          if (pickedCards.length !== 2) return;
          void confirmSelection([pickedCards[0]!, pickedCards[1]!]);
        }}
      >
        이 패로 승부
      </Button>
    </div>
  ) : !server || finished ? (
      <div className="w-full">
        <ReadyBar
          seatedCount={seatedCount}
          readyCount={readyCount}
          iAmReady={iAmReady}
          readyRequired={readyRequired}
          starting={allReady}
          disabled={busy}
          onToggle={toggleReady}
        />
      </div>
    ) : (
      <div className="w-full">
        <GameActionBar
          options={options}
          myTurn={isMyTurn && !actionsLocked}
          disabled={busy}
          allInLocked={
            !!server && server.status !== "finished" && !options.some((o) => o.action === "all_in")
          }
          onAction={(a: BetAction) => void act(a)}
        />
      </div>
    );

  /** 2장 섯다 화면 — [게임 STAGE][우측 채팅] 2열. 게임판 아래 추가 패널 없음 */
  const sutda2Screen = (
    <div
      ref={screenRef}
      className="grid min-h-0 gap-2.5 overflow-hidden bg-background p-2.5"
      style={{
        height: "100vh",
        gridTemplateColumns: sidebarOpen ? "minmax(0, 1fr) 320px" : "minmax(0, 1fr)",
      }}
    >
      <div className="h-full min-h-0 min-w-0">
        <GameTableLayout
          fill
          cardMode={mode === "sutda3" ? 3 : 2}
          {...(mode === "sutda3" ? { cleanLayout: SUTDA3_LAYOUT } : {})}
          selectable={needsSelection || needsOpenCard}
          selectedCards={needsOpenCard ? [] : pickedCards}
          handPreview={handPreviewLabel}
          onToggleCard={(card) => {
            if (needsOpenCard) {
              void chooseOpenCard(card);
              return;
            }
            if (!needsSelection) return;
            setPickedCards((prev) =>
              prev.includes(card)
                ? prev.filter((c) => c !== card)
                : prev.length >= 2
                  ? [prev[1]!, card]
                  : [...prev, card],
            );
          }}
          topControls={sutda2TopControls}
          bottomBar={sutda2BottomBar}
          roomInfo={{
            roomNumber,
            gradeLabel: GAME_MODE_LABEL[mode],
            baseBet,
            seatedCount,
            maxPlayers,
          }}
          phaseBadge={phaseLabel}
          turnNotice={
            !server || finished
              ? ""
              : needsOpenCard
                ? "상대에게 보여줄 공개패 1장을 선택하세요. (전원 선택 후 동시 공개)"
                : openCardWaiting
                  ? openCardPending > 0
                    ? `공개패 선택 완료 · 남은 ${openCardPending}명 대기 중`
                    : "공개패 선택 완료 · 곧 동시에 공개됩니다."
                : needsSelection
                  ? "승부할 패 2장을 고르세요."
                  : server.phase === "SQUEEZING"
                ? needsSqueeze
                  ? "두 번째 패를 확인하세요."
                  : "상대의 패 확인을 기다리는 중입니다."
                : isMyTurn
                  ? "내 차례입니다."
                  : "상대의 선택을 기다리는 중입니다."
          }
          openCards={openCards}
          timerBadge={
            !server || finished ? null : needsOpenCard || openCardWaiting ? (
              <ServerCountdownPanel
                deadline={server.turnDeadline ?? null}
                serverNow={server.serverNow ?? null}
                suffixLabel="자동 공개까지"
              />
            ) : ["BETTING", "FIRST_BETTING", "FINAL_BETTING"].includes(server.phase) ? (
              <ServerCountdownPanel
                deadline={server.turnDeadline ?? null}
                serverNow={server.serverNow ?? null}
                {...(isMyTurn ? { prefix: "내 턴" } : {})}
                suffixLabel="자동 다이까지"
              />
            ) : null
          }
          fx={<Sutda2CoinFx server={server} />}
          state={engineState}
          roomSeats={roomSeats}
          mySeat={mySeat}
          cardCounts={cardCounts}
          cardIntegrityOk={server?.cardIntegrityOk ?? true}
          rematch={!!server?.rematch}
          pots={sidePots(server)}
          isRematchRound={!!server?.isRematchRound}
          carryIn={Number(server?.carryIn ?? 0)}
          myCardVisuals={myCardVisuals}
          onMyCardRevealed={completeSqueeze}
          reactions={reactions}
          waiting={!server || finished}
          callAmount={options.find((o) => o.action === "call")?.amount ?? null}
          myContribution={server?.myContribution ?? null}
          potSumOk={server?.potSumOk ?? true}
          revealed={showdownRevealed}
          loadouts={loadouts.data ?? {}}
          maxPlayers={maxPlayers}
          dealerSeat={engineState?.dealerSeat ?? null}
          {...(canSelectSeat ? { onSelectSeat: (n: number) => void onSelectSeat(n) } : {})}
          {...(activeRound
            ? { seatSelectReason: "게임 진행 중에는 좌석을 이동할 수 없습니다." }
            : {})}
        />
      </div>

      {sidebarOpen && (
        <div className="h-full min-h-0 min-w-0">
          <Sutda2SidePanel
            roomId={roomId}
            userId={user.id}
            nickname={profile?.nickname ?? "나"}
            server={server}
            roomSeats={roomSeats}
            resultLines={resultLogLines}
            className="h-full"
          />
        </div>
      )}
    </div>
  );

  /** 공용 모달 — 사운드 믹서 / 나가기 확인 / 퇴장 안내 (2장·3장 공통, 중복 렌더 없음) */
  const sharedOverlays = (
    <>
      {/* 상대 전원 다이 승리 — 승자에게만 표시되는 공개 선택 모달 (서버 PENDING 기준) */}
      {needsFoldWinChoice && (
        <SutdaRevealChoiceModal
          deadline={server?.foldWinDeadline ?? null}
          busy={busy}
          onChoose={(reveal) => void chooseFoldWinReveal(reveal)}
        />
      )}
      {/* 사운드 믹서 — 게임판 위 blocking 없이 별도 모달로만 열린다 */}
      {showMixer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="panel-surface gold-frame w-[min(420px,92%)] rounded-2xl px-5 py-4">
            <p className="font-display text-sm text-gold">사운드 볼륨</p>
            <div className="mt-3 space-y-2">
              {(
                [
                  ["전체", volume, (v: number) => { setVolume(v); setSoundVolume(v); }],
                  ["효과음", sfxVol, (v: number) => { setSfxVol(v); setSfxVolume(v); }],
                  ["보이스", voiceVol, (v: number) => { setVoiceVol(v); setVoiceVolume(v); }],
                ] as [string, number, (v: number) => void][]
              ).map(([label, value, onSet]) => (
                <label key={label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="w-12">{label}</span>
                  <input
                    aria-label={`${label} 볼륨`}
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(value * 100)}
                    onChange={(e) => onSet(Number(e.target.value) / 100)}
                    className="h-1 flex-1 accent-[var(--gold)]"
                  />
                  <span className="w-8 text-right text-foreground/70">{Math.round(value * 100)}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="table" size="sm" onClick={() => playSoundPreview()}>
                테스트
              </Button>
              <Button variant="gold" size="sm" onClick={() => setShowMixer(false)}>
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}

      {leaveAsk && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="panel-surface gold-frame w-[min(420px,92%)] rounded-2xl px-6 py-5 text-center">
            <p className="text-sm text-foreground">
              현재 판이 진행 중입니다. 현재 판 종료 후 게임방에서 나갑니다.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <Button variant="gold" size="sm" disabled={busy} onClick={() => void handleLeave()}>
                나가기 예약
              </Button>
              <Button variant="table" size="sm" onClick={() => setLeaveAsk(false)}>
                취소
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 퇴장 안내 — 사유별 문구를 분리한다 (근거 없으면 ZERO_BALANCE 로 단정하지 않는다) */}
      {kickNotice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
          <div className="panel-surface gold-frame w-[min(420px,92%)] rounded-2xl px-6 py-5 text-center">
            <p className="font-display text-lg text-gold">게임방 퇴장</p>
            <p className="mt-2 text-sm text-foreground">
              {kickNotice.reason === "ROOM_CLOSED"
                ? "이 게임방은 종료되었습니다. 로비에서 다시 입장해 주세요."
                : kickNotice.reason === "USER_LEAVE" || kickNotice.reason === "LEAVE_PENDING"
                  ? "게임방에서 정상적으로 퇴장했습니다."
                  : kickNotice.reason === "ZERO_BALANCE"
                    ? "보유 포인트가 없어 게임방에서 퇴장되었습니다."
                    : kickNotice.reason === "LONG_ABSENCE"
                      ? "장시간 미접속으로 게임방에서 퇴장되었습니다."
                      : kickNotice.reason === "ADMIN_KICK"
                        ? "관리자에 의해 게임방에서 퇴장되었습니다."
                        : kickNotice.reason === "MIN_POINTS"
                          ? "보유 포인트가 방 최소 입장 포인트보다 적어 퇴장되었습니다."
                          : "게임방에서 퇴장되었습니다."}

            </p>
            {kickNotice.reason === "MIN_POINTS" && (
              <p className="mt-1 text-sm text-gold">
                해당 방의 최소 입장 포인트는 {formatPoints(kickNotice.min)}입니다.
              </p>
            )}
            {(kickNotice.reason === "MIN_POINTS" || kickNotice.reason === "ZERO_BALANCE") && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                현재 보유 {formatPoints(kickNotice.points)} · 포인트 충전 후 다시 입장해 주세요.
              </p>
            )}
            <Button variant="gold" className="mt-4" onClick={() => void navigate({ to: "/rooms" })}>
              로비로 이동
            </Button>
          </div>
        </div>
      )}
    </>
  );

  /**
   * 2장 섯다 오버레이 — 결과창(표시 전용) + 공용 모달.
   * 전체화면에서는 게임 wrapper 만 fullscreen element 이므로 그 내부로 포털한다.
   */
  const sutda2Overlays = (
    <FullscreenPortal>
      {resultView && (
        <div className="pointer-events-none fixed inset-0 z-[90]">
          <Sutda2ResultOverlay
            view={resultView}
            {...(nextRoundIn !== null
              ? { nextNotice: `${nextRoundIn}초 후 다음 판이 시작됩니다.` }
              : {})}
          />

        </div>
      )}
      {sharedOverlays}
    </FullscreenPortal>
  );

  if (mode === "sutda2" || mode === "sutda3") {
    /**
     * 2장 섯다 게임방은 항상 viewport 전용 화면이다.
     * 상단 로고/방정보/컨트롤은 stage 내부에 있으므로 글로벌 헤더 높이를 빼지 않는다.
     */
    return (
      <AppShell chrome={false} fitViewport>
        {sutda2Screen}
        {sutda2Overlays}
      </AppShell>
    );
  }

  return (
    <AppShell chrome={!gameMode} fitViewport={twoCardFitMode}>
      <div
        ref={screenRef}
        className={twoCardFitMode ? "h-full min-h-0 overflow-hidden bg-background" : "bg-background"}
      >
      {/* 1600x900 고정 스테이지 — 창모드/전체화면에서 배치가 바뀌지 않고 동일 비율로 확대된다 */}
      <GameStage
        className={gameMode ? "mt-0" : "mt-1"}
        bottomGap={gameMode ? 2 : 8}
        fitHeight={twoCardFitMode}
      >
        <div
          className="grid h-full w-full"
          style={{
            padding: STAGE_PAD,
            gridTemplateRows: `${TOP_BAR_H}px ${BODY_H}px`,
            rowGap: ZONE_GAP,
          }}
        >
          {/* ============ A. TOP BAR ============ */}
          <header className="flex min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-gold/20 bg-black/45 px-3">
            <h1 className="text-gold-plate truncate font-display text-lg">
              {room.data?.title ?? "테이블"}
            </h1>
            {roomNumber !== null && (
              <span className="shrink-0 rounded-full bg-gold/12 px-2 py-0.5 font-display text-[11px] text-gold">
                #{roomNumber}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
              {GAME_MODE_LABEL[mode]} · 기본 {formatPoints(baseBet)}
            </span>
            <span className="shrink-0 truncate text-[11px] text-muted-foreground">
              {seatedCount}명 착석{server ? ` · ${server.roundNumber}번째 판` : ""}
              {isHost ? " · 방장" : ""}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                realtimeOk ? "bg-emerald-500/10 text-emerald-300" : "bg-destructive/15 text-destructive"
              }`}
            >
              {realtimeOk ? "실시간 연결됨" : "재연결 중"}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Button
                variant={soundOn ? "goldOutline" : "table"}
                size="sm"
                onClick={() => {
                  const next = !soundOn;
                  setSoundOn(next);
                  setSoundEnabled(next);
                  if (next) playSoundPreview();
                }}
              >
                사운드 {soundOn ? "ON" : "OFF"}
              </Button>
              <Button variant="table" size="sm" onClick={() => setShowMixer(true)}>
                볼륨
              </Button>
              <Button
                variant={gameMode ? "goldOutline" : "table"}
                size="sm"
                onClick={() => setGameMode((v) => !v)}
              >
                게임모드 {gameMode ? "ON" : "OFF"}
              </Button>
              <Button variant="table" size="sm" onClick={() => void fullscreen.toggle()}>
                {fullscreen.active ? "창모드" : "전체화면"}
              </Button>
              <Button
                variant={autoWinReaction ? "goldOutline" : "table"}
                size="sm"
                onClick={() => toggleAutoWinReaction(!autoWinReaction)}
              >
                리액션 {autoWinReaction ? "ON" : "OFF"}
              </Button>
              <Button variant="table" size="sm" onClick={() => setSidebarOpen((v) => !v)}>
                {sidebarOpen ? "패널 접기" : "패널 열기"}
              </Button>
              {myLeavePending ? (
                <Button
                  variant="goldOutline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleCancelLeave()}
                >
                  예약 취소
                </Button>
              ) : (
                <Button
                  variant="table"
                  size="sm"
                  disabled={busy}
                  onClick={() => (inProgress ? setLeaveAsk(true) : void handleLeave())}
                >
                  나가기
                </Button>
              )}
            </div>
          </header>

          {/* ============ BODY : 메인 게임 컬럼 + compact sidebar ============ */}
          <div
            className="grid min-h-0"
            style={{
              gridTemplateColumns: sidebarOpen ? `minmax(0,1fr) ${SIDEBAR_W}px` : "minmax(0,1fr)",
              columnGap: ZONE_GAP,
            }}
          >
            <div
              className="grid min-w-0"
              style={{
                gridTemplateRows: `${TABLE_H}px ${DECISION_H}px ${ACTION_H}px ${STATUS_H}px`,
                rowGap: ZONE_GAP,
              }}
            >
              {/* ============ B. GAME TABLE ZONE ============ */}
              <GameTableLayout
                cardMode={mode === "sutda3" ? 3 : 2}
                roomInfo={{
                  roomNumber,
                  gradeLabel: GAME_MODE_LABEL[mode],
                  baseBet,
                  seatedCount,
                  maxPlayers,
                }}
                phaseBadge={phaseLabel}
                turnNotice={
                  !server || finished
                    ? ""
                    : isMyTurn
                      ? "내 차례입니다."
                      : "상대의 선택을 기다리는 중입니다."
                }
                state={engineState}


                roomSeats={roomSeats}
                mySeat={mySeat}
                cardCounts={cardCounts}
                cardIntegrityOk={server?.cardIntegrityOk ?? true}
                rematch={!!server?.rematch}
                pots={sidePots(server)}
                isRematchRound={!!server?.isRematchRound}
                carryIn={Number(server?.carryIn ?? 0)}
                myCardVisuals={myCardVisuals}
                onMyCardRevealed={completeSqueeze}
                reactions={reactions}
                waiting={!server || finished}
                callAmount={options.find((o) => o.action === "call")?.amount ?? null}
                myContribution={server?.myContribution ?? null}
                potSumOk={server?.potSumOk ?? true}
                revealed={showdownRevealed}
                height={TABLE_H}
                loadouts={loadouts.data ?? {}}
                maxPlayers={maxPlayers}
                dealerSeat={engineState?.dealerSeat ?? null}
                {...(canSelectSeat ? { onSelectSeat: (n: number) => void onSelectSeat(n) } : {})}
                {...(activeRound
                  ? { seatSelectReason: "게임 진행 중에는 좌석을 이동할 수 없습니다." }
                  : {})}
              />

              {/* ============ C. DECISION ZONE ============ */}
              <DecisionZone title={decisionTitle} height={DECISION_H}>
                {decisionBody}
              </DecisionZone>

              {/* ============ D. ACTION BAR ============ */}
              <div data-action-bar className="min-h-0 overflow-hidden">
                <GameActionBar
                  options={options}
                  myTurn={isMyTurn && !actionsLocked}
                  disabled={busy}
                  allInLocked={
                    !!server &&
                    server.status !== "finished" &&
                    !options.some((o) => o.action === "all_in")
                  }
                  onAction={(a: BetAction) => void act(a)}
                />
              </div>

              {/* ============ E. STATUS BAR ============ */}
              <GameStatusBar
                className="min-h-0 py-1"
                phaseLabel={phaseLabel}
                deadline={inProgress ? server?.turnDeadline ?? null : null}
                paused={!!server && !server.cardIntegrityOk}
                message={
                  !server
                    ? seatedCount < 2
                      ? "상대 플레이어를 기다리는 중입니다."
                      : allReady
                        ? "전원 준비 완료 · 곧 판이 시작됩니다."
                        : "착석자 전원이 준비하면 판이 시작됩니다."
                    : !server.cardIntegrityOk
                      ? "카드 상태를 확인하는 중입니다. 잠시만 기다려 주세요."
                      : finished
                        ? nextRoundIn !== null
                          ? `판이 종료되었습니다. ${nextRoundIn}초 후 다음 판이 시작됩니다.`
                          : "판이 종료되었습니다."
                        : isMyTurn
                          ? "내 차례입니다. 행동을 선택하세요."
                          : needsSqueeze
                            ? "내 패를 확인하세요."
                            : needsSelection
                              ? "승부패 2장을 선택하세요."
                              : "상대 차례를 기다리는 중입니다…"
                }
              />
            </div>

            {/* ============ compact SIDEBAR (족보 / 채팅 / 게임로그 / 안내) ============ */}
            {sidebarOpen && (
              <div className="min-h-0">
                <GamePanel
                  roomId={roomId}
                  userId={user.id}
                  nickname={profile?.nickname ?? "나"}
                  log={engineState?.log ?? []}
                  onReaction={fireReaction}
                  className="h-full"
                />

              </div>
            )}
          </div>
        </div>
      </GameStage>
      </div>

      <FullscreenPortal>{sharedOverlays}</FullscreenPortal>
    </AppShell>
  );
}
