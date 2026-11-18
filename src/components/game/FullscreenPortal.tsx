import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 전체화면(fullscreen) 대응 오버레이 포털.
 *
 * 게임 화면은 특정 wrapper 요소만 requestFullscreen 하므로, 그 요소 밖(document.body)에
 * 렌더링된 fixed 오버레이(결과창/모달)는 전체화면 top layer 에서 보이지 않는다.
 * → 현재 fullscreenElement 가 있으면 그 안으로, 없으면 body 로 렌더링한다.
 *
 * 표시 전용 레이어 처리만 담당한다 (게임 결과/정산 데이터 흐름은 관여하지 않는다).
 */
export function FullscreenPortal({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    const sync = () => setTarget(document.fullscreenElement ?? document.body);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  if (!target) return null;
  return createPortal(children, target);
}
