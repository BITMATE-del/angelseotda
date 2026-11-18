import { CASH_BUNDLE_ASSET } from "./CashStack";

/**
 * 좌석 → POT (베팅) / POT → 승자 좌석 (정산) 현금다발 이동 연출.
 * 실제 DOM 좌표를 사용하며 단순 opacity fade가 아니다.
 */
export function flyCash({
  layer,
  from,
  to,
  count,
  size = 36,
  duration = 620,
  glow = false,
}: {
  layer: HTMLElement | null;
  from: HTMLElement | null | undefined;
  to: HTMLElement | null | undefined;
  count: number;
  size?: number;
  duration?: number;
  glow?: boolean;
}) {
  if (!layer || !from || !to || count <= 0) return;
  if (typeof window === "undefined" || typeof Element.prototype.animate !== "function") return;

  const box = layer.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const start = { x: a.left + a.width / 2 - box.left, y: a.top + a.height / 2 - box.top };
  const end = { x: b.left + b.width / 2 - box.left, y: b.top + b.height / 2 - box.top };

  for (let i = 0; i < Math.min(count, 6); i++) {
    const img = document.createElement("img");
    img.src = CASH_BUNDLE_ASSET;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.dataset["cashFlight"] = "1";
    img.style.cssText = `position:absolute;width:${size}px;height:auto;left:0;top:0;pointer-events:none;will-change:transform;filter:drop-shadow(0 4px 8px oklch(0 0 0/0.8))${
      glow ? " drop-shadow(0 0 12px var(--gold))" : ""
    };`;
    layer.appendChild(img);

    const jitterX = (i % 3) * 10 - 10;
    const jitterY = Math.floor(i / 3) * 8 - 4;
    const mid = {
      x: (start.x + end.x) / 2 + jitterX * 2,
      y: (start.y + end.y) / 2 - 60 - jitterY,
    };
    const anim = img.animate(
      [
        {
          transform: `translate(${start.x - size / 2}px,${start.y - size / 3}px) scale(0.6) rotate(-8deg)`,
          opacity: 0.2,
        },
        {
          transform: `translate(${mid.x - size / 2}px,${mid.y - size / 3}px) scale(1.05) rotate(6deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(${end.x - size / 2 + jitterX}px,${end.y - size / 3 + jitterY}px) scale(0.9) rotate(0deg)`,
          opacity: 1,
        },
      ],
      { duration, delay: i * 70, easing: "cubic-bezier(.3,.8,.2,1)", fill: "forwards" },
    );
    anim.onfinish = () => img.remove();
    anim.oncancel = () => img.remove();
  }
}
