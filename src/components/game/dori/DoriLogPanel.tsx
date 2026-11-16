import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatPoints } from "@/lib/services/walletService";
import {
  fetchDoriChat,
  fetchDoriRoundHistory,
  sendDoriChat,
  type DoriChatMessage,
  type DoriRoomState,
  type DoriRoundResult,
} from "@/lib/services/doriService";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/services/opsService";
import { cn } from "@/lib/utils";
import { DoriAssetButton } from "./DoriAssetButton";

type LogKind = "SYSTEM" | "ACTION" | "RESULT";

interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;
  at: number;
}

const ACTION_TEXT: Record<string, string> = {
  CHECK: "체크",
  CALL: "콜",
  PING: "삥",
  TTADANG: "따당",
  QUARTER: "쿼터",
  HALF: "하프",
  ALL_IN: "올인",
  DIE: "다이",
  FOLD: "다이",
  ANTE: "기본 베팅",
  // 구 액션명 기록 호환
  BET: "베팅",
  RAISE: "레이즈",
};

/**
 * 도리 전용 진행 로그 — 서버가 내려준 상태/액션만 근거로 문장을 만든다.
 * 카드값·상대 족보 등 비공개 정보는 쇼다운 이전에 절대 기록하지 않는다.
 */
function useDoriEventLog(data: DoriRoomState | undefined) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const seats = useRef(new Map<string, string>());
  const ready = useRef(new Set<string>());
  const actions = useRef(new Set<string>());
  const made = useRef(new Set<string>());
  const phase = useRef<string | null>(null);
  const roundKey = useRef<string | null>(null);
  /** 미접속/재접속 대기 로그 중복 방지 (userId → 마지막으로 기록한 상태 키) */
  const absence = useRef(new Map<string, string>());
  const longAbsent = useRef(new Set<string>());

  useEffect(() => {
    if (!data) return;
    const push: LogEntry[] = [];
    const now = Date.now();
    const add = (id: string, kind: LogKind, text: string) =>
      push.push({ id, kind, text, at: now });

    // 착석 / 퇴장
    const current = new Map(data.seats.map((s) => [s.userId, s.nickname]));
    const first = seats.current.size === 0 && entries.length === 0;
    for (const [uid, name] of current) {
      if (!seats.current.has(uid) && !first) add(`join:${uid}:${now}`, "SYSTEM", `${name} 님이 착석했습니다.`);
    }
    for (const [uid, name] of seats.current) {
      if (current.has(uid)) continue;
      if (longAbsent.current.has(uid)) {
        longAbsent.current.delete(uid);
        add(`leave:${uid}:${now}`, "SYSTEM", `${name} 님이 장기 미접속으로 퇴장했습니다.`);
      } else {
        add(`leave:${uid}:${now}`, "SYSTEM", `${name} 님이 자리에서 나갔습니다.`);
      }
      absence.current.delete(uid);
    }
    seats.current = current;

    // 접속 끊김 / 재접속 대기 (서버가 확정한 상태만 기록, 중복 금지)
    for (const s of data.seats) {
      const miss = Math.min(s.absenceMisses ?? 0, 3);
      const offline = s.connection === "DISCONNECTED" || s.connection === "LONG_ABSENCE";
      const stateKey = s.longAbsence ? "long" : offline ? `off:${miss}` : "on";
      if (absence.current.get(s.userId) === stateKey) continue;
      absence.current.set(s.userId, stateKey);
      if (s.longAbsence) {
        if (!longAbsent.current.has(s.userId)) {
          longAbsent.current.add(s.userId);
          add(
            `abs:long:${s.userId}`,
            "SYSTEM",
            `${s.nickname} 님이 장기 미접속으로 판 종료 후 퇴장 처리됩니다.`,
          );
        }
      } else if (offline) {
        add(
          `abs:${s.userId}:${miss}:${now}`,
          "SYSTEM",
          miss > 0
            ? `${s.nickname} 님 재접속 대기 ${miss}/3`
            : `${s.nickname} 님의 연결이 끊겼습니다.`,
        );
      } else if (miss === 0) {
        longAbsent.current.delete(s.userId);
      }
    }

    // 준비
    for (const s of data.seats) {
      if (s.isReady && !ready.current.has(s.userId)) {
        ready.current.add(s.userId);
        add(`ready:${s.userId}:${now}`, "SYSTEM", `${s.nickname} 님이 준비했습니다.`);
      }
      if (!s.isReady) ready.current.delete(s.userId);
    }

    const round = data.round;
    const key = round?.roundId ?? null;
    if (key && key !== roundKey.current) {
      roundKey.current = key;
      phase.current = null;
      made.current.clear();
      add(`round:${key}`, "SYSTEM", `${round?.roundNumber ?? ""}번째 판이 시작되었습니다.`);
    }

    // 베팅 액션
    for (const a of data.actions) {
      if (actions.current.has(a.id)) continue;
      actions.current.add(a.id);
      const name = current.get(a.userId) ?? "플레이어";
      const label = ACTION_TEXT[a.type.toUpperCase()] ?? a.type;
      add(
        `act:${a.id}`,
        "ACTION",
        a.amount > 0 ? `${name} · ${label} ${formatPoints(a.amount)}` : `${name} · ${label}`,
      );
    }

    // 짓기 완료 로그는 본인 것만 남긴다.
    // (상대의 완료 타이밍을 공용 로그로 남기면 황 여부를 추론할 수 있다)
    const mine = data.seats.find((s) => s.isMe);
    if (mine && mine.makeStatus && mine.makeStatus !== "PENDING") {
      const id = `make:${key}:me`;
      if (!made.current.has(id)) {
        made.current.add(id);
        add(id, "SYSTEM", "짓기 선택이 완료되었습니다.");
      }
    }

    // 단계 · 결과
    const p = round?.phase ?? null;
    if (p && p !== phase.current) {
      const before = phase.current;
      phase.current = p;
      const PHASE_TEXT: Record<string, string> = {
        DEALING: "카드를 지급합니다.",
        BETTING_1: "3장이 지급되었습니다. 1차 베팅을 시작합니다.",
        BETTING_2: "4번째 패가 지급되었습니다. 2차 베팅을 시작합니다.",
        MAKE_SELECTION: "5번째 패가 지급되었습니다. 짓기 단계입니다.",
        BETTING_FINAL: "모든 플레이어가 짓기를 완료했습니다. 최종 베팅을 시작합니다.",
      };
      if (PHASE_TEXT[p]) add(`ph:${key}:${p}`, "SYSTEM", PHASE_TEXT[p]!);
      if (p === "SHOWDOWN") add(`sd:${key}`, "SYSTEM", "쇼다운 — 패를 공개합니다.");

      if (p === "FINISHED" && before !== "FINISHED" && round) {
        if (round.settlementStatus === "REMATCH") {
          add(
            `re:${key}`,
            "RESULT",
            `${round.rematchReason ?? "동점 · 재경기"} — 판돈 ${formatPoints(round.pot)}이 다음 판으로 이월됩니다.`,
          );
        } else {
          const winner = data.seats.find((s) => s.resultType === "WIN");
          if (winner) {
            // 금액/족보는 서버가 확정한 값만 사용한다 (클라이언트 재계산 금지).
            const handText = winner.handLabel ? ` · ${winner.handLabel}` : "";
            add(
              `win:${key}`,
              "RESULT",
              `${winner.nickname} 승리${handText} · POT ${formatPoints(round.pot)}`,
            );
          }
          for (const s of data.seats) {
            if (!s.inRound || s.resultType === "WIN" || s.contribution <= 0) continue;
            add(
              `lose:${key}:${s.userId}`,
              "RESULT",
              `${s.nickname} · -${formatPoints(s.contribution)}${s.folded ? " (다이)" : ""}`,
            );
          }
        }
      }
    }

    if (push.length) setEntries((prev) => [...prev, ...push].slice(-200));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return entries;
}

type Tab = "ALL" | "CHAT" | "LOG" | "HISTORY";

const TABS: { id: Tab; label: string }[] = [
  { id: "ALL", label: "전체" },
  { id: "CHAT", label: "채팅" },
  { id: "LOG", label: "게임로그" },
  { id: "HISTORY", label: "게임기록" },
];

/** 게임기록 — 서버 공개 정책이 적용된 지난 판 결과만 표시한다. */
function DoriHistoryList({ roomId, userId }: { roomId: string; userId: string }) {
  const history = useQuery<DoriRoundResult[]>({
    queryKey: ["dori-round-history", roomId],
    queryFn: () => fetchDoriRoundHistory(roomId, 10),
    staleTime: 5000,
  });

  if (history.isLoading) return <p className="text-foreground/45">기록을 불러오는 중입니다.</p>;
  const rounds = (history.data ?? []).filter((r) => r.ready);
  if (rounds.length === 0) return <p className="text-foreground/45">아직 종료된 판이 없습니다.</p>;

  return (
    <div className="space-y-2">
      {rounds.map((r) => (
        <div key={r.roundId} className="rounded-xl border border-gold/20 bg-black/40 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="font-display text-[12px] text-gold">{r.roundNumber}번째 판</span>
            <span className="text-[11px] text-gold-soft">POT {formatPoints(r.pot ?? 0)}</span>
          </div>
          <ul className="mt-1 space-y-1">
            {(r.players ?? []).map((p) => (
              <li key={p.userId} className="leading-relaxed">
                <span className={cn("mr-1", p.userId === userId ? "text-gold" : "text-foreground/75")}>
                  {p.seat}번 {p.nickname}
                </span>
                <span
                  className={cn(
                    p.resultType === "WIN" ? "text-gold" : "text-foreground/50",
                  )}
                >
                  {p.folded ? "다이" : p.resultType === "WIN" ? "승" : p.resultType === "REMATCH" ? "재경기" : "패"}
                </span>
                <span className="ml-1 tabular-nums text-foreground/60">
                  {p.net > 0 ? `+${formatPoints(p.net)}` : formatPoints(p.net)}
                </span>
                {p.revealed ? (
                  <span className="ml-1 text-foreground/55">
                    {p.isHwang
                      ? "· 황"
                      : `· ${p.handLabel ?? "-"}${p.makeTotal !== null && p.makeTotal !== undefined ? ` (짓기 ${p.makeTotal})` : ""}`}
                  </span>
                ) : (
                  <span className="ml-1 text-foreground/35">· 비공개</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 도리 게임방 채팅 + 진행 로그 — 게임판 오른쪽 세로 패널 */
export function DoriLogPanel({
  roomId,
  userId,
  nickname,
  data,
  className,
}: {
  roomId: string;
  userId: string;
  nickname: string;
  data: DoriRoomState | undefined;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [tab, setTab] = useState<Tab>("ALL");
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const log = useDoriEventLog(data);

  const chat = useQuery<DoriChatMessage[]>({
    queryKey: ["dori-chat", roomId],
    queryFn: () => fetchDoriChat(roomId),
    // 실시간 구독이 끊겨도 채팅이 멈추지 않도록 주기적 재조회 + 복귀 시 재조회
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`dori-chat-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dori_chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        () => void queryClient.invalidateQueries({ queryKey: ["dori-chat", roomId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, queryClient]);

  const merged = [
    ...log.map((l) => ({
      id: l.id,
      kind: l.kind as LogKind | "CHAT",
      at: l.at,
      text: l.text,
      name: null as string | null,
      self: false,
    })),
    ...(chat.data ?? []).map((c) => ({
      id: c.id,
      kind: "CHAT" as const,
      at: new Date(c.createdAt).getTime(),
      text: c.message,
      name: c.nickname ?? "익명",
      self: c.userId === userId,
    })),
  ]
    .filter((m) =>
      tab === "ALL"
        ? true
        : tab === "CHAT"
          ? m.kind === "CHAT"
          : tab === "LOG"
            ? m.kind !== "CHAT"
            : false,
    )
    .sort((a, b) => a.at - b.at);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [merged.length, tab]);

  async function submit() {
    const value = text.trim();
    if (!value) return;
    setText("");
    try {
      await sendDoriChat(roomId, userId, nickname, value);
      void queryClient.invalidateQueries({ queryKey: ["dori-chat", roomId] });
    } catch (e) {
      // 게임 진행은 막지 않지만, 전송 실패는 사용자에게 알린다
      setText(value);
      toast.error(friendlyErrorMessage(e, "메시지를 보낼 수 없습니다. 잠시 후 다시 시도해 주세요."));
    }
  }

  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-gold/35",
        "bg-[linear-gradient(180deg,rgba(8,20,16,0.96),rgba(4,8,7,0.97))]",
        "shadow-[inset_0_0_0_1px_rgba(212,175,55,0.12),0_10px_30px_-18px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      {/* 상단 탭 — 골드 강조 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-gold/25 bg-black/40 px-2 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-2.5 py-1 font-display text-[12px] tracking-wide transition-colors",
              tab === t.id
                ? "bg-gold/20 text-gold shadow-[inset_0_0_0_1px_rgba(212,175,55,0.5)]"
                : "text-foreground/55 hover:text-gold-soft",
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[11px] text-foreground/40">{merged.length}</span>
      </div>

      {/* 메시지 목록 */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 basis-0 space-y-1 overflow-y-auto px-2.5 py-2 text-[12px]"
      >
        {tab === "HISTORY" && <DoriHistoryList roomId={roomId} userId={userId} />}
        {tab !== "HISTORY" && merged.length === 0 && (
          <p className="text-foreground/45">판이 시작되면 진행 상황이 여기에 표시됩니다.</p>
        )}
        {merged.map((m) => (
          <p
            key={m.id}
            className={cn(
              "break-words leading-relaxed",
              m.kind === "RESULT" && "font-display text-gold",
              m.kind === "ACTION" && "text-gold-soft",
              m.kind === "SYSTEM" && "text-foreground/60",
            )}
          >
            {m.kind === "CHAT" ? (
              <>
                <span
                  className={cn("mr-1.5 font-semibold", m.self ? "text-gold" : "text-gold-soft")}
                >
                  {m.name}
                </span>
                <span className="text-foreground/90">{m.text}</span>
              </>
            ) : (
              <>
                <span className="mr-1.5 text-[10px] tracking-widest text-gold/50">
                  {m.kind === "RESULT" ? "결과" : m.kind === "ACTION" ? "액션" : "안내"}
                </span>
                {m.text}
              </>
            )}
          </p>
        ))}
      </div>

      {/* 하단 입력 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex shrink-0 items-center gap-2 border-t border-gold/25 bg-black/50 px-2 py-2"
      >
        <Input
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          placeholder="메시지 입력"
          className="h-9 min-w-0 flex-1 border-gold/25 bg-black/60 text-[13px]"
        />
        <DoriAssetButton className="h-[34px] min-w-[72px] px-2" onClick={() => void submit()}>
          전송
        </DoriAssetButton>
      </form>
    </aside>
  );
}

