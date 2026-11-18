import { useQuery } from "@tanstack/react-query";
import { fetchOfficialChannelLink, fetchSupportLink } from "@/lib/services/supportService";

/** 고객센터 Telegram 링크 (관리자 설정값). 미설정이면 빈 문자열. */
export function useSupportLink() {
  const q = useQuery({
    queryKey: ["support-link"],
    queryFn: fetchSupportLink,
    staleTime: 60_000,
  });
  return { link: q.data ?? "", loading: q.isLoading };
}

/** 공식채널 입장 링크 (관리자 설정값). 미설정이면 빈 문자열. */
export function useOfficialChannelLink() {
  const q = useQuery({
    queryKey: ["official-channel-link"],
    queryFn: fetchOfficialChannelLink,
    staleTime: 60_000,
  });
  return { link: q.data ?? "", loading: q.isLoading };
}
