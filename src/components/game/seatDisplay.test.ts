import { describe, expect, it } from "vitest";
import {
  MISSED_TURN_LIMIT,
  NO_TITLE_LABEL,
  seatConnectionLabel,
  seatPrefixLabel,
  seatWaitingLabel,
  type TableSeat,
} from "./PlayerSeatHUD";

/** 계급/칭호 분리 · 연결 끊김 표시 회귀 (표시 전용, 게임 코어 무관) */
function seat(patch: Partial<TableSeat> = {}): TableSeat {
  return {
    userId: "u1",
    seat: 0,
    nickname: "wkwl",
    rank: "CHALLENGER",
    title: null,
    characterUrl: null,
    points: 1000,
    isMe: false,
    connection: "CONNECTED",
    player: null,
    cardCount: 0,
    leavePending: false,
    ...patch,
  };
}

describe("좌석 칭호/계급 표시", () => {
  it("칭호가 없으면 칭호없음 (계급명을 칭호로 쓰지 않는다)", () => {
    expect(seatPrefixLabel(seat())).toBe(NO_TITLE_LABEL);
    expect(seatPrefixLabel(seat({ rank: "UNRANKED" }))).toBe(NO_TITLE_LABEL);
  });

  it("커스텀 칭호는 실제 title_text 를 사용한다", () => {
    expect(seatPrefixLabel(seat({ title: "천사" }))).toBe("천사");
  });

  it("공백 칭호는 칭호없음으로 처리한다", () => {
    expect(seatPrefixLabel(seat({ title: "   " }))).toBe(NO_TITLE_LABEL);
  });
});

describe("연결 끊김 / 재접속 대기 표시", () => {
  it("연결 상태에서는 표시하지 않는다", () => {
    expect(seatConnectionLabel(seat())).toBeNull();
  });

  it("놓친 턴이 없으면 연결 끊김", () => {
    expect(seatConnectionLabel(seat({ connection: "DISCONNECTED" }))).toBe("연결 끊김");
  });

  it("놓친 턴 누적은 n/3 으로 표시한다", () => {
    expect(seatConnectionLabel(seat({ connection: "DISCONNECTED", missedTurns: 1 }))).toBe(
      `재접속 대기 1/${MISSED_TURN_LIMIT}`,
    );
    expect(seatConnectionLabel(seat({ connection: "DISCONNECTED", missedTurns: 3 }))).toBe(
      `재접속 대기 3/${MISSED_TURN_LIMIT}`,
    );
    expect(seatConnectionLabel(seat({ connection: "DISCONNECTED", missedTurns: 9 }))).toBe(
      `재접속 대기 3/${MISSED_TURN_LIMIT}`,
    );
  });

  it("연결 끊김이 READY/대기 배지보다 우선한다", () => {
    expect(seatWaitingLabel(seat({ connection: "DISCONNECTED", missedTurns: 2 }), true)).toBe(
      `재접속 대기 2/${MISSED_TURN_LIMIT}`,
    );
    expect(seatWaitingLabel(seat({ isReady: true }), true)).toBe("READY");
  });
});
