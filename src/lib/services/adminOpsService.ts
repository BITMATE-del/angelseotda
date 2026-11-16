import { supabase } from "@/integrations/supabase/client";
import type { AppRank } from "@/lib/game/rankTiers";
import { shopImageUrl } from "@/lib/shop/shopImage";

/**
 * SUPER ADMIN / ADMIN 운영 기능 서비스.
 * 모든 작업은 SECURITY DEFINER RPC를 통해 서버에서 권한을 검증하고 admin_logs에 기록된다.
 */

/** undefined 인자를 제거해 RPC 스키마와 맞춘다. */
function rpcArgs(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

/* ── 회원 ─────────────────────────────────────────────────────────── */

export interface AdminMemberRow {
  id: string;
  username: string | null;
  nickname: string;
  rank: AppRank;
  game_points: number;
  locked_points: number;
  wins: number;
  losses: number;
  status: string;
  suspended_until: string | null;
  chat_banned_until: string | null;
  last_seen_at: string | null;
  created_at: string;
  total_charge_amount: number;
  total_charge_count: number;
  total_withdraw_amount: number;
  attendance_count: number;
  is_test_user: boolean;
  affiliate_code: string | null;
  rounds_played: number;
}

export async function listMembers(search: string, limit = 100) {
  const { data, error } = await supabase.rpc("admin_list_members", rpcArgs({
    _search: search || undefined,
    _limit: limit,
  }));
  if (error) throw error;
  return (data ?? []) as unknown as AdminMemberRow[];
}

export async function suspendUser(userId: string, days: number, reason: string) {
  const { error } = await supabase.rpc("admin_suspend_user", {
    _user_id: userId,
    _days: days,
    _reason: reason,
  });
  if (error) throw error;
}

export async function chatBanUser(userId: string, hours: number, reason: string) {
  const { error } = await supabase.rpc("admin_chat_ban_user", {
    _user_id: userId,
    _hours: hours,
    _reason: reason,
  });
  if (error) throw error;
}

export async function clearSanction(userId: string, kind: "suspend" | "chat" | "all", reason: string) {
  const { error } = await supabase.rpc("admin_clear_sanction", {
    _user_id: userId,
    _kind: kind,
    _reason: reason,
  });
  if (error) throw error;
}

export type AdminMemberContact = {
  id?: string;
  nickname?: string | null;
  username?: string | null;
  email?: string | null;
  telegramId?: string | null;
  walletAddress?: string | null;
  signupCodeUsed?: string | null;
  riskLevel?: string | null;
  riskNote?: string | null;
  sanctionReason?: string | null;
};

/** 회원 연락처/민감정보는 관리자 전용 RPC 로만 조회한다. */
export async function fetchMemberContact(userId: string): Promise<AdminMemberContact> {
  const { data, error } = await supabase.rpc("admin_member_contact", { _user_id: userId });
  if (error) throw error;
  return (data ?? {}) as AdminMemberContact;
}

export async function updateMemberProfile(input: {
  userId: string;
  username?: string | null;
  nickname?: string | null;
  telegramId?: string | null;
  walletAddress?: string | null;
  status?: string | null;
  rank?: AppRank | null | undefined;
  affiliateId?: string | null;
  reason: string;
}) {
  const { error } = await supabase.rpc("admin_update_member_profile", rpcArgs({
    _user_id: input.userId,
    _username: input.username ?? undefined,
    _nickname: input.nickname ?? undefined,
    _telegram_id: input.telegramId ?? undefined,
    _wallet_address: input.walletAddress ?? undefined,
    _status: input.status ?? undefined,
    _rank: input.rank ?? undefined,
    _affiliate_id: input.affiliateId ?? undefined,
    _reason: input.reason,
  }));
  if (error) throw error;
}

export async function correctLockedPoints(userId: string, locked: number, reason: string) {
  const { error } = await supabase.rpc("admin_correct_locked_points", {
    _user_id: userId,
    _locked: locked,
    _reason: reason,
  });
  if (error) throw error;
}

/* ── 방 관리 ───────────────────────────────────────────────────────── */

export interface AdminRoomRow {
  roomId: string;
  roomNumber: number;
  title: string;
  roomType: string | null;
  mode: string;
  status: string;
  basePet: number;
  isTestRoom: boolean;
  createdAt: string;
  closedAt: string | null;
  deletedAt: string | null;
  carryPot: number;
  players: number;
  spectators: number;
  currentRoundId: string | null;
  currentRoundStatus: string | null;
  currentPot: number;
  lastActivityAt: string;
  stuck: boolean;
}

export type RoomFilter = "ALL" | "WAITING" | "PLAYING" | "PAUSED" | "EMPTY" | "TEST" | "CLOSED";

export async function listRooms(search: string, filter: RoomFilter, limit = 150) {
  const { data, error } = await supabase.rpc("admin_list_rooms", rpcArgs({
    _search: search || undefined,
    _filter: filter,
    _limit: limit,
  }));
  if (error) throw error;
  return (data ?? []) as unknown as AdminRoomRow[];
}

export interface RoomSnapshot {
  roomId: string;
  roomNumber: number;
  title: string;
  status: string;
  mode: string;
  isTestRoom: boolean;
  carryPot: number;
  playerCount: number;
  spectatorCount: number;
  currentPot: number;
  activeRound: { roundId: string; roundNumber: number; phase: string; pot: number } | null;
  players: {
    userId: string;
    nickname: string;
    seat: number;
    isSpectator: boolean;
    seatStatus: string;
    connection: string;
    leavePending: boolean;
    currentBet: number;
    points: number;
  }[];
}

export async function roomSnapshot(roomId: string) {
  const { data, error } = await supabase.rpc("admin_room_snapshot", { _room_id: roomId });
  if (error) throw error;
  return data as unknown as RoomSnapshot;
}

export async function safeCloseRoom(roomId: string, reason: string) {
  const { error } = await supabase.rpc("admin_safe_close_room", { _room_id: roomId, _reason: reason });
  if (error) throw error;
}

export async function forceDeleteRoom(roomId: string, roomNumber: number, reason: string) {
  const { error } = await supabase.rpc("admin_force_delete_room", {
    _room_id: roomId,
    _room_number_confirm: roomNumber,
    _reason: reason,
  });
  if (error) throw error;
}

export async function cleanupEmptyRooms() {
  const orphan = await supabase.rpc("admin_release_closed_room_seats");
  if (orphan.error) throw orphan.error;
  const { data, error } = await supabase.rpc("cleanup_empty_rooms");
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/* ── 방치 판(전원 이탈) 정리 ───────────────────────────────────────── */

export interface AbandonedRoundRow {
  roundId: string;
  roomId: string;
  roomNumber: number | null;
  roomTitle: string | null;
  roomStatus: string;
  mode: string;
  phase: string | null;
  status: string;
  pot: number;
  carryIn: number;
  startedAt: string;
  lastActivityAt: string;
  activeSeats: number;
  refundPreview: { userId: string; nickname: string | null; seat: number; amount: number }[];
  refundTotal: number;
  alreadyRefunded: boolean;
}

export async function listAbandonedRounds(minIdleMinutes = 5) {
  const { data, error } = await supabase.rpc("admin_abandoned_rounds", {
    _min_idle_minutes: minIdleMinutes,
  });
  if (error) throw error;
  return (data ?? []) as unknown as AbandonedRoundRow[];
}

export async function cancelAbandonedRound(roundId: string, reason: string) {
  const { data, error } = await supabase.rpc("admin_cancel_abandoned_round", {
    _round_id: roundId,
    _reason: reason,
  });
  if (error) throw error;
  return data as unknown as {
    ok: boolean;
    code: string;
    refunded: number;
    carryRestored?: number;
  };
}

/* ── 방 진행 로그 ─────────────────────────────────────────────────── */

export interface RoomEventLog {
  id: string;
  occurred_at: string;
  room_number: number;
  room_id: string | null;
  round_id: string | null;
  user_id: string | null;
  nickname: string | null;
  seat: number | null;
  event_type: string;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  amount: number | null;
  pot_before: number | null;
  pot_after: number | null;
  action_id: string | null;
  server_result: string | null;
  error_code: string | null;
}

export async function searchRoomLogs(input: {
  roomNumber?: number | null;
  userSearch?: string;
  roundId?: string | null;
  eventType?: string;
  from?: string | null;
  to?: string | null;
  limit?: number;
}) {
  const { data, error } = await supabase.rpc("admin_room_logs", rpcArgs({
    _room_number: input.roomNumber ?? undefined,
    _user_search: input.userSearch || undefined,
    _round_id: input.roundId ?? undefined,
    _event_type: input.eventType || undefined,
    _from: input.from ?? undefined,
    _to: input.to ?? undefined,
    _limit: input.limit ?? 200,
  }));
  if (error) throw error;
  return (data ?? []) as unknown as RoomEventLog[];
}

/* ── 운영 로그 검색 ───────────────────────────────────────────────── */

export interface AdminLogRow {
  id: string;
  created_at: string;
  action: string;
  admin_id: string;
  admin_nickname: string | null;
  target_type: string | null;
  target_id: string | null;
  target_nickname: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
}

export async function searchAdminLogs(input: {
  adminSearch?: string;
  targetSearch?: string;
  action?: string;
  from?: string | null;
  to?: string | null;
  limit?: number;
}) {
  const { data, error } = await supabase.rpc("admin_search_logs", rpcArgs({
    _admin_search: input.adminSearch || undefined,
    _target_search: input.targetSearch || undefined,
    _action: input.action || undefined,
    _from: input.from ?? undefined,
    _to: input.to ?? undefined,
    _limit: input.limit ?? 200,
  }));
  if (error) throw error;
  return (data ?? []) as unknown as AdminLogRow[];
}

/* ── 상점 ─────────────────────────────────────────────────────────── */

export const ITEM_STATUS = ["DRAFT", "ON_SALE", "PAUSED", "SOLD_OUT", "HIDDEN"] as const;
export type ItemStatus = (typeof ITEM_STATUS)[number];

export const ITEM_STATUS_LABEL: Record<string, string> = {
  DRAFT: "임시저장",
  ON_SALE: "판매중",
  PAUSED: "일시중지",
  SOLD_OUT: "품절",
  HIDDEN: "숨김",
};

export const ITEM_CATEGORIES = [
  { id: "character", label: "캐릭터" },
  { id: "frame", label: "프레임" },
  { id: "card_back", label: "카드 뒷면" },
  { id: "emoticon", label: "이모티콘" },
  { id: "effect", label: "이펙트" },
  { id: "title", label: "칭호" },
] as const;

/** 분류별 권장 이미지 규격 · 배경 · 사용 위치 안내 (상점 등록 UX용) */
export interface CategorySpec {
  size: string;
  ratio: number;
  background: string;
  format: string;
  usage: string;
}

export const ITEM_CATEGORY_SPEC: Record<string, CategorySpec> = {
  character: {
    size: "768 × 1024 px (3:4)",
    ratio: 0.75,
    background: "불투명 배경 권장 (좌석 카드에 꽉 채워 표시)",
    format: "JPG · PNG · 5MB 이하",
    usage: "게임방 좌석 HUD · 프로필 · 상점 카드",
  },
  frame: {
    size: "512 × 512 px (1:1)",
    ratio: 1,
    background: "투명 배경 필수 (PNG)",
    format: "PNG · 5MB 이하",
    usage: "좌석 HUD 테두리 · 프로필 아바타 테두리",
  },
  card_back: {
    size: "480 × 720 px (2:3)",
    ratio: 2 / 3,
    background: "불투명 배경 (카드 뒷면 전체)",
    format: "PNG · JPG · SVG · 5MB 이하",
    usage: "게임방 카드 뒷면 · 상점 미리보기",
  },
  emoticon: {
    size: "256 × 256 px (1:1)",
    ratio: 1,
    background: "투명 배경 권장 (PNG)",
    format: "PNG · 5MB 이하",
    usage: "게임방 채팅 퀵 이모티콘",
  },
  effect: {
    size: "1024 × 1024 px (1:1)",
    ratio: 1,
    background: "투명 또는 어두운 배경 (오버레이 합성)",
    format: "PNG · 5MB 이하",
    usage: "승리 · 쇼다운 · 입장 이펙트 오버레이",
  },
  title: {
    size: "이미지 불필요 (텍스트 전용)",
    ratio: 0,
    background: "-",
    format: "-",
    usage: "닉네임 앞 칭호 표기 (`[칭호] | 닉네임`)",
  },
};

export async function upsertItem(input: {
  id?: string | null;
  category: string;
  name: string;
  description: string;
  price: number;
  rarity: "NORMAL" | "RARE";
  assetUrl: string | null;
  images: string[];
  status: ItemStatus;
  sortOrder: number;
  durationDays?: number;
  reason?: string | undefined;
}) {
  const { data, error } = await supabase.rpc("admin_upsert_item", rpcArgs({
    _id: input.id ?? null,
    _category: input.category,
    _name: input.name,
    _description: input.description,
    _price: input.price,
    _rarity: input.rarity,
    _asset_url: input.assetUrl ?? null,
    _images: input.images,
    _status: input.status,
    _sort_order: input.sortOrder,
    _duration_days: Math.max(0, Math.trunc(input.durationDays ?? 0)),
    _reason: input.reason ?? undefined,
  }));
  if (error) throw error;
  return data as unknown as string;
}

export async function setItemStatus(id: string, status: ItemStatus, reason?: string) {
  const { error } = await supabase.rpc("admin_set_item_status", rpcArgs({
    _id: id,
    _status: status,
    _reason: reason ?? undefined,
  }));
  if (error) throw error;
}

export async function deleteItem(id: string, reason: string) {
  const { data, error } = await supabase.rpc("admin_delete_item", { _id: id, _reason: reason });
  if (error) throw error;
  return data as unknown as string;
}

/**
 * 상점 이미지 업로드 → storage 경로 반환 (shop-assets 버킷, 관리자만 쓰기 가능).
 * 파일명에 timestamp를 포함해 교체 시에도 예전 이미지가 캐시되지 않는다.
 * DB에는 이 경로만 저장하며 브라우저 임시 URL(blob:)은 저장하지 않는다.
 */
export async function uploadShopImage(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `items/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("shop-assets").upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** 저장 경로를 표시용 URL로 변환 (외부 URL은 그대로 사용) */
export const resolveShopImage = shopImageUrl;

/* ── 설정 / 계급 ──────────────────────────────────────────────────── */

export async function updateSettings(values: Record<string, unknown>, reason: string) {
  const { error } = await supabase.rpc("admin_update_settings", {
    _values: values as never,
    _reason: reason,
  });
  if (error) throw error;
}

export async function updateRankRequirement(input: {
  rank: AppRank;
  minChargeAmount: number;
  minChargeCount: number;
  minAttendance: number;
  pointsReward: number;
  reason: string;
}) {
  const { error } = await supabase.rpc("admin_update_rank_requirement", {
    _rank: input.rank,
    _min_charge_amount: input.minChargeAmount,
    _min_charge_count: input.minChargeCount,
    _min_attendance: input.minAttendance,
    _points_reward: input.pointsReward,
    _reason: input.reason,
  });
  if (error) throw error;
}

/* ── 관리자 권한 ──────────────────────────────────────────────────── */

export const ADMIN_PERMISSIONS = [
  { id: "members", label: "회원 관리" },
  { id: "points", label: "포인트 조정" },
  { id: "charges", label: "충전 처리" },
  { id: "withdrawals", label: "출금 처리" },
  { id: "rooms", label: "방 관리" },
  { id: "shop", label: "상점 관리" },
  { id: "notices", label: "공지 관리" },
  { id: "affiliates", label: "총판 관리" },
  { id: "logs", label: "로그 조회" },
] as const;

export async function listAdminPermissions() {
  const { data, error } = await supabase.from("admin_permissions").select("user_id, permission");
  if (error) throw error;
  return data ?? [];
}

export async function setAdminPermissions(userId: string, permissions: string[], reason: string) {
  const { error } = await supabase.rpc("admin_set_permissions", {
    _user_id: userId,
    _permissions: permissions,
    _reason: reason,
  });
  if (error) throw error;
}
