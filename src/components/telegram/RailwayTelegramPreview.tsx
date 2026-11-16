import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadTelegramSdk } from "@/lib/telegram/miniApp";
import { doriBestMake } from "@/lib/game/dori/doriRules";

interface RailwayWalletView {
  balance:string;locked:string;available:string;
  transactions:Array<{id:string;amount:string;type:string;createdAt:string}>;
  depositEnabled:false;withdrawEnabled:false;settlementEnabled:false;
}
interface AngelAccount {
  id: string;
  telegramId: string;
  nickname: string;
  balance: string;
  status: string;
}
interface PreviewRoom { id: string; mode: string; title: string; baseBet: string; seats: number; joined: boolean; }
interface PreviewSeat { number: number; nickname: string; isMe: boolean; isOwner: boolean; }
interface PreviewRoomDetail {
  id: string; mode: string; title: string; status: string;
  ownerId: string; baseBet: string; seats: PreviewSeat[];
}
interface PreparedRound {
  id: string; phase: "PREPARING" | "DEALT_PREVIEW"; roundNumber: number;
  playerCount: number; pot: string; realGameStarted: false;
}
interface PrivatePreview {
  roundId: string; phase: "DEALT_PREVIEW"; mySeat: number;
  turnSeat: number; myCards: string[]; playerCount: number;
  acceptsBets: false; passes: number; didPass: boolean;
  previewComplete: boolean; realGameStarted: false;
}
interface MyFinalChoice { mode:string;selected:string[];previewOnly:true; }
type PreviewOutcome={
  status:"WAITING_FOR_PREVIEW_TURNS"|"BLOCKED"|"PREVIEW_RESULT_ONLY";
  passed?:number;players?:number;reason?:string;winnerSeats?:number[];
  realSettlement:false;
};
interface BetDryRun {
  previewOnly: true; canExecute: false; monetaryEffects: false;
  isMyTurn: boolean;
  sample: { pot:string; currentBet:string; stageBet:string; hypotheticalBalance:string };
  actions: Array<{ action:string; enabled:boolean; sampleAdditionalAmount:string }>;
}
type Screen = "checking" | "outside" | "ready" | "unavailable" | "error";

/**
 * Staging-only Telegram sign-in preview.
 * Deliberately separated from the Supabase-dependent game UI:
 * successful login does not imply game, wallet or deposit readiness.
 */
export function RailwayTelegramPreview() {
  const [screen, setScreen] = useState<Screen>("checking");
  const [account, setAccount] = useState<AngelAccount | null>(null);
  const [walletView,setWalletView]=useState<RailwayWalletView | null>(null);
  const [walletError,setWalletError]=useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<PreviewRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomDetail, setRoomDetail] = useState<PreviewRoomDetail | null>(null);
  const [preparedRound, setPreparedRound] = useState<PreparedRound | null>(null);
  const [privatePreview, setPrivatePreview] = useState<PrivatePreview | null>(null);
  const [betPreview, setBetPreview] = useState<BetDryRun | null>(null);
  const [finalChoice,setFinalChoice] = useState<MyFinalChoice | null>(null);
  const [outcome,setOutcome] = useState<PreviewOutcome | null>(null);
  const [chosenCards,setChosenCards] = useState<string[]>([]);
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

  async function refreshOwnWallet() {
    try {
      const res=await fetch("/api/public/railway-wallet",{credentials:"same-origin",cache:"no-store"});
      if(!res.ok) throw new Error("Railway 지갑 정보를 가져오지 못했습니다.");
      const payload=await res.json() as {wallet:RailwayWalletView};
      setWalletView(payload.wallet);
      setWalletError("");
    }catch(e){setWalletError(e instanceof Error?e.message:"지갑 조회 실패");}
  }

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
      const data = await response.json() as {
        room: PreviewRoomDetail; preparedRound: PreparedRound | null;
        privatePreview: PrivatePreview | null; betPreview: BetDryRun | null;
        finalChoice: MyFinalChoice | null;outcome:PreviewOutcome | null;
      };
      setRoomDetail(data.room);
      setPreparedRound(data.preparedRound);
      setPrivatePreview(data.privatePreview);
      setBetPreview(data.betPreview);
      setFinalChoice(data.finalChoice);
      setOutcome(data.outcome);
      setChosenCards(data.finalChoice?.selected ?? []);
      setSelectedRoomId(roomId);
    } catch (error) {
      setRoomDetail(null);
      setPreparedRound(null);
      setPrivatePreview(null);
      setBetPreview(null);
      setFinalChoice(null);
      setOutcome(null);
      setChosenCards([]);
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
      setLobbyMessage(payload['action'] === "leave"
        ? "대기방에서 나왔습니다."
        : `대기방에 ${data.seatNumber ?? "-"}번 좌석으로 입장했습니다. 게임은 아직 시작할 수 없습니다.`);
      await refreshRooms();
      if (payload['action'] === "leave") {
        setSelectedRoomId(null);
        setRoomDetail(null);
        setPreparedRound(null);
        setPrivatePreview(null);
        setBetPreview(null);
        setFinalChoice(null);
        setOutcome(null);
        setChosenCards([]);
      } else if (payload['action'] === "join" && payload['roomId']) {
        await refreshRoomDetail(payload['roomId']);
      } else if (payload['action'] === "create" && data.roomId) {
        await refreshRoomDetail(data.roomId);
      } else if (payload['action'] === "prepare" && payload['roomId']) {
        await refreshRoomDetail(payload['roomId']);
        setLobbyMessage("라운드 준비가 완료됐습니다. 실제 베팅과 정산은 아직 불가합니다.");
      } else if (payload['action'] === "dealPreview" && payload['roomId']) {
        await refreshRoomDetail(payload['roomId']);
        setLobbyMessage("테스트 카드가 비공개로 배분됐습니다. 실제 게임 시작은 아닙니다.");
      } else if (payload['action'] === "previewPass" && payload['roomId']) {
        await refreshRoomDetail(payload['roomId']);
        setLobbyMessage("테스트 턴을 넘겼습니다. 실제 베팅은 이루어지지 않았습니다.");
      }
    } catch (error) {
      setLobbyMessage(error instanceof Error ? error.message : "입장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function submitFinalHand() {
    if(busy || !selectedRoomId || finalChoice || !roomDetail) return;
    setBusy(true);
    try{
      const response=await fetch("/api/public/railway-rooms",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({action:"chooseFinal",roomId:selectedRoomId,chosen:chosenCards}),
      });
      if(!response.ok)throw new Error("선택한 패를 확인할 수 없습니다. 카드 선택을 확인해 주세요.");
      await refreshRoomDetail(selectedRoomId);
      setLobbyMessage("최종 패 선택이 서버에 저장됐습니다. 실제 정산은 진행되지 않습니다.");
    }catch(error){
      setLobbyMessage(error instanceof Error?error.message:"최종 패 선택 실패");
    }finally{setBusy(false);}
  }

  function toggleFinalCard(cardId:string){
    if(finalChoice || !roomDetail)return;
    const max=roomDetail.mode==="DORI"?3:2;
    setChosenCards(old=>old.includes(cardId)?old.filter(x=>x!==cardId):
      old.length<max?[...old,cardId]:old);
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
            <div className="space-y-2 rounded-lg border border-white/10 p-3 text-left">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Railway 지갑</h2>
                <Button variant="table" size="sm" disabled={busy}
                  onClick={()=>void refreshOwnWallet()}>내역 조회</Button>
              </div>
              {walletError && <p role="alert" className="text-xs">{walletError}</p>}
              {walletView && (
                <>
                  <p className="text-xs">총잔액 {walletView.balance}P · 잠금 {walletView.locked}P · 사용가능 {walletView.available}P</p>
                  <p className="text-xs text-muted-foreground">충전·출금·정산은 현재 비활성화되어 있습니다.</p>
                  {walletView.transactions.length===0 ?
                    <p className="text-xs text-muted-foreground">거래 기록이 없습니다.</p> :
                    walletView.transactions.map(tx=>(
                      <div className="flex justify-between gap-2 text-xs" key={tx.id}>
                        <span>{tx.type}</span><span>{tx.amount}P</span>
                      </div>
                    ))}
                </>
              )}
            </div>
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
                  {preparedRound?.phase === "PREPARING" &&
                    roomDetail.ownerId === account.id && (
                    <Button variant="gold" className="w-full" disabled={busy}
                      onClick={() => void roomAction({ action: "dealPreview", roomId: selectedRoomId })}>
                      비공개 카드 배분 시험 (포인트 차감 없음)
                    </Button>
                  )}
                  {privatePreview && (
                    <div className="space-y-2 rounded-lg border border-white/20 p-3">
                      <p className="text-xs font-semibold">내 카드 — {privatePreview.mySeat}번 좌석</p>
                      <div className="flex flex-wrap gap-2">
                        {privatePreview.myCards.map((id, i) => (
                          <img key={i} src={`/cards/hwatu/base/${id}.png`} alt={`내 카드 ${i + 1}`}
                            className="h-24 w-auto rounded-md" />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        현재 턴: {privatePreview.turnSeat}번 · 통과 {privatePreview.passes}/{privatePreview.playerCount}명
                      </p>
                      {privatePreview.previewComplete ? (
                        <p role="status" className="text-xs">모든 참가자의 테스트 턴이 완료됐습니다.</p>
                      ) : privatePreview.mySeat === privatePreview.turnSeat && !privatePreview.didPass ? (
                        <Button variant="gold" disabled={busy} className="w-full"
                          onClick={() => void roomAction({
                            action: "previewPass", roomId: selectedRoomId,
                            requestId: crypto.randomUUID(),
                          })}>
                          테스트 턴 넘기기 (포인트 변동 없음)
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">다른 참가자의 테스트 턴을 기다리는 중입니다.</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        다른 회원 카드는 공개되지 않습니다. 베팅과 정산은 비활성화되어 있습니다.
                      </p>
                      {(roomDetail.mode==="SUTDA3" ||
                        (roomDetail.mode==="DORI" && doriBestMake(privatePreview.myCards).made)) && (
                        <div className="space-y-2 rounded-lg border border-white/10 p-2">
                          <p className="text-xs font-semibold">
                            {roomDetail.mode==="SUTDA3"?"승부패 2장 선택":"짓기 3장 선택"}
                          </p>
                          {finalChoice ? (
                            <p role="status" className="text-xs">
                              최종 선택 저장됨: {finalChoice.selected.join(", ")}
                            </p>
                          ) : (
                            <>
                              <div className="flex flex-wrap gap-2">
                                {privatePreview.myCards.map(id=>(
                                  <button key={id} type="button"
                                    aria-pressed={chosenCards.includes(id)}
                                    className={`rounded border px-2 py-1 text-xs ${chosenCards.includes(id)?"border-amber-300":"border-white/20"}`}
                                    onClick={()=>toggleFinalCard(id)}>{id}</button>
                                ))}
                              </div>
                              <Button variant="gold" disabled={busy ||
                                chosenCards.length!==(roomDetail.mode==="DORI"?3:2)}
                                onClick={()=>void submitFinalHand()} className="w-full">
                                최종 패 확정 (정산 없음)
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {roomDetail.mode==="DORI" && !doriBestMake(privatePreview.myCards).made && (
                        <p className="text-xs">짓기 가능한 조합이 없어 황으로 자동 판정합니다. 선택은 필요하지 않습니다.</p>
                      )}
                      {outcome && (
                        <div role="status" className="rounded-lg border border-white/10 p-2 text-xs">
                          <p className="font-semibold">게임 결과 계산 시험 (정산 없음)</p>
                          {outcome.status==="PREVIEW_RESULT_ONLY" ? (
                            <p>예비 승리 좌석: {outcome.winnerSeats?.join(", ")}번 · 포인트 지급 없음</p>
                          ): outcome.status==="BLOCKED" ? (
                            <p>결과 보류: {outcome.reason} · 재경기/최종 선택 검토 필요</p>
                          ): (
                            <p>참가자 턴 완료 대기: {outcome.passed}/{outcome.players}</p>
                          )}
                        </div>
                      )}
                      {betPreview && (
                        <div className="space-y-2 rounded-lg border border-white/10 p-2">
                          <p className="text-xs font-semibold">베팅 금액 계산 시험 · 실제 차감 없음</p>
                          <p className="text-xs text-muted-foreground">
                            가상 POT {betPreview.sample.pot}P · 가상 잔액 {betPreview.sample.hypotheticalBalance}P
                          </p>
                          <p className="text-xs text-muted-foreground">
                            아래 금액은 계산 예시이며 실제 포인트나 베팅 가능 여부가 아닙니다.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {betPreview.actions.map(option => (
                              <div key={option.action}
                                className="rounded-md border border-white/10 px-2 py-1 text-xs">
                                <div>{option.action}</div>
                                <div>{option.enabled ? option.sampleAdditionalAmount+"P" : "예시 조건 불충족"}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {preparedRound && (
                    <div role="status" className="rounded-lg border border-white/10 p-2 text-xs">
                      <p>라운드 #{preparedRound.roundNumber} · 참가자 {preparedRound.playerCount}명</p>
                      <p>{preparedRound.phase === "DEALT_PREVIEW" ? "비공개 카드 배분 완료" : "라운드 준비 완료"}
                        (실제 게임 시작 전) · POT {preparedRound.pot}P</p>
                    </div>
                  )}
                  {roomDetail.ownerId === account.id && roomDetail.seats.length >= 2 && !preparedRound && (
                    <Button variant="gold" className="w-full" disabled={busy}
                      onClick={() => void roomAction({ action: "prepare", roomId: selectedRoomId })}>
                      라운드 준비 (포인트 차감 없음)
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="table" disabled={busy}
                      onClick={() => void refreshRoomDetail(selectedRoomId)}>좌석 새로고침</Button>
                    <Button variant="table" disabled={busy || !!preparedRound || !roomDetail.seats.some(s => s.isMe)}
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
