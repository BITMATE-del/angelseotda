import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadTelegramSdk } from "@/lib/telegram/miniApp";

interface AngelAccount {
  id: string;
  telegramId: string;
  nickname: string;
  balance: string;
  status: string;
}
interface PreviewRoom { id: string; mode: string; title: string; baseBet: string; seats: number; joined: boolean; }
interface PreviewSeat { number: number; nickname: string; isMe: boolean; isOwner: boolean; }
interface PreviewRoomDetail { id: string; mode: string; title: string; status: string; baseBet: string; seats: PreviewSeat[]; }
type Screen = "checking" | "outside" | "ready" | "unavailable" | "error";

/**
 * Staging-only Telegram sign-in preview.
 * Deliberately separated from the Supabase-dependent game UI:
 * successful login does not imply game, wallet or deposit readiness.
 */
export function RailwayTelegramPreview() {
  const [screen, setScreen] = useState<Screen>("checking");
  const [account, setAccount] = useState<AngelAccount | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<PreviewRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomDetail, setRoomDetail] = useState<PreviewRoomDetail | null>(null);
  const [lobbyMessage, setLobbyMessage] = useState("");
  const [roomTitle, setRoomTitle] = useState("엔젤 연습방");
  const [roomMode, setRoomMode] = useState<"SUTDA2" | "SUTDA3" | "DORI">("SUTDA2");
  const [roomBaseBet, setRoomBaseBet] = useState("1000");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const authenticate = async () => {
      const webapp = await loadTelegramSdk();
      if (!active) return;
      if (!webapp?.initData) {
        setScreen("outside");
        return;
      }
      webapp.ready();
      webapp.expand();
      try {
        const check = await fetch("/api/public/railway-auth", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (check.status === 404) {
          if (active) setScreen("unavailable");
          return;
        }
        if (check.ok) {
          const current = await check.json() as { account?: AngelAccount };
          if (current.account) {
            if (active) { setAccount(current.account); setScreen("ready"); }
            return;
          }
        }
        const login = await fetch("/api/public/railway-auth", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: webapp.initData }),
        });
        if (login.status === 404) {
          if (active) setScreen("unavailable");
          return;
        }
        if (!login.ok) throw new Error("텔레그램 인증에 실패했습니다. 미니앱을 닫고 다시 열어 주세요.");
        const response = await login.json() as { ok?: boolean; account?: AngelAccount };
        if (!response.ok || !response.account) throw new Error("로그인 결과를 확인할 수 없습니다.");
        if (active) { setAccount(response.account); setScreen("ready"); }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setMessage(error instanceof Error ? error.message : "로그인 연결에 실패했습니다.");
        setScreen("error");
      }
    };
    void authenticate();
    return () => { active = false; controller.abort(); };
  }, []);

  async function refreshRooms() {
    try {
      const response = await fetch("/api/public/railway-rooms", {
        credentials: "same-origin", cache: "no-store",
      });
      if (!response.ok) throw new Error("대기방 목록을 가져오지 못했습니다.");
      const result = await response.json() as { rooms?: PreviewRoom[] };
      setRooms(result.rooms ?? []);
    } catch (error) {
      setLobbyMessage(error instanceof Error ? error.message : "대기방 조회 실패");
    }
  }

  async function refreshRoomDetail(roomId: string) {
    try {
      const response = await fetch(`/api/public/railway-rooms?roomId=${encodeURIComponent(roomId)}`, {
        credentials: "same-origin", cache: "no-store",
      });
      if (!response.ok) throw new Error("방 좌석을 확인할 수 없습니다.");
      const data = await response.json() as { room: PreviewRoomDetail };
      setRoomDetail(data.room);
      setSelectedRoomId(roomId);
    } catch (error) {
      setRoomDetail(null);
      setLobbyMessage(error instanceof Error ? error.message : "좌석 조회 실패");
    }
  }

  useEffect(() => {
    if (screen !== "ready") return;
    void refreshRooms();
  }, [screen]);

  async function roomAction(payload: Record<string, string>) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/public/railway-rooms", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("방 생성·입장에 실패했습니다.");
      const data = await response.json() as { roomId?: string; seatNumber?: number };
      setLobbyMessage(payload.action === "leave"
        ? "대기방에서 나왔습니다."
        : `대기방에 ${data.seatNumber ?? "-"}번 좌석으로 입장했습니다. 게임은 아직 시작할 수 없습니다.`);
      await refreshRooms();
      if (payload.action === "leave") {
        setSelectedRoomId(null);
        setRoomDetail(null);
      } else if (payload.action === "join" && payload.roomId) {
        await refreshRoomDetail(payload.roomId);
      } else if (payload.action === "create" && data.roomId) {
        await refreshRoomDetail(data.roomId);
      }
    } catch (error) {
      setLobbyMessage(error instanceof Error ? error.message : "입장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/public/railway-auth", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("로그아웃 실패");
      setAccount(null);
      setScreen("outside");
    } catch {
      setMessage("로그아웃에 실패했습니다. 다시 시도해 주세요.");
      setScreen("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-8">
      <section className="panel-surface gold-frame w-full max-w-sm space-y-5 rounded-2xl p-6 text-center">
        <img src="/brand/angel-sutda-logo.png" alt="엔젤섯다" className="mx-auto h-16 w-auto" />
        <h1 className="font-display text-xl text-gold">엔젤섯다</h1>
        {screen === "checking" && <p role="status" className="text-sm">텔레그램 인증 확인 중…</p>}
        {screen === "outside" && (
          <>
            <p className="text-sm">텔레그램 앱에서 엔젤섯다 미니앱으로 접속해 주세요.</p>
            <a className="text-sm text-gold underline" href="https://t.me/angelsda_bot" rel="noopener noreferrer">
              텔레그램 봇 열기
            </a>
          </>
        )}
        {screen === "unavailable" && (
          <p role="status" className="text-sm">테스트 로그인 기능이 아직 활성화되지 않았습니다.</p>
        )}
        {screen === "error" && <p role="alert" className="text-sm text-crimson">{message}</p>}
        {screen === "ready" && account && (
          <>
            <p className="text-lg font-semibold">{account.nickname}님, 인증이 완료됐습니다.</p>
            <p className="text-sm text-muted-foreground">계정 잔액</p>
            <p className="font-display text-2xl text-gold">{account.balance} P</p>
            <p className="text-sm text-muted-foreground">
              현재는 대기방 입장 시험 단계입니다. 카드·베팅·충전·출금은 아직 활성화되지 않았습니다.
            </p>
            <div className="space-y-3 rounded-xl border border-white/10 p-3 text-left">
              <h2 className="text-center font-semibold">테스트 대기방</h2>
              <label className="block text-xs">게임 종류
                <select value={roomMode} onChange={(e) => setRoomMode(e.target.value as typeof roomMode)}
                  className="mt-1 w-full rounded-md border border-white/20 bg-background p-2">
                  <option value="SUTDA2">2장 섯다</option>
                  <option value="SUTDA3">3장 섯다</option>
                  <option value="DORI">도리짓고땡</option>
                </select>
              </label>
              <label className="block text-xs">방 이름
                <input value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)}
                  maxLength={80} className="mt-1 w-full rounded-md border border-white/20 bg-background p-2" />
              </label>
              <label className="block text-xs">표시용 기본 베팅액 (실제 차감 없음)
                <input value={roomBaseBet} onChange={(e) => setRoomBaseBet(e.target.value)}
                  inputMode="decimal" className="mt-1 w-full rounded-md border border-white/20 bg-background p-2" />
              </label>
              <Button className="w-full" variant="gold" disabled={busy}
                onClick={() => void roomAction({ action: "create", mode: roomMode,
                  title: roomTitle, baseBet: roomBaseBet })}>
                대기방 만들기
              </Button>
              <Button className="w-full" variant="table" disabled={busy}
                onClick={() => void refreshRooms()}>목록 새로고침</Button>
              {lobbyMessage && <p role="status" className="text-xs">{lobbyMessage}</p>}
              {rooms.length === 0 && <p className="text-center text-xs text-muted-foreground">현재 열린 테스트 대기방이 없습니다.</p>}
              {rooms.map((room) => <div key={room.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 p-2">
                <div className="min-w-0 text-xs">
                  <p className="truncate font-semibold">{room.title}</p>
                  <p>{room.mode} · {room.seats}명 · 기본 {room.baseBet}P</p>
                </div>
                <Button variant="table" disabled={busy || room.joined}
                  onClick={() => void roomAction({ action: "join", roomId: room.id })}>
                  {room.joined ? "입장됨" : "입장"}
                </Button>
                {room.joined && (
                  <Button variant="table" disabled={busy}
                    onClick={() => void refreshRoomDetail(room.id)}>좌석 보기</Button>
                )}
              </div>)}
              {selectedRoomId && roomDetail && (
                <div className="space-y-2 rounded-xl border border-white/20 p-3">
                  <h3 className="text-sm font-semibold">{roomDetail.title} · 대기실</h3>
                  <p className="text-xs text-muted-foreground">
                    카드 공개·게임 시작·베팅은 아직 비활성화되어 있습니다.
                  </p>
                  {roomDetail.seats.map(seat => (
                    <div key={seat.number} className="flex justify-between text-xs">
                      <span>{seat.number}번 좌석 · {seat.nickname}{seat.isMe ? " (나)" : ""}</span>
                      <span>{seat.isOwner ? "방장" : "대기 중"}</span>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="table" disabled={busy}
                      onClick={() => void refreshRoomDetail(selectedRoomId)}>좌석 새로고침</Button>
                    <Button variant="table" disabled={busy || !roomDetail.seats.some(s => s.isMe)}
                      onClick={() => void roomAction({ action: "leave", roomId: selectedRoomId })}>
                      방 나가기
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <Button className="h-11 w-full" variant="table" onClick={() => void signOut()} disabled={busy}>
              {busy ? "로그아웃 중…" : "로그아웃"}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
