/**
 * RARE(전 서버 1개) 상품의 구매 버튼 상태 판정.
 * 서버(rare_item_owners)가 준 실제 보유 상태만 신뢰한다.
 */
export type RareOwner = { item_id: string; owner_nickname: string | null; owner_is_me: boolean };

export type ShopActionState =
  | "LOGIN_REQUIRED"
  | "RANK_ONLY"
  | "OWNED_BY_ME"
  | "OWNED_BY_OTHER"
  | "BUYABLE";

export function rareOwnerOf(
  owners: RareOwner[] | undefined,
  itemId: string,
): RareOwner | null {
  return owners?.find((o) => o.item_id === itemId) ?? null;
}

export function shopActionState(input: {
  loggedIn: boolean;
  rarity: string | null | undefined;
  forSale: boolean | null | undefined;
  minePresent: boolean;
  rareOwner: RareOwner | null;
}): ShopActionState {
  const { loggedIn, rarity, forSale, minePresent, rareOwner } = input;
  if (minePresent) return "OWNED_BY_ME";
  if (rarity === "RARE" && rareOwner) {
    return rareOwner.owner_is_me ? "OWNED_BY_ME" : "OWNED_BY_OTHER";
  }
  if (forSale === false) return "RANK_ONLY";
  if (!loggedIn) return "LOGIN_REQUIRED";
  return "BUYABLE";
}

/** 구매 실패 메시지: 서버 message를 우선 보존하고, RARE 선점 케이스만 명확히 안내한다. */
export function purchaseErrorMessage(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : error instanceof Error
        ? error.message
        : "";
  if (/RARE/i.test(raw) || raw.includes("이미 주인이 있습니다")) {
    return "이미 다른 회원이 보유한 상품입니다.";
  }
  return raw.trim() || "구매를 처리할 수 없습니다.";
}

export const OFFER_STATUS_LABEL: Record<string, string> = {
  PENDING: "대기중",
  ACCEPTED: "관심 있음",
  DECLINED: "거절됨",
  CANCELLED: "취소됨",
  EXPIRED: "만료",
};

export function validateOfferAmount(
  input: string,
  availablePoints: number,
): { ok: true; amount: number } | { ok: false; reason: string } {
  if (!/^\d+$/.test(input.replace(/,/g, "").trim())) {
    return { ok: false, reason: "숫자만 입력해 주세요." };
  }
  const amount = Number(input.replace(/,/g, "").trim());
  if (!Number.isFinite(amount) || amount < 1) {
    return { ok: false, reason: "입찰 금액은 1P 이상이어야 합니다." };
  }
  if (amount > availablePoints) {
    return { ok: false, reason: "보유 포인트를 초과하는 금액은 입찰할 수 없습니다." };
  }
  return { ok: true, amount };
}
