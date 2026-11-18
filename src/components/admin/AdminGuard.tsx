import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

/**
 * 관리자 전용 화면 보호막.
 * 판정은 서버 RPC(my_admin_role → user_roles)로만 이루어지며,
 * 클라이언트 저장소 값은 사용하지 않는다. 직접 URL 입력도 동일하게 차단된다.
 */
export function AdminGuard({
  children,
  requireSuperAdmin = false,
}: {
  children: ReactNode;
  requireSuperAdmin?: boolean;
}) {
  const { user, loading, roleLoading, isAdmin, isSuperAdmin } = useAuth();

  if (loading || (user && roleLoading)) {
    return <Center title="확인 중…" body="권한을 확인하고 있습니다." />;
  }
  if (!user) {
    return <Center title="로그인이 필요합니다" body="관리자 계정으로 로그인해 주세요." />;
  }
  if (!isAdmin || (requireSuperAdmin && !isSuperAdmin)) {
    return (
      <Center
        title="접근 권한이 없습니다"
        body={
          requireSuperAdmin
            ? "최고관리자만 접근할 수 있는 화면입니다."
            : "이 계정에는 관리자 권한이 없습니다."
        }
      />
    );
  }
  return <>{children}</>;
}

function Center({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="panel-surface rounded-2xl p-10 text-center">
        <h1 className="font-display text-xl text-gold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <Button variant="table" size="sm" className="mt-6" asChild>
          <Link to="/">서비스로 돌아가기</Link>
        </Button>
      </div>
    </div>
  );
}
