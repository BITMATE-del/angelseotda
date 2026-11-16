import { supabase } from "@/integrations/supabase/client";
import type { RareOwner } from "@/lib/shop/rareOwnership";

export interface MyRareOffer {
  id: string;
  item_id: string;
  item_name: string;
  offer_amount: number;
  message: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
}

export interface ReceivedRareOffer extends MyRareOffer {
  bidder_nickname: string;
}

/** RARE 상품의 현재 보유 상태 (닉네임/본인여부만, 개인정보 없음) */
export async function fetchRareOwners(): Promise<RareOwner[]> {
  const { data, error } = await supabase.rpc("rare_item_owners");
  if (error) throw error;
  return (data ?? []) as RareOwner[];
}

export async function createRareOffer(input: {
  itemId: string;
  amount: number;
  message: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_rare_offer", {
    _item_id: input.itemId,
    _offer_amount: input.amount,
    ...(input.message ? { _message: input.message } : {}),
  });
  if (error) throw error;
  return data as string;
}

export async function cancelRareOffer(offerId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_rare_offer", { _offer_id: offerId });
  if (error) throw error;
}

export async function respondRareOffer(
  offerId: string,
  decision: "ACCEPTED" | "DECLINED",
): Promise<void> {
  const { error } = await supabase.rpc("respond_rare_offer", {
    _offer_id: offerId,
    _decision: decision,
  });
  if (error) throw error;
}

export async function fetchMyRareOffers(): Promise<MyRareOffer[]> {
  const { data, error } = await supabase.rpc("my_rare_offers");
  if (error) throw error;
  return (data ?? []) as MyRareOffer[];
}

export async function fetchReceivedRareOffers(): Promise<ReceivedRareOffer[]> {
  const { data, error } = await supabase.rpc("received_rare_offers");
  if (error) throw error;
  return (data ?? []) as ReceivedRareOffer[];
}
