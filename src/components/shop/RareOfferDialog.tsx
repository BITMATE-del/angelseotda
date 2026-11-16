import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemThumb } from "@/components/shop/ItemThumb";
import type { ShopItemLike } from "@/lib/shop/itemVisuals";
import { formatPoints } from "@/lib/services/walletService";
import { createRareOffer } from "@/lib/services/rareOfferService";
import { validateOfferAmount } from "@/lib/shop/rareOwnership";

const DEFAULT_MESSAGE = "이 상품을 구매하고 싶습니다.";

/** RARE(전 서버 1개) 상품 보유자에게 구매 의사를 전달하는 입찰 신청 모달. 포인트는 차감되지 않는다. */
export function RareOfferDialog({
  item,
  ownerNickname,
  availablePoints,
  open,
  onOpenChange,
}: {
  item: ShopItemLike & { id: string; name: string };
  ownerNickname: string | null;
  availablePoints: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  const submit = useMutation({
    mutationFn: async () => {
      const parsed = validateOfferAmount(amount, availablePoints);
      if (!parsed.ok) throw new Error(parsed.reason);
      await createRareOffer({
        itemId: item.id,
        amount: parsed.amount,
        message: message.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success("입찰 신청이 전달되었습니다. 포인트는 차감되지 않았습니다.");
      void queryClient.invalidateQueries({ queryKey: ["my-rare-offers"] });
      onOpenChange(false);
      setAmount("");
      setMessage(DEFAULT_MESSAGE);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "입찰 신청에 실패했습니다."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-gold">입찰 신청</DialogTitle>
          <DialogDescription>
            현재 보유자에게 구매 의사만 전달합니다. 소유권은 이전되지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4">
          <ItemThumb item={item} />
          <div className="flex-1 space-y-1 text-sm">
            <p className="font-semibold text-foreground">{item.name}</p>
            <p className="text-xs text-crimson-foreground">
              <span className="rounded-full bg-crimson px-1.5 py-[1px] text-[10px] font-bold text-gold-soft">
                RARE · 전 서버 1개
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              현재 상태: 보유자 있음{ownerNickname ? ` (${ownerNickname})` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              내 보유 포인트: {formatPoints(availablePoints)}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">
            희망 구매가 (P)
            <Input
              inputMode="numeric"
              value={amount}
              placeholder="예: 1500000"
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            메시지 (선택)
            <Textarea
              value={message}
              rows={2}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1"
            />
          </label>
          <p className="text-[11px] text-gold-soft">
            입찰 신청만으로 포인트가 차감되지 않습니다.
          </p>
        </div>

        <Button
          variant="gold"
          className="w-full"
          disabled={submit.isPending}
          onClick={() => submit.mutate()}
        >
          입찰 신청
        </Button>
      </DialogContent>
    </Dialog>
  );
}
