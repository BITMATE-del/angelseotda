import { useEffect, useRef, useState } from "react";
import { formatPoints } from "@/lib/services/walletService";
import { planSutda2FxEvents, type Sutda2FxEvent } from "@/lib/game/sutda2Fx";
import type { ServerRoundState } from "@/lib/services/serverGameService";

/**
 * Sutda2CoinFx — 2장 섯다 코인 이동 / 승자 +포인트 연출 (PHASE 3, 표시 전용).
 *
 * - 좌석·POT 위치는 매번 DOM bounding rect 로 계산한다 (해상도/scale/fullscreen 무관).
 * - 서버 확정 event key 기준 1회만 실행한다 (realtime refetch 중복 0).
 * - prefers-reduced-motion / 백그라운드 탭에서는 파티클을 만들지 않는다.
 * - 어떤 실패도 게임 진행(RPC/action/round)에 영향을 주지 않는다.
 */

type Point = { x: number; y: number };
type Flight = { id: string; from: Point; to: Point; count: number; strong: boolean };
type Popup = { id: string; at: Point; text: string };

const FLIGHT_MS = 460;
const WIN_FLIGHT_MS = 640;
const POPUP_MS = 1400;

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function Coin({ from, to, delay }: { from: Point; to: Point; delay: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let anim: Animation | undefined;
    try {
      anim = el.animate(
        [
          { transform: "translate(-50%,-50%) scale(0.7)", opacity: 0.15 },
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.2 },
          {
            transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.72)`,
            opacity: 0,
          },
        ],
        { duration: FLIGHT_MS + 120, delay, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" },
      );
    } catch {
      /* 연출 실패는 무시한다 */
    }
    return () => {
      try {
        anim?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [from, to, delay]);

  return (
    <span
      ref={ref}
      aria-hidden
      data-sutda-coin=""
      className="absolute h-[15px] w-[15px] rounded-full"
      style={{
        left: from.x,
        top: from.y,
        background: "radial-gradient(circle at 35% 30%, #fff3c0, #e9c65b 55%, #a37b1c)",
        boxShadow: "0 0 10px rgba(255,210,110,0.85)",
      }}
    />
  );
}

export function Sutda2CoinFx({ server }: { server: ServerRoundState | null }) {
  const layer = useRef<HTMLDivElement | null>(null);
  const seen = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [popups, setPopups] = useState<Popup[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    },
    [],
  );

  useEffect(() => {
    if (!server) return;

    let events: Sutda2FxEvent[] = [];
    try {
      events = planSutda2FxEvents(
        {
          roundId: server.roundId,
          status: server.status ?? null,
          rematch: !!server.rematch,
          pot: Number(server.pot ?? 0),
          actions: server.actions.map((a, i) => ({
            id: String(a.id ?? `${a.userId}-${a.type}-${i}`),
            userId: a.userId,
            type: String(a.type),
          })),
          seats: server.seats.map((s) => ({
            userId: s.userId,
            resultType: s.resultType ?? null,
            initialPoints: s.initialPoints ?? null,
            finalPoints: s.finalPoints ?? null,
          })),
        },
        seen.current,
      );
    } catch {
      return;
    }
    if (events.length === 0) return;

    // 지난 이벤트가 몰아서 재생되지 않도록 key 는 항상 소비한다 (백그라운드 탭 복귀 포함)
    for (const e of events) seen.current.add(e.key);
    if (document.hidden || reducedMotion()) return;

    const box = layer.current?.getBoundingClientRect();
    const host = layer.current;
    if (!box || !host || box.width <= 0) return;
    // 게임판은 transform: scale 되어 있다 → layer 내부 좌표계로 환산한다
    const k = host.offsetWidth > 0 ? box.width / host.offsetWidth : 1;
    const center = (el: Element | null): Point | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return null;
      return { x: (r.left + r.width / 2 - box.left) / k, y: (r.top + r.height / 2 - box.top) / k };
    };
    const potPoint = center(document.querySelector("[data-sutda-pot]"));
    const seatPoint = (userId: string) =>
      center(document.querySelector(`[data-sutda-seat="${CSS.escape(userId)}"]`));

    const added: Flight[] = [];
    const addedPopups: Popup[] = [];
    for (const e of events) {
      if (e.kind === "BET") {
        const from = seatPoint(e.userId);
        if (!from || !potPoint) continue;
        added.push({ id: e.key, from, to: potPoint, count: e.count, strong: e.strong });
      } else if (e.kind === "WIN") {
        const to = seatPoint(e.userId);
        if (!to || !potPoint) continue;
        added.push({ id: e.key, from: potPoint, to, count: 6, strong: true });
        if (e.amount > 0)
          addedPopups.push({
            id: `${e.key}:popup`,
            at: { x: to.x, y: to.y - 60 },
            text: `+${formatPoints(e.amount)}`,
          });
      }
      // REMATCH: POT→승자 이동 금지 (이월 표시는 게임판 POT 영역에서 처리)
    }

    if (added.length) {
      setFlights((prev) => [...prev, ...added]);
      const t = window.setTimeout(
        () => setFlights((prev) => prev.filter((f) => !added.some((a) => a.id === f.id))),
        WIN_FLIGHT_MS + 500,
      );
      timers.current.push(t);
    }
    if (addedPopups.length) {
      setPopups((prev) => [...prev, ...addedPopups]);
      const t = window.setTimeout(
        () => setPopups((prev) => prev.filter((p) => !addedPopups.some((a) => a.id === p.id))),
        POPUP_MS + 200,
      );
      timers.current.push(t);
    }
  }, [server]);

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 overflow-visible">
      {flights.map((f) =>
        Array.from({ length: f.count }).map((_, i) => (
          <Coin
            key={`${f.id}:${i}`}
            from={{ x: f.from.x + ((i % 3) - 1) * 9, y: f.from.y + (i % 2) * 7 }}
            to={{ x: f.to.x + ((i % 3) - 1) * 7, y: f.to.y + ((i % 2) - 0.5) * 8 }}
            delay={i * (f.strong ? 40 : 55)}
          />
        )),
      )}
      {popups.map((p) => (
        <span
          key={p.id}
          aria-hidden
          data-sutda-win-popup=""
          className="absolute animate-fade-in font-display text-[22px] text-gold drop-shadow-[0_0_12px_var(--gold)]"
          style={{ left: p.at.x, top: p.at.y, transform: "translate(-50%,-50%)" }}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
}
