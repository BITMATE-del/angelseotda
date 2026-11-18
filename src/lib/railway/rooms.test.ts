import { describe, expect, it } from "vitest";
import { isRoomUuid, validMode } from "./rooms.server";

describe("Railway waiting-room input gates", () => {
  it("accepts only supported game modes", () => {
    expect(validMode("SUTDA2")).toBe(true);
    expect(validMode("SUTDA3")).toBe(true);
    expect(validMode("DORI")).toBe(true);
    expect(validMode("CFD")).toBe(false);
    expect(validMode("")).toBe(false);
    expect(validMode(null)).toBe(false);
  });

  it("requires an exact UUID room identifier", () => {
    expect(isRoomUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isRoomUuid("00000000-0000-4000-8000-000000000001'")).toBe(false);
    expect(isRoomUuid("00000000-0000-0000-0000-000000000001-extra")).toBe(false);
    expect(isRoomUuid("not-a-room")).toBe(false);
    expect(isRoomUuid({ id: "00000000-0000-4000-8000-000000000001" })).toBe(false);
  });
});
