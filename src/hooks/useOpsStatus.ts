import { useQuery } from "@tanstack/react-query";
import { fetchOpsStatus } from "@/lib/services/opsService";

/** 운영 상태(APP MODE · 점검 · 게임 잠금) 폴링 조회 */
export function useOpsStatus() {
  const query = useQuery({
    queryKey: ["ops-status"],
    queryFn: fetchOpsStatus,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  return query;
}
