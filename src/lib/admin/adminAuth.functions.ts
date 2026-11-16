import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * 회원 비밀번호 강제 재설정.
 * Auth Admin API는 서버 전용이므로 서버 함수에서만 실행되며,
 * 호출자가 최고관리자인지 서버에서 다시 검증한다. (비밀번호는 로그에 기록하지 않는다)
 */
export const resetMemberPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        userId: z.string().uuid(),
        newPassword: z.string().min(8).max(72),
        reason: z.string().min(2).max(200),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isSuper, error: roleError } = await context.supabase.rpc("is_super_admin", {
      _user_id: context.userId,
    });
    if (roleError) throw new Error("권한 확인에 실패했습니다.");
    if (!isSuper) throw new Error("비밀번호 재설정은 최고관리자만 가능합니다.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);

    await context.supabase.rpc("admin_log_event", {
      _action: "USER_PASSWORD_RESET",
      _metadata: { target_id: data.userId, reason: data.reason } as never,
    });

    return { ok: true };
  });
