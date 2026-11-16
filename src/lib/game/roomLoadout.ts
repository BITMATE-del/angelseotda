import { supabase } from "@/integrations/supabase/client";
import { itemImage, itemTableBackground } from "@/lib/shop/itemVisuals";

/** 서버(room_loadouts)가 반환하는 좌석별 장착 코스메틱 원본 */
export interface RawRoomLoadout {
  userId: string;
  cardBack: string | null;
  cardBackName: string | null;
  frame: string | null;
  frameName: string | null;
  nameEffect: string | null;
  nameEffectName: string | null;
  tableSkin: string | null;
  tableSkinName: string | null;
}

/** UI에서 바로 사용하는 좌석별 연출 값 */
export interface SeatLoadout {
  /** 카드 뒷면 이미지 URL (없으면 기본 스킨 사용) */
  cardBack: string | null;
  /** 프로필 프레임 오버레이 이미지 URL */
  frame: string | null;
  /** 닉네임 효과 이름 (있으면 닉네임에 글로우 적용) */
  nameEffect: string | null;
  /** 테이블 스킨 배경 (내 장착 아이템만 테이블에 적용) */
  tableBackground: string | null;
}

export type RoomLoadouts = Record<string, SeatLoadout>;

function resolve(category: string, name: string | null, url: string | null): string | null {
  if (!name && !url) return null;
  return itemImage({ category, name: name ?? "", asset_url: url });
}

/** 게임방 좌석별 장착 아이템 조회 — 카드값 등 민감 정보는 포함되지 않는다 */
export async function fetchRoomLoadouts(roomId: string): Promise<RoomLoadouts> {
  const { data, error } = await supabase.rpc("room_loadouts", { _room_id: roomId });
  if (error) throw error;
  const rows = (data ?? []) as unknown as RawRoomLoadout[];
  const out: RoomLoadouts = {};
  for (const r of rows) {
    out[r.userId] = {
      cardBack: resolve("card_back", r.cardBackName, r.cardBack),
      frame: resolve("profile_frame", r.frameName, r.frame),
      nameEffect: r.nameEffectName ?? (r.nameEffect ? "NAME EFFECT" : null),
      tableBackground:
        r.tableSkinName || r.tableSkin
          ? itemTableBackground({
              category: "table_skin",
              name: r.tableSkinName ?? "",
              asset_url: r.tableSkin,
            })
          : null,
    };
  }
  return out;
}
