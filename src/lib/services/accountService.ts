import { supabase } from "@/integrations/supabase/client";

/**
 * 아이디(username) 기반 계정 서비스.
 * Supabase Auth는 이메일 자격증명만 지원하므로, 아이디에서 결정적으로 파생된
 * 내부 전용 이메일(`<username>@angel.local`)을 사용한다. 이 주소는 노출되지 않으며
 * 사용자에게는 항상 아이디만 보여준다.
 */
export const USERNAME_EMAIL_DOMAIN = "angel.local";

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function usernameToEmail(username: string) {
  return `${normalizeUsername(username)}@${USERNAME_EMAIL_DOMAIN}`;
}

/** 가입/로그인 실패를 사용자 안내(message)와 서버 진단 정보(code/detail)로 함께 전달한다. */
export class AuthFlowError extends Error {
  constructor(
    message: string,
    readonly stage: "validation" | "username_check" | "auth_signup" | "unknown",
    readonly code?: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuthFlowError";
  }
}

export async function signUpWithUsername(input: {
  username: string;
  password: string;
  nickname: string;
  telegramId: string;
  walletAddress: string;
  signupCode?: string;
}) {
  const username = normalizeUsername(input.username);
  const { error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password: input.password,
    options: {
      data: {
        username,
        nickname: input.nickname,
        telegram_id: input.telegramId,
        wallet_address: input.walletAddress,
        signup_code: input.signupCode ?? "",
      },
    },
  });
  if (!error) return;

  const code = error.code ?? "";
  const detail: Record<string, unknown> = { status: error.status ?? null, raw: error.message };
  const fail = (msg: string) => {
    throw new AuthFlowError(msg, "auth_signup", code || "unknown", detail);
  };

  if (code === "weak_password") {
    const reasons = (error as { weak_password?: { reasons?: string[] } }).weak_password?.reasons ?? [];
    detail['reasons'] = reasons;
    if (reasons.includes("pwned"))
      fail("이 비밀번호는 외부에 유출된 적이 있어 사용할 수 없습니다. 다른 비밀번호로 다시 시도해 주세요.");
    fail("비밀번호가 너무 단순합니다. 조금 더 복잡하게 입력해 주세요.");
  }
  if (code === "user_already_exists" || code === "email_exists")
    fail("이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.");
  if (code === "over_request_rate_limit" || error.status === 429)
    fail("가입 시도가 많습니다. 잠시 후 다시 시도해 주세요.");
  if (code === "signup_disabled") fail("현재 신규 가입이 일시 중단되었습니다. 관리자에게 문의해 주세요.");
  if (code === "validation_failed") fail("입력값을 다시 확인해 주세요.");
  if ((error.status ?? 0) >= 500)
    fail("서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  fail("가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속 실패하면 관리자에게 문의해 주세요.");
}

export async function signInWithUsername(username: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (!error) return;

  // 실패 원인을 구분해 안내한다. (원인 불명 메시지로 뭉개지 않는다)
  const code = error.code ?? "";
  if (code === "invalid_credentials")
    throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  if (code === "over_request_rate_limit" || error.status === 429)
    throw new Error("로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.");
  if (code === "user_banned") throw new Error("정지된 계정입니다. 관리자에게 문의해 주세요.");
  if (code === "email_not_confirmed") throw new Error("계정 승인이 완료되지 않았습니다.");
  throw new Error(`로그인 실패: ${error.message}`);
}
