/**
 * 도리짓고땡 4단계(운영 안정화) 테스트.
 * - 관리자 모니터링 데이터에 카드/덱 정보가 절대 포함되지 않는지 감사
 * - 안전 종료 제한 규칙
 * - stale 방 판정
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  doriRoomCloseBlockReason,
  isDoriRoomStale,
  type DoriAdminRoomRow,
} from "@/lib/services/doriAdminService";

const base: DoriAdminRoomRow = {
  roomId: "r1",
  roomNumber: 200001,
  title: "테스트",
  roomType: "normal",
  status: "WAITING",
  ante: 1000,
  isPrivate: false,
  carryPot: 0,
  seated: 0,
  maxPlayers: 4,
  createdAt: "2026-01-01T00:00:00Z",
  closedAt: null,
  updatedAt: null,
  roundId: null,
  roundNumber: null,
  phase: null,
  roundStatus: null,
  settlementStatus: null,
  dealerSeat: null,
  currentTurnUserId: null,
  currentTurnSeat: null,
  pot: 0,
  raiseCount: null,
  lastActionAt: null,
  leavePendingCount: 0,
  disconnectedCount: 0,
  stale: false,
};

describe("도리 안전 종료 제한", () => {
  it("빈 방은 종료 가능", () => {
    expect(doriRoomCloseBlockReason(base)).toBeNull();
  });

  it("착석자가 있으면 종료 제한", () => {
    expect(doriRoomCloseBlockReason({ ...base, seated: 2 })).toContain("착석");
  });

  it("진행 중 라운드가 있으면 종료 제한", () => {
    expect(
      doriRoomCloseBlockReason({ ...base, roundId: "rd1", roundStatus: "PLAYING" }),
    ).toContain("진행");
  });

  it("미정산 라운드가 있으면 종료 제한", () => {
    expect(
      doriRoomCloseBlockReason({
        ...base,
        roundId: "rd1",
        roundStatus: "FINISHED",
        settlementStatus: "PENDING",
      }),
    ).toContain("미정산");
  });

  it("이미 종료된 방은 재종료하지 않는다", () => {
    expect(doriRoomCloseBlockReason({ ...base, status: "CLOSED" })).toContain("이미");
  });
});

describe("도리 stale 방 판정", () => {
  it("서버가 stale로 표시하면 이상", () => {
    expect(isDoriRoomStale({ ...base, stale: true })).toBe(true);
  });

  it("착석자 전원이 미접속이면 이상", () => {
    expect(isDoriRoomStale({ ...base, seated: 3, disconnectedCount: 3 })).toBe(true);
  });

  it("정상 진행 방은 이상 아님", () => {
    expect(isDoriRoomStale({ ...base, seated: 3, disconnectedCount: 1 })).toBe(false);
  });
});

describe("관리자 화면 hidden card 감사", () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const service = stripComments(readFileSync("src/lib/services/doriAdminService.ts", "utf8"));
  const panel = stripComments(readFileSync("src/components/admin/AdminDoriRooms.tsx", "utf8"));

  it("관리자 서비스는 카드/덱 필드를 정의하지 않는다", () => {
    for (const forbidden of ["cardCode", "card_code", "monthValue", "month_value", "deck", "cards:"]) {
      expect(service).not.toContain(forbidden);
    }
  });

  it("관리자 화면은 카드 테이블을 직접 조회하지 않는다", () => {
    for (const forbidden of ["dori_cards", "dori_hand_submissions", "from(\"dori"]) {
      expect(panel).not.toContain(forbidden);
      expect(service).not.toContain(forbidden);
    }
  });

  it("관리자 화면은 장수(cardCount)만 표시한다", () => {
    expect(panel).toContain("cardCount");
  });
});
