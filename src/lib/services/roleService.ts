import { supabase } from "@/integrations/supabase/client";

/**
 * 역할 판정은 전부 서버(user_roles + SECURITY DEFINER RPC) 기준이다.
 * 클라이언트는 role 값을 읽기만 하며, 직접 INSERT/UPDATE 할 수 없다.
 */
export type AdminRole = "user" | "affiliate" | "admin" | "super_admin";

export const ROLE_LABEL: Record<AdminRole, string> = {
  user: "일반 회원",
  affiliate: "총판",
  admin: "ADMIN",
  super_admin: "SUPER ADMIN",
};

export async function fetchMyRole(): Promise<AdminRole> {
  const { data, error } = await supabase.rpc("my_admin_role");
  if (error) throw error;
  return (data as AdminRole) ?? "user";
}

export async function superAdminExists(): Promise<boolean> {
  const { data, error } = await supabase.rpc("super_admin_exists");
  if (error) throw error;
  return Boolean(data);
}

/** 최초 1회만 성공한다. super_admin이 존재하면 서버가 거부한다. */
export async function bootstrapSuperAdmin() {
  const { error } = await supabase.rpc("bootstrap_super_admin");
  if (error) throw error;
}

export interface AdminAccount {
  user_id: string;
  username: string | null;
  nickname: string;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

export async function listAdmins(): Promise<AdminAccount[]> {
  const { data, error } = await supabase.rpc("admin_list_admins");
  if (error) throw error;
  return (data ?? []) as AdminAccount[];
}

/** super_admin 전용 — 관리자 지정/승격/회수 */
export async function setRole(userId: string, role: AdminRole, reason: string) {
  const { error } = await supabase.rpc("admin_set_role", {
    _user_id: userId,
    _role: role,
    _reason: reason,
  });
  if (error) throw error;
}

export async function logAdminEvent(action: "ADMIN_LOGIN" | "ADMIN_LOGOUT" | "ADMIN_VIEW") {
  const { error } = await supabase.rpc("admin_log_event", { _action: action, _metadata: {} });
  if (error) throw error;
}

export async function fetchMyLastAdminLogin(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("admin_logs")
    .select("created_at")
    .eq("admin_id", userId)
    .eq("action", "ADMIN_LOGIN")
    .order("created_at", { ascending: false })
    .limit(2);
  if (error) throw error;
  const rows = data ?? [];
  return rows[1]?.created_at ?? rows[0]?.created_at ?? null;
}
