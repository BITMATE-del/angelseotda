/** Telegram WebApp 브라우저 헬퍼. 텔레그램 밖에서는 모두 안전하게 no-op. */
type TgWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
};

export function getTelegramWebApp(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  return wa && wa.initData ? wa : null;
}

export function isTelegramMiniApp() {
  return getTelegramWebApp() !== null;
}

const SDK_URL = "https://telegram.org/js/telegram-web-app.js";

export function loadTelegramSdk(): Promise<TgWebApp | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const existing = getTelegramWebApp();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.onload = () => resolve(getTelegramWebApp());
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}
