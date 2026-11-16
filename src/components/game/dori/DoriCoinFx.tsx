import { useEffect, useRef, useState } from "react";
import { formatPoints } from "@/lib/services/walletService";
import { planDoriFxEvents, type DoriFxEvent } from "@/lib/game/dori/doriFxEvents";
import type { DoriRoomState } from "@/lib/services/doriService";

/**
 * 도리 코인 이동 연출 — visual only 레이어.
 *
 * - 좌석/POT 위치는 DOM bounding rect 로 매번 계산한다 (resize/scale 후에도 정상).
 * - 서버 확정 event key 기준으로 1회만 실행한다 (중복 0).
 * - prefers-reduced-motion / 백그라운드 탭에서는 파티클을 생성하지 않는다.
 * - 실패해도 게임 진행에 영향이 없다 (try/catch, SYSTEM_ERROR 처리 금지).
 */

type Point = { x: number; y: number };
type Flight = { id: string; from: Point; to: Point; count: number; strong: boolean };
type Popup = { id: string; at: Point; text: string };

const FLIGHT_MS = 480;
const WIN_FLIGHT_MS = 640;
const POPUP_MS = 1400;

/** 두 사각형 사이 — 목표 방향의 rect 경계 위 앵커 */
function anchorToward(rect: DOMRect, target: Point, origin: DOMRect): Point {
  const cx = rect.left + rect.width / 2 - origin.left;
  const cy = rect.top + rect.height / 2 - origin.top;
  const dx = target.x - cx;
  const dy = target.y - cy;
  const hx = rect.width / 2;
  const hy = rect.height / 2;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    Math.abs(dx) > 0.01 ? hx / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0.01 ? hy / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  return { x: cx + dx * Math.min(1, scale) * 0.92, y: cy + dy * Math.min(1, scale) * 0.92 };
}

function Coin({
  from,
  to,
  delay,
  duration,
}: {
  from: Point;
  to: Point;
  delay: number;
  duration: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let anim: Animation | undefined;
    try {
      anim = el.animate(
        [
          { transform: "translate(-50%,-50%) scale(0.7)", opacity: 0.1 },
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.18 },
          {
            transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${
              to.y - from.y
            }px)) scale(0.72)`,
            opacity: 0,
          },
        ],
        { duration, delay, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" },
      );
    } catch {
      /* 애니메이션 실패는 무시 — 게임은 계속 진행된다 */
    }
    return () => {
      try {
        anim?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [from, to, delay, duration]);

  return (
    <span
      ref={ref}
      aria-hidden
      className="absolute h-[16px] w-[16px] rounded-full"
      style={{
        left: from.x,
        top: from.y,
        background: "radial-gradient(circle at 35% 30%, #fff2bd, #e8c559 55%, #a37b1c)",
        boxShadow: "0 0 10px rgba(255,210,110,0.85)",
      }}
    />
  );
}

export function DoriCoinFx({ data }: { data: DoriRoomState | undefined }) {
  const layer = useRef<HTMLDivElement | null>(null);
  const seen = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [popups, setPopups] = useState<Popup[]>([]);

  // cleanup — 남은 타이머 제거 (메모리 누수 0)
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    },
    [],
  );

  useEffect(() => {
    if (!data) return;
    let events: DoriFxEvent[] = [];
    try {
      events = planDoriFxEvents(
        {
          round: data.round
            ? {
                roundId: data.round.roundId,
                phase: data.round.phase,
                pot: data.round.pot,
                settlementStatus: data.round.settlementStatus,
              }
            : null,
          seats: data.seats.map((s) => ({
            seat: s.seat,
            userId: s.userId,
            resultType: s.resultType,
            contribution: s.contribution,
          })),
          actions: data.actions.map((a) => ({ id: a.id, userId: a.userId, type: a.type })),
        },
        seen.current,
      );
    } catch {
      return;
    }
    if (!events.length) return;
    events.forEach((e) => seen.current.add(e.key));

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // 백그라운드 탭에서 지연된 연출을 복귀 후 몰아서 재생하지 않는다.
    const hidden = typeof document !== "undefined" && document.hidden;

    const root = layer.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const potEl = root.parentElement?.querySelector<HTMLElement>("[data-dori-pot]");
    const potRect = potEl?.getBoundingClientRect();
    const pot: Point | null = potRect
      ? {
          x: potRect.left + potRect.width / 2 - origin.left,
          y: potRect.top + potRect.height / 2 - origin.top,
        }
      : null;

    const addFlight = (f: Flight) => {
      setFlights((p) => [...p, f]);
      const t = window.setTimeout(
        () => setFlights((p) => p.filter((x) => x.id !== f.id)),
        (f.strong ? WIN_FLIGHT_MS : FLIGHT_MS) + f.count * 40 + 200,
      );
      timers.current.push(t);
    };
    const addPopup = (p: Popup) => {
      setPopups((prev) => [...prev, p]);
      const t = window.setTimeout(() => setPopups((prev) => prev.filter((x) => x.id !== p.id)), POPUP_MS);
      timers.current.push(t);
    };

    for (const e of events) {
      if (e.kind === "REMATCH") {
        if (pot) addPopup({ id: e.key, at: { x: pot.x, y: pot.y - 120 }, text: "판돈 이월" });
        continue;
      }
      const seatEl = root.parentElement?.querySelector<HTMLElement>(`[data-dori-seat="${e.seat}"]`);
      const seatRect = seatEl?.getBoundingClientRect();
      if (!pot || !seatRect) continue;
      const seatAnchor = anchorToward(seatRect, pot, origin);

      if (e.kind === "WIN") {
        if (e.amount > 0) {
          addPopup({
            id: e.key,
            at: { x: seatAnchor.x, y: seatAnchor.y - 26 },
            text: `+${formatPoints(e.amount)}`,
          });
        }
        if (!reduced && !hidden) {
          addFlight({ id: `${e.key}:fx`, from: pot, to: seatAnchor, count: 6, strong: true });
        }
        continue;
      }

      if (reduced || hidden) continue;
      addFlight({
        id: e.key,
        from: seatAnchor,
        to: pot,
        count: e.strong ? 7 : 4,
        strong: false,
      });
    }
  }, [data]);

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {flights.map((f) =>
        Array.from({ length: f.count }).map((_, i) => (
          <Coin
            key={`${f.id}:${i}`}
            from={{ x: f.from.x + (i % 3) * 6 - 6, y: f.from.y + (i % 2) * 6 - 3 }}
            to={{ x: f.to.x + (i % 3) * 8 - 8, y: f.to.y + (i % 2) * 8 - 4 }}
            delay={i * 32}
            duration={f.strong ? WIN_FLIGHT_MS : FLIGHT_MS}
          />
        )),
      )}
      {popups.map((p) => (
        <span
          key={p.id}
          className="animate-fade-in absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-gold/60 bg-black/75 px-3 py-1 font-display text-[16px] text-gold shadow-[0_0_18px_-4px_var(--gold)]"
          style={{ left: p.at.x, top: p.at.y }}
        >
          {p.text}
        </span>
      ))}
    </div>
  );
}
