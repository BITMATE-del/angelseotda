import { describe, expect, it } from "vitest";
import {
  dealerSeatForNextRound,
  emptySeatNumbers,
  isValidSeatNumber,
  nextDealerSeat,
  seatOrderFrom,
} from "./seatOrder";

describe("좌석번호 1~5 고정", () => {
  it("0번 좌석은 존재하지 않는다", () => {
    expect(isValidSeatNumber(0, 5)).toBe(false);
    expect(isValidSeatNumber(1, 5)).toBe(true);
    expect(isValidSeatNumber(5, 5)).toBe(true);
    expect(isValidSeatNumber(6, 5)).toBe(false);
  });

  it("퇴장한 자리만 EMPTY 이고 다른 좌석번호는 당겨지지 않는다", () => {
    expect(emptySeatNumbers([1, 3, 5], 5)).toEqual([2, 4]);
    expect(emptySeatNumbers([2, 4], 5)).toEqual([1, 3, 5]);
    expect(emptySeatNumbers([1, 2, 3, 4, 5], 5)).toEqual([]);
  });
});

describe("선(先) 순환", () => {
  it("첫 정규판은 가장 낮은 좌석번호가 선", () => {
    expect(nextDealerSeat(null, [2, 4, 5])).toBe(2);
  });

  it("이후 판마다 좌석번호 순환 1→2→3→4→5→1", () => {
    const all = [1, 2, 3, 4, 5];
    expect(nextDealerSeat(1, all)).toBe(2);
    expect(nextDealerSeat(4, all)).toBe(5);
    expect(nextDealerSeat(5, all)).toBe(1);
  });

  it("빈 좌석은 skip", () => {
    expect(nextDealerSeat(1, [1, 3, 5])).toBe(3);
    expect(nextDealerSeat(3, [1, 3, 5])).toBe(5);
    expect(nextDealerSeat(5, [1, 3, 5])).toBe(1);
  });

  it("이전 선이 퇴장했으면 다음 occupied seat 로 이동", () => {
    expect(nextDealerSeat(2, [1, 4, 5])).toBe(4);
    expect(nextDealerSeat(5, [1, 2])).toBe(1);
  });

  it("REMATCH 중에는 선이 이동하지 않는다", () => {
    expect(dealerSeatForNextRound(3, [1, 3, 5], true)).toBe(3);
    expect(dealerSeatForNextRound(3, [1, 3, 5], false)).toBe(5);
  });
});

describe("카드 지급 · 첫 action 순서", () => {
  it("선 좌석부터 순환 순서", () => {
    expect(seatOrderFrom(3, [1, 2, 3, 4, 5])).toEqual([3, 4, 5, 1, 2]);
    expect(seatOrderFrom(5, [1, 3, 5])).toEqual([5, 1, 3]);
  });
});
