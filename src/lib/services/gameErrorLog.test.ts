import { describe, expect, it } from "vitest";
import { normalizeGameError } from "./opsService";

describe("normalizeGameError", () => {
  it("PostgrestError 객체를 [object Object]로 만들지 않는다", () => {
    const e = { code: "P0001", message: "당신의 차례가 아닙니다.", details: null, hint: null };
    const n = normalizeGameError(e);
    expect(n.message).toBe("당신의 차례가 아닙니다.");
    expect(n.message).not.toContain("[object Object]");
    expect(n.code).toBe("NOT_YOUR_TURN");
    expect(n.severity).toBe("EXPECTED_REJECTION");
  });

  it("Error 인스턴스도 동일하게 구조화한다", () => {
    const n = normalizeGameError(new Error("당신의 차례가 아닙니다."));
    expect(n.code).toBe("NOT_YOUR_TURN");
    expect(n.severity).toBe("EXPECTED_REJECTION");
  });

  it("실제 시스템 오류는 SYSTEM_ERROR로 분류한다", () => {
    const n = normalizeGameError({ code: "57014", message: "canceling statement due to statement timeout" });
    expect(n.severity).toBe("SYSTEM_ERROR");
    expect(n.code).toBe("57014");
  });

  it("알려진 필드가 없는 객체는 JSON으로 보존한다", () => {
    const n = normalizeGameError({ weird: 1 });
    expect(n.message).toBe('{"weird":1}');
    expect(n.message).not.toBe("[object Object]");
  });

  it("이미 종료된 라운드에 대한 늦은 베팅은 정상 거부로 분류한다", () => {
    const n = normalizeGameError({ code: "P0001", message: "이미 종료된 라운드입니다." });
    expect(n.severity).toBe("EXPECTED_REJECTION");
    expect(n.code).toBe("ROUND_NOT_ACTIVE");
    expect(n.message).toBe("이미 종료된 라운드입니다.");
  });

  it("빈 값도 안전한 문구를 반환한다", () => {
    expect(normalizeGameError(undefined).message).toBe("알 수 없는 오류가 발생했습니다.");
  });

  it("이미 단계가 넘어간 뒤 도착한 패 확인은 정상 거부로 분류한다", () => {
    const n = normalizeGameError(new Error("INVALID_PHASE_TRANSITION"));
    expect(n.severity).toBe("EXPECTED_REJECTION");
    expect(n.code).toBe("PHASE_ALREADY_ADVANCED");
    expect(n.message).toBe("INVALID_PHASE_TRANSITION");
  });

  it("카드 무결성 오류는 여전히 시스템 오류로 분류한다", () => {
    const n = normalizeGameError(new Error("ROUND_CARD_INTEGRITY_ERROR"));
    expect(n.severity).toBe("SYSTEM_ERROR");
  });

  it("다른 방 착석 중 입장 시도는 정상 거부로 분류한다", () => {
    const n = normalizeGameError({ code: "P0001", message: "DORI_ALREADY_IN_ANOTHER_ROOM" });
    expect(n.severity).toBe("EXPECTED_REJECTION");
    expect(n.code).toBe("ALREADY_IN_ANOTHER_ROOM");
    expect(n.message).toBe("DORI_ALREADY_IN_ANOTHER_ROOM");
  });

  it("끝난 판에 도착한 베팅은 정상 거부로 분류한다", () => {
    const n = normalizeGameError({ code: "P0001", message: "ROUND_NOT_ACTIVE" });
    expect(n.severity).toBe("EXPECTED_REJECTION");
    expect(n.code).toBe("ROUND_NOT_ACTIVE");
  });

  it("좌석 관련 서버 코드는 정상 거부로 분류한다", () => {
    expect(normalizeGameError(new Error("SEAT_TAKEN")).severity).toBe("EXPECTED_REJECTION");
    expect(normalizeGameError(new Error("ROOM_FULL")).code).toBe("SEAT_STATE_INVALID");
  });
});
