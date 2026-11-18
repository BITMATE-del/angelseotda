import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCryptoChargeInfo } from "@/lib/cryptoCharge.functions";
import {
  calcUsdtPayout,
  fetchSettings,
  formatPoints,
  formatUsdt,
  formatWon,
  isValidUsdtAddress,
  normalizeUsdtAddress,
  requestUsdtWithdrawal,
  WITHDRAW_NETWORK,
} from "@/lib/services/walletService";

/**
 * USDT(TRC20) 출금 전용 패널.
 * 원화 출금은 지원하지 않으며, 신청 당시 주소는 서버가 신청 기록에 snapshot 으로 저장한다.
 */
export function UsdtWithdrawPanel({ savedAddress }: { savedAddress: string | null }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["app-settings"], queryFn: fetchSettings });
  const info = useQuery({ queryKey: ["crypto-charge-info"], queryFn: () => getCryptoChargeInfo() });

  const [points, setPoints] = useState(50000);
  const [address, setAddress] = useState(savedAddress ?? "");
  const [saveDefault, setSaveDefault] = useState(!savedAddress);
  const [confirming, setConfirming] = useState(false);

  const rate = settings.data?.points_per_won ?? 1;
  const krwPerUsdt = info.data?.rate ?? null;
  const cleanAddress = normalizeUsdtAddress(address);
  const addressOk = isValidUsdtAddress(cleanAddress);
  const expectedUsdt = useMemo(() => calcUsdtPayout(points, rate, krwPerUsdt), [points, rate, krwPerUsdt]);

  const withdraw = useMutation({
    mutationFn: async () => {
      if (!settings.data?.withdraw_enabled) throw new Error("현재 출금이 중지되었습니다.");
      const min = settings.data?.withdraw_min_points ?? 0;
      if (points < min) throw new Error(`최소 출금 포인트는 ${formatPoints(min)}입니다.`);
      if (!addressOk) throw new Error("USDT(TRC20) 주소 형식을 확인해 주세요.");
      await requestUsdtWithdrawal({ points, address: cleanAddress, saveAsDefault: saveDefault });
    },
    onSuccess: () => {
      toast.success("USDT 출금 신청이 접수되었습니다.", {
        description: "신청 포인트는 지급 완료까지 잠금 처리됩니다.",
      });
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["my-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(e instanceof Error ? e.message : "신청 실패");
    },
  });

  return (
    <section className="panel-surface gold-frame h-fit rounded-2xl p-5">
      <h2 className="font-display text-lg text-gold">USDT 출금 신청</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        출금은 USDT({WITHDRAW_NETWORK}) 로만 지급됩니다. 신청 즉시 해당 포인트는 잠금되며 관리자 확인 후 수동
        전송됩니다. 출금 수수료는 없습니다.
      </p>

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="wd-points">출금 포인트 (출금 가능 기준)</Label>
          <Input
            id="wd-points"
            type="number"
            value={points}
            step={10000}
            min={0}
            onChange={(e) => setPoints(Number(e.target.value))}
          />
          <div className="space-y-0.5 text-xs">
            <p className="text-jade">수수료 0% · 신청 포인트 전액이 지급 기준입니다.</p>
            <p className="text-gold-soft">
              지급 기준 {formatPoints(points)} · {formatWon(rate > 0 ? points / rate : 0)}
            </p>
            <p className="text-gold-soft">
              예상 수령 {formatUsdt(expectedUsdt)}
              {krwPerUsdt ? ` (적용 환율 ${krwPerUsdt.toLocaleString("ko-KR")}원/USDT)` : " (환율 조회 중)"}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wd-address">USDT 출금 주소</Label>
          <Input
            id="wd-address"
            value={address}
            maxLength={64}
            spellCheck={false}
            autoComplete="off"
            placeholder="T..."
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            네트워크: <span className="text-gold">USDT {WITHDRAW_NETWORK}</span> · 다른 네트워크 주소를 입력하면
            자산이 소실될 수 있습니다.
          </p>
          {cleanAddress && !addressOk && (
            <p className="text-xs text-crimson">주소 형식이 올바르지 않습니다. (T로 시작하는 34자)</p>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={saveDefault}
              onChange={(e) => setSaveDefault(e.target.checked)}
              className="size-3.5 accent-[var(--gold)]"
            />
            이 주소를 기본 출금 주소로 저장
          </label>
        </div>

        {settings.data?.withdraw_notice && (
          <p className="rounded-lg bg-black/40 p-3 text-xs text-foreground/75">{settings.data.withdraw_notice}</p>
        )}

        {!confirming ? (
          <Button
            variant="gold"
            className="w-full"
            disabled={!addressOk || points <= 0}
            onClick={() => setConfirming(true)}
          >
            출금 신청
          </Button>
        ) : (
          <div className="space-y-3 rounded-xl border border-gold/40 bg-black/40 p-4">
            <p className="font-display text-sm text-gold">USDT 출금 신청 확인</p>
            <div className="space-y-1.5 text-xs">
              <p className="text-muted-foreground">
                출금 포인트 <span className="text-foreground">{formatPoints(points)}</span>
              </p>
              <p className="text-muted-foreground">
                예상 수령 <span className="text-foreground">{formatUsdt(expectedUsdt)}</span>
              </p>
              <p className="text-muted-foreground">
                네트워크 <span className="text-foreground">USDT {WITHDRAW_NETWORK}</span>
              </p>
              <div>
                <p className="text-muted-foreground">출금 주소</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-gold">{cleanAddress}</p>
              </div>
              <p className="text-crimson">이 주소로 출금하시겠습니까? 전송 후에는 되돌릴 수 없습니다.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="table" className="flex-1" onClick={() => setConfirming(false)}>
                취소
              </Button>
              <Button
                variant="gold"
                className="flex-1"
                disabled={withdraw.isPending}
                onClick={() => withdraw.mutate()}
              >
                {withdraw.isPending ? "신청 중…" : "출금 신청"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
