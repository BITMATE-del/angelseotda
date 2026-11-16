import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyRole } from "@/lib/services/roleService";

export interface Profile {
  id: string;
  email: string | null;
  nickname: string;
  avatar_url: string | null;
  level: number;
  exp: number;
  game_points: number;
  locked_points: number;
  rank_points: number;
  wins: number;
  losses: number;
  current_streak: number;
  max_streak: number;
  gwangttaeng_count: number;
  status: string;
  created_at: string;
  last_seen_at: string;
  /** 계급 (서버가 authoritative, 강등 없음) */
  rank: "UNRANKED" | "BRONZE" | "SILVER" | "GOLD" | "DIAMOND" | "CHALLENGER";
  total_charge_amount: number;
  total_charge_count: number;
  attendance_count: number;
  /** 본인 USDT(TRC20) 출금 주소 — 본인만 조회 가능 */
  wallet_address: string | null;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setLoading(false);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void queryClient.invalidateQueries({ queryKey: ["profile"] });
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return { session, user: session?.user ?? null, loading };
}

export function useProfile(user: User | null) {
  return useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile | null> => {
      // 본인 프로필은 민감정보(텔레그램/지갑/이메일) 포함이므로 서버 전용 함수로만 조회한다.
      const { data, error } = await supabase.rpc("my_profile");
      if (error) throw error;
      return (data as Profile | null) ?? null;
    },
  });
}

/** 서버(user_roles) 기준 역할. 클라이언트에서 위조/수정할 수 없다. */
export function useMyRole(user: User | null) {
  return useQuery({
    queryKey: ["my-role", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: fetchMyRole,
  });
}

export function useAuth() {
  const { session, user, loading } = useSession();
  const profile = useProfile(user);
  const roleQuery = useMyRole(user);
  const role = roleQuery.data ?? "user";
  return {
    session,
    user,
    loading,
    profile: profile.data ?? null,
    profileLoading: profile.isLoading,
    role,
    roleLoading: roleQuery.isLoading,
    isAdmin: role === "admin" || role === "super_admin",
    isSuperAdmin: role === "super_admin",
  };
}
