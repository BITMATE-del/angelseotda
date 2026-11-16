import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCryptoCharge, getCryptoChargeInfo } from "@/lib/cryptoCharge.functions";
import {
  cancelMyCryptoRequest,
  CRYPTO_STATUS_LABEL,
  fetchMyCryptoRequests,
} from "@/lib/services/cryptoChargeService";
import { formatPoints, formatWon } from "@/lib/services/walletService";
import { cn } from "@/lib/utils";

const ACTIVE = ["PENDING", "MATCHED", "CONFIRMING", "CREDITING", "REVIEW"];

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "만료";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}분 ${String(s).padStart(2, "0")}초`;
}

/** USDT(TRC20) 자동충전 — 회원은 원화 금액만 입력하고 TXID는 입력하지 않는다. */
export function CryptoChargePanel({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [krw, setKrw] = useState(50000);
  const infoFn = useServerFn(getCryptoChargeInfo);
  const createFn = useServerFn(createCryptoCharge);

  const info = useQuery({
    queryKey: ["crypto-charge-info"],
    queryFn: () => infoFn(),
    refetchInterval: 60_000,
  });

  const requests = useQuery({
    queryKey: ["my-crypto-requests", userId],
    queryFn: () => fetchMyCryptoRequests(userId),
    refetchInterval: 5_000,
  });

  const active = useMemo(
    () => (requests.data ?? []).find((r) => ACTIVE.includes(r.status)),
    [requests.data],
  );

  const rate = info.data?.rate ?? 0;
  const feeRate = info.data?.feeRate ?? 0.07;
  const pointsPerWon = info.data?.pointsPerWon ?? 1;
  const estFee = Math.round(krw * feeRate);
  const estPoints = Math.floor((krw - estFee) * pointsPerWon);
  const estUsdt = rate > 0 ? krw / rate : 0;
  const minKrw = info.data?.minKrw ?? 10000;
  const maxKrw = info.data?.maxKrw ?? 5000000;
  const quickAmounts = [10000, 30000, 50000, 100000, 300000, 500000].filter(
    (v) => v >= minKrw && v <= maxKrw,
  );

  // 남은 시간 표시를 1초마다 갱신
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (info.data?.minKrw && krw < info.data.minKrw) setKrw(info.data.minKrw);
  }, [info.data?.minKrw]);

  const create = useMutation({
    mutationFn: async () => {
      if (!info.data?.enabled) throw new Error("USDT 자동충전이 현재 중지되어 있습니다.");
      if (!rate) throw new Error("환율 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      if (krw < minKrw) throw new Error(`최소 충전금액은 ${formatWon(minKrw)}입니다.`);
      const res = (await createFn({ data: { krw } })) as {
        ok?: boolean;
        code?: string;
        message?: string;
      };
      if (!res.ok && res.code === "ACTIVE_REQUEST_EXISTS")
        throw new Error("이미 진행 중인 자동충전 신청이 있습니다.");
      if (!res.ok && res.code === "MIN_CHARGE_NOT_MET")
        throw new Error(res.message ?? `최소 충전금액은 ${formatWon(minKrw)}입니다.`);
      if (!res.ok) throw new Error(res.message ?? "신청을 생성할 수 없습니다.");
    },
    onSuccess: () => {
      toast.success("자동충전 신청이 생성되었습니다.", {
        description: "안내된 정확한 USDT 금액을 그대로 보내주세요.",
      });
      void queryClient.invalidateQueries({ queryKey: ["my-crypto-requests"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "신청 실패"),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelMyCryptoRequest(id),
    onSuccess: () => {
      toast.success("신청이 취소되었습니다.");
      void queryClient.invalidateQueries({ queryKey: ["my-crypto-requests"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "취소 실패"),
  });

  return (
    <>
      <section className="panel-surface gold-frame h-fit rounded-2xl p-5">
        <h2 className="font-display text-lg text-gold">USDT 자동충전 (TRC20)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          원화 금액만 입력하면 보내야 할 정확한 USDT 금액이 발급됩니다. 입금이 확인되면 포인트가
          자동으로 지급됩니다. TXID는 입력하지 않습니다.
        </p>

        {!info.data?.enabled && (
          <p className="mt-3 rounded-lg border border-crimson/40 bg-crimson/10 p-3 text-xs text-crimson">
            현재 USDT 자동충전이 중지되어 있습니다. 잠시 후 다시 시도해 주세요.
          </p>
        )}

        {active ? (
          <div className="mt-4 space-y-4 rounded-xl border border-gold/40 bg-black/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs tracking-widest text-gold-soft">
                {CRYPTO_STATUS_LABEL[active.status] ?? active.status}
              </p>
              <span className="text-xs text-muted-foreground">
                남은 시간 <span className="text-gold">{timeLeft(active.expires_at)}</span>
              </span>
            </div>

            {active.status === "REVIEW" && (
              <p className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-xs text-gold-soft">
                입금 수량이 신청 내용과 일치하지 않아 관리자 확인이 필요합니다. 확인 후 처리
                결과가 이 화면에 표시됩니다.
              </p>
            )}


            <div>
              <p className="text-xs text-muted-foreground">보낼 금액 (정확히 일치해야 합니다)</p>
              <p className="font-display text-2xl text-gold">
                {Number(active.expected_usdt).toFixed(3)} USDT
              </p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">입금 주소 (TRC20)</p>
                <p className="break-all font-mono text-xs text-foreground">
                  {active.wallet_address}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="table"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(active.wallet_address);
                      toast.success("주소가 복사되었습니다.");
                    }}
                  >
                    주소 복사
                  </Button>
                  <Button
                    variant="table"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        Number(active.expected_usdt).toFixed(3),
                      );
                      toast.success("송금 금액이 복사되었습니다.");
                    }}
                  >
                    금액 복사
                  </Button>
                  <Button
                    variant="table"
                    size="sm"
                    onClick={() => {
                      void requests.refetch();
                      toast.success("상태를 새로고침했습니다.");
                    }}
                  >
                    상태 확인
                  </Button>
                </div>
              </div>

              {/* QR은 실제 표시되는 입금주소 문자열로 즉석 생성 → 항상 100% 일치 */}
              <div className="shrink-0 self-center rounded-xl border border-gold/30 bg-white p-2 sm:self-start">
                <QRCodeSVG
                  value={active.wallet_address}
                  size={168}
                  level="M"
                  marginSize={1}
                  title="TRC20 입금주소 QR"
                />
              </div>
            </div>
            <p className="text-[11px] text-gold-soft">
              QR 스캔으로 입금주소를 바로 불러올 수 있습니다. 금액은 위 안내 금액을 직접 입력해
              주세요.
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <p className="text-muted-foreground">
                충전금액 <span className="text-foreground">{formatWon(active.requested_krw)}</span>
              </p>
              <p className="text-muted-foreground">
                적용 환율{" "}
                <span className="text-foreground">
                  1 USDT = {Number(active.rate_krw_per_usdt).toLocaleString()}원
                </span>
              </p>
              <p className="text-muted-foreground">
                유효시간 <span className="text-foreground">{info.data?.ttlMinutes ?? 30}분</span>
              </p>
              <p className="text-muted-foreground">
                수수료 {(feeRate * 100).toFixed(0)}% 적용 후 지급
              </p>
            </div>

            <ul className="space-y-1 rounded-lg bg-black/40 p-3 text-[11px] text-foreground/75">
              <li>· 반드시 USDT(TRC20) 네트워크로만 전송해 주세요.</li>
              <li>· 안내된 소수점 6자리까지 정확히 전송해야 자동 매칭됩니다.</li>
              <li>· 별도 TXID 입력은 필요하지 않습니다.</li>
              <li>· 자동충전이 지연되면 고객센터로 문의해 주세요.</li>
            </ul>

            {active.status === "PENDING" && (
              <Button
                variant="table"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(active.id)}
              >
                신청 취소
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="crypto-krw">충전 금액 (원)</Label>
              <Input
                id="crypto-krw"
                type="number"
                step={10000}
                min={minKrw}
                value={krw}
                onChange={(e) => setKrw(Number(e.target.value))}
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {quickAmounts.map((v) => (
                  <Button
                    key={v}
                    variant={krw === v ? "gold" : "table"}
                    size="sm"
                    onClick={() => setKrw(v)}
                  >
                    {(v / 10000).toLocaleString()}만
                  </Button>
                ))}
              </div>
              <div className="space-y-0.5 text-xs">
                <p className="text-gold-soft">최소 충전금액: {formatWon(minKrw)}</p>
                <p className="text-muted-foreground">최대 충전금액: {formatWon(maxKrw)}</p>
                {krw < minKrw && (
                  <p className="text-crimson">최소 충전금액은 {formatWon(minKrw)}입니다.</p>
                )}
                <p className="text-muted-foreground">
                  적용 환율{" "}
                  <span className="text-foreground">
                    {rate ? `${rate.toLocaleString()}원 / 1 USDT` : "조회 중"}
                  </span>
                  {info.data?.rateSource === "cache" && (
                    <span className="ml-1 text-crimson">(최근 저장 환율)</span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  예상 송금 <span className="text-foreground">{estUsdt.toFixed(3)} USDT</span>
                </p>
                <p className="text-muted-foreground">
                  충전 수수료 {(feeRate * 100).toFixed(0)}% ·{" "}
                  <span className="text-crimson">-{formatWon(estFee)}</span>
                </p>
                <p className="text-gold-soft">지급 예정 {formatPoints(estPoints)}</p>
              </div>
            </div>
            <Button
              variant="gold"
              className="w-full"
              disabled={!info.data?.enabled || create.isPending || !rate || krw < minKrw}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "생성 중…" : "자동충전 신청 · 고유 금액 발급"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              신청 후 {info.data?.ttlMinutes ?? 30}분 안에 안내된 금액을 정확히 보내주세요. 금액이
              다르면 자동 매칭되지 않고 관리자 확인이 필요합니다.
            </p>
          </div>
        )}
      </section>

      <section className="panel-surface rounded-2xl p-5">
        <h2 className="font-display text-lg text-gold">자동충전 신청 내역</h2>
        <div className="mt-3 space-y-2">
          {(requests.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">신청 내역이 없습니다.</p>
          )}
          {(requests.data ?? []).map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-black/30 px-3 py-2 text-xs"
            >
              <span className="text-foreground">{formatWon(r.requested_krw)}</span>
              <span className="text-muted-foreground">
                {Number(r.expected_usdt).toFixed(3)} USDT
              </span>
              <span
                className={cn(
                  "font-semibold",
                  r.status === "CREDITED"
                    ? "text-gold"
                    : ACTIVE.includes(r.status)
                      ? "text-gold-soft"
                      : "text-muted-foreground",
                )}
              >
                {CRYPTO_STATUS_LABEL[r.status] ?? r.status}
              </span>
              <span className="text-muted-foreground">
                {r.credited_points ? `+${formatPoints(r.credited_points)}` : "-"}
              </span>
              <span className="text-muted-foreground">
                {new Date(r.created_at).toLocaleString("ko-KR")}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
