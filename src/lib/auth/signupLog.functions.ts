import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  stage: z.enum(["validation", "username_check", "auth_signup", "unknown"]),
  errorCode: z.string().max(120).optional(),
  errorMessage: z.string().max(500).optional(),
  username: z.string().max(64).optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 회원가입 실패 상세를 서버 로그로 남긴다.
 * 사용자에게는 친절한 안내만 보여주고, 원인 진단용 상세는 여기에만 기록한다.
 * 비밀번호 등 자격증명은 절대 전달/기록하지 않는다.
 */
export const logSignupFailure = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("signup_failure_logs").insert({
        stage: data.stage,
        error_code: data.errorCode ?? null,
        error_message: data.errorMessage ?? null,
        username: data.username ?? null,
        detail: (data.detail ?? {}) as never,
      });
    } catch (e) {
      console.error("[signup-failure] 로그 기록 실패", (e as Error).message);
    }
    console.warn(
      `[signup-failure] stage=${data.stage} code=${data.errorCode ?? "-"} username=${data.username ?? "-"} message=${data.errorMessage ?? "-"}`,
    );
    return { ok: true };
  });
