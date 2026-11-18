import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { verifyTelegramInitData } from "./verify.server";

const Input = z.object({ initData: z.string().min(1).max(4096) });

function tgError(e: unknown): never {
  const code = e instanceof Error ? e.message : "";
  if (code === "TG_EXPIRED") throw new Error("텔레그램 인증이 만료되었습니다. 미니앱을 다시 열어 주세요.");
  throw new Error("텔레그램 인증을 확인할 수 없습니다. 미니앱을 다시 열어 주세요.");
}

/**
 * 연결된 텔레그램 계정이면 서버 검증 후 일회용 로그인 토큰을 발급한다.
 * 클라이언트는 이 토큰으로 기존과 동일한 정상 세션을 만든다 (RLS/RPC/Realtime 동일).
 */
export const telegramLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }) => {
    let tg;
    try {
      tg = await verifyTelegramInitData(data.initData);
    } catch (e) {
      tgError(e);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link } = await supabaseAdmin
      .from("telegram_links")
      .select("user_id")
      .eq("telegram_user_id", tg.id)
      .maybeSingle();
    if (!link) return { linked: false as const };

    const { data: u, error: ue } = await supabaseAdmin.auth.admin.getUserById(link.user_id);
    if (ue || !u.user?.email) throw new Error("연결된 계정을 찾을 수 없습니다. 고객센터에 문의해 주세요.");
    const { data: gl, error: ge } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: u.user.email,
    });
    if (ge || !gl.properties?.hashed_token) throw new Error("로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    await supabaseAdmin
      .from("telegram_links")
      .update({ last_login_at: new Date().toISOString(), telegram_username: tg.username })
      .eq("user_id", link.user_id);
    return { linked: true as const, tokenHash: gl.properties.hashed_token };
  });

/** 로그인한 ANGEL 계정과 서버 검증된 텔레그램 계정을 1:1 연결한다. */
export const telegramLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data, context }) => {
    let tg;
    try {
      tg = await verifyTelegramInitData(data.initData);
    } catch (e) {
      tgError(e);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("telegram_links")
      .select("user_id, telegram_user_id")
      .or(`user_id.eq.${context.userId},telegram_user_id.eq.${tg.id}`);
    for (const row of existing ?? []) {
      if (row.user_id === context.userId && row.telegram_user_id === tg.id) return { ok: true };
      if (row.telegram_user_id === tg.id)
        throw new Error("이 텔레그램 계정은 이미 다른 엔젤섯다 계정에 연결되어 있습니다.");
      throw new Error("이 엔젤섯다 계정은 이미 다른 텔레그램 계정에 연결되어 있습니다. 변경은 고객센터에 문의해 주세요.");
    }
    const { error } = await supabaseAdmin.from("telegram_links").insert({
      user_id: context.userId,
      telegram_user_id: tg.id,
      telegram_username: tg.username,
      telegram_first_name: tg.first_name,
    });
    if (error) throw new Error("연결에 실패했습니다. 이미 연결된 계정인지 확인해 주세요.");
    return { ok: true };
  });
