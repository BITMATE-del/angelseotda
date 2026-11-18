import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { logGameError } from "@/lib/services/opsService";

interface Props {
  children: ReactNode;
  roomId?: string;
  onRecover?: () => void;
}
interface State {
  failed: boolean;
  attempts: number;
}

/**
 * 게임 UI 예외 경계 — 화이트 스크린을 방지하고 서버 상태 재조회로 복구한다.
 * 진행 중 라운드는 서버(DB)에 그대로 유지되므로 복구 후에도 판이 유지된다.
 */
export class GameErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, attempts: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    void logGameError({
      fn: "game_ui",
      error,
      severity: "SYSTEM_ERROR",
      metadata: { componentStack: info.componentStack?.slice(0, 500) ?? null },
      roomId: this.props.roomId ?? null,
      retried: this.state.attempts > 0,
    });

  }

  private retry = () => {
    this.setState((s) => ({ failed: false, attempts: s.attempts + 1 }));
    this.props.onRecover?.();
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    const exhausted = this.state.attempts >= 2;
    return (
      <div className="panel-surface rounded-2xl p-10 text-center">
        <p className="font-display text-lg text-gold">
          {exhausted ? "게임 화면을 복구하지 못했습니다." : "게임 상태를 다시 불러오는 중입니다."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          진행 중인 게임은 서버에 그대로 보관됩니다.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          {!exhausted && (
            <Button variant="gold" size="sm" onClick={this.retry}>
              다시 불러오기
            </Button>
          )}
          <Button variant="table" size="sm" asChild>
            <Link to="/rooms">로비로 이동</Link>
          </Button>
        </div>
      </div>
    );
  }
}
