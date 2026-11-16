import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { availableEmoticons, getEmoticon } from "@/lib/game/emoticons";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  user_id: string | null;
  message: string;
  kind: string;
  created_at: string;
}

/**
 * 방 채팅 — 일반 채팅 / 이모티콘 / 시스템 / 게임 안내를 한 목록에서 유형별로 구분해 표시한다.
 * (게임 액션 로그는 통합 패널의 "게임로그" 탭에서 따로 렌더링한다)
 */
export function RoomChat({
  roomId,
  userId,
  nickname,
  onReaction,
}: {
  roomId: string;
  userId: string | null;
  nickname: string;
  /** 퀵 리액션 전송 (좌석 위 표시까지 연결) */
  onReaction?: (code: string) => void;
}) {
  const [text, setText] = useState("");
  const [emotesOpen, setEmotesOpen] = useState(false);
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: ["chat", roomId],
    queryFn: async (): Promise<Message[]> => {
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
    queryKey: ["chat-names", roomId, messages.data?.length],
    enabled: !!messages.data?.length,
    queryFn: async () => {
      const ids = [...new Set((messages.data ?? []).map((m) => m.user_id).filter(Boolean))];
      if (ids.length === 0) return {} as Record<string, string>;
      const { data } = await supabase
        .from("profiles")
        .select("id, nickname")
        .in("id", ids as string[]);
      return Object.fromEntries((data ?? []).map((p) => [p.id, p.nickname]));
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`room-chat:${roomId}`)
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

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.data?.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || !userId) return;
    setText("");
    await supabase
      .from("chat_messages")
      .insert({ room_id: roomId, user_id: userId, message: value.slice(0, 200), kind: "chat" });
  }

  const quick = availableEmoticons().filter((e) => e.quick);
  const all = availableEmoticons();

  function fireReaction(code: string) {
    if (!userId) return;
    setEmotesOpen(false);
    onReaction?.(code);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl bg-black/25 p-2 pr-1 text-xs"
      >
        {(messages.data ?? []).map((m) => (
          <ChatLine
            key={m.id}
            row={m}
            self={m.user_id === userId}
            name={m.user_id === userId ? nickname : (names.data?.[m.user_id ?? ""] ?? "익명")}
          />
        ))}
        {messages.data?.length === 0 && (
          <p className="text-muted-foreground">첫 인사를 남겨보세요.</p>
        )}
      </div>

      {/* 퀵 이모티콘 — 최대 2줄, 입력창을 밀어내지 않는다 */}
      <div className="mt-2 flex max-h-[52px] shrink-0 flex-wrap gap-1 overflow-hidden">
        {quick.slice(0, 8).map((e) => (
          <button
            key={e.code}
            type="button"
            disabled={!userId}
            onClick={() => fireReaction(e.code)}
            className="rounded-full border border-gold/25 bg-black/40 px-2 py-0.5 text-[11px] text-gold-soft transition hover:border-gold/60 disabled:opacity-40"
          >
            <span className="mr-1">{e.glyph}</span>
            {e.label}
          </button>
        ))}
      </div>

      {emotesOpen && (
        <div className="mt-2 grid max-h-[132px] shrink-0 grid-cols-4 gap-1 overflow-y-auto rounded-xl border border-gold/20 bg-black/45 p-2">
          {all.map((e) => (
            <button
              key={e.code}
              type="button"
              disabled={!userId}
              onClick={() => fireReaction(e.code)}
              className="rounded-lg px-1 py-1 text-center text-[11px] text-foreground/85 transition hover:bg-gold/10 disabled:opacity-40"
            >
              <span className="block text-base leading-tight">{e.glyph}</span>
              <span className="block truncate">{e.label}</span>
              {e.tier === "RARE" && <span className="block text-[9px] text-gold">RARE</span>}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={send} className="mt-2 flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="table"
          size="sm"
          aria-label="이모티콘"
          className="h-9 w-9 shrink-0 px-0"
          disabled={!userId}
          onClick={() => setEmotesOpen((v) => !v)}
        >
          😊
        </Button>
        <Input
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          placeholder={userId ? "메시지 입력" : "로그인 후 채팅 가능"}
          disabled={!userId}
          className="h-9 min-w-0 flex-1 text-[13px]"
        />
        <Button
          type="submit"
          variant="goldOutline"
          size="sm"
          className="h-9 shrink-0 px-3"
          disabled={!userId}
        >
          전송
        </Button>
      </form>
    </div>
  );
}

function ChatLine({ row, self, name }: { row: Message; self: boolean; name: string }) {
  if (row.kind === "emote") {
    const emote = getEmoticon(row.message);
    return (
      <p className="leading-relaxed">
        <span className="mr-1.5 font-semibold text-gold-soft">{name}</span>
        <span className="rounded-full bg-gold/12 px-2 py-0.5 text-gold">
          {emote ? `${emote.glyph} ${emote.label}` : row.message}
        </span>
      </p>
    );
  }
  if (row.kind === "system" || row.kind === "notice") {
    return (
      <p
        className={cn(
          "rounded-md px-2 py-1 leading-relaxed",
          row.kind === "notice" ? "bg-crimson/12 text-gold-soft" : "bg-white/[0.04] text-foreground/70",
        )}
      >
        <span className="mr-1.5 text-[10px] tracking-widest text-gold/70">
          {row.kind === "notice" ? "공지" : "시스템"}
        </span>
        {row.message}
      </p>
    );
  }
  return (
    <p className="leading-relaxed">
      <span className={cn("mr-1.5 font-semibold", self ? "text-gold" : "text-gold-soft")}>
        {name}
      </span>
      <span className="text-foreground/85">{row.message}</span>
    </p>
  );
}
