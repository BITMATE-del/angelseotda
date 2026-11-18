import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getEmoticon } from "@/lib/game/emoticons";
import type { RoomSeat, ServerRoundState } from "@/lib/services/serverGameService";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/services/opsService";
import { cn } from "@/lib/utils";
import { useSutda2EventLog } from "./useSutda2EventLog";

type Tab = "ALL" | "CHAT" | "LOG";

const TABS: { id: Tab; label: string }[] = [
  { id: "ALL", label: "전체" },
  { id: "CHAT", label: "채팅" },
  { id: "LOG", label: "게임로그" },
];

interface ChatRow {
  id: string;
  user_id: string | null;
  message: string;
  kind: string;
  created_at: string;
}

/**
 * Sutda2SidePanel — 2장 섯다 게임방 우측 세로 채팅/게임로그 패널 (PHASE 2).
 *
 * 게임 로직과 완전히 분리된 표시 전용 컴포넌트다.
 * - 전체: 채팅 + 시스템/진행 로그
 * - 채팅: 유저 메시지만
 * - 게임로그: 서버가 확정한 게임 이벤트만
 */
export function Sutda2SidePanel({
  roomId,
  userId,
  nickname,
  server,
  roomSeats,
  resultLines,
  className,
}: {
  roomId: string;
  userId: string;
  nickname: string;
  server: ServerRoundState | null;
  roomSeats: readonly RoomSeat[];
  /** 서버 확정 결과 상세 (표시 전용 · 판별 1회) */
  resultLines?: readonly { id: string; text: string }[] | undefined;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("ALL");
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const baseLog = useSutda2EventLog(server, roomSeats);
  /** 결과 상세는 판별 1회만 누적한다 (같은 id 재유입 시 무시) */
  const [resultLog, setResultLog] = useState<
    { id: string; kind: "RESULT"; text: string; at: number }[]
  >([]);
  useEffect(() => {
    if (!resultLines?.length) return;
    setResultLog((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const next = resultLines
        .filter((l) => !seen.has(l.id))
        .map((l) => ({ id: l.id, kind: "RESULT" as const, text: l.text, at: Date.now() }));
      return next.length === 0 ? prev : [...prev, ...next].slice(-120);
    });
  }, [resultLines]);
  const log = [...baseLog, ...resultLog];



  const chat = useQuery({
    queryKey: ["chat", roomId],
    queryFn: async (): Promise<ChatRow[]> => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, user_id, message, kind, created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(120);
      if (error) throw error;
      return data ?? [];
    },
    // 실시간 구독이 끊겨도 채팅이 멈추지 않도록 주기적 재조회 + 복귀 시 재조회
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const names = useQuery({
    queryKey: ["chat-names", roomId, chat.data?.length],
    enabled: !!chat.data?.length,
    queryFn: async () => {
      const ids = [...new Set((chat.data ?? []).map((m) => m.user_id).filter(Boolean))];
      if (ids.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("profiles")
        .select("id, nickname")
        .in("id", ids as string[]);
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.nickname])) as Record<string, string>;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`sutda2-chat:${roomId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        () => void queryClient.invalidateQueries({ queryKey: ["chat", roomId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, queryClient]);

  type Row = {
    id: string;
    kind: "CHAT" | "SYSTEM" | "ACTION" | "RESULT";
    at: number;
    text: string;
    name: string | null;
    self: boolean;
  };

  const merged: Row[] = [
    ...log.map((l) => ({ id: l.id, kind: l.kind, at: l.at, text: l.text, name: null, self: false })),
    ...(chat.data ?? []).map((m) => {
      const emote = m.kind === "emote" ? getEmoticon(m.message) : null;
      return {
        id: m.id,
        kind: (m.kind === "system" || m.kind === "notice" ? "SYSTEM" : "CHAT") as Row["kind"],
        at: new Date(m.created_at).getTime(),
        text: emote ? `${emote.glyph} ${emote.label}` : m.message,
        name:
          m.user_id === userId ? nickname : (names.data?.[m.user_id ?? ""] ?? (m.user_id ? "익명" : null)),
        self: m.user_id === userId,
      };
    }),
  ]
    .filter((m) => (tab === "ALL" ? true : tab === "CHAT" ? m.kind === "CHAT" : m.kind !== "CHAT"))
    .sort((a, b) => a.at - b.at);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [merged.length, tab]);

  async function submit() {
    const value = text.trim();
    if (!value || !userId) return;
    setText("");
    try {
      const { error } = await supabase
        .from("chat_messages")
        .insert({ room_id: roomId, user_id: userId, message: value.slice(0, 200), kind: "chat" });
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: ["chat", roomId] });
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
        "bg-[linear-gradient(180deg,rgba(10,22,17,0.96),rgba(4,7,6,0.97))]",
        "shadow-[inset_0_0_0_1px_rgba(212,175,55,0.12),0_10px_30px_-18px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-gold/25 bg-black/45 px-2 py-2">
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

      <div ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-2 text-[12px]">
        {merged.length === 0 && (
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
                <span className={cn("mr-1.5 font-semibold", m.self ? "text-gold" : "text-gold-soft")}>
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex shrink-0 items-center gap-2 border-t border-gold/25 bg-black/55 px-2 py-2"
      >
        <Input
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          placeholder="메시지 입력"
          className="h-9 min-w-0 flex-1 border-gold/25 bg-black/60 text-[13px]"
        />
        <Button type="submit" variant="gold" size="sm" className="h-9 shrink-0 px-3">
          전송
        </Button>
      </form>
    </aside>
  );
}
