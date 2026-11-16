import { describe, expect, it } from "vitest";
import { resolveAvatarUrl } from "./resolveAvatar";

describe("resolveAvatarUrl", () => {
  it("활성 커스텀 프로필이 장착 캐릭터보다 우선한다", () => {
    expect(
      resolveAvatarUrl({
        customProfileUrl: "custom.webp",
        equippedCharacterUrl: "character.png",
        defaultProfileUrl: "default.png",
      }),
    ).toBe("custom.webp");
  });

  it("커스텀 프로필이 없으면 장착 캐릭터를 사용한다", () => {
    expect(
      resolveAvatarUrl({
        customProfileUrl: null,
        equippedCharacterUrl: "character.png",
        defaultProfileUrl: "default.png",
      }),
    ).toBe("character.png");
  });

  it("장착 캐릭터도 없으면 기본 프로필 → fallback 순서다", () => {
    expect(resolveAvatarUrl({ defaultProfileUrl: "default.png", fallbackUrl: "f.png" })).toBe(
      "default.png",
    );
    expect(resolveAvatarUrl({ fallbackUrl: "f.png" })).toBe("f.png");
    expect(resolveAvatarUrl({})).toBeNull();
  });

  it("빈 문자열은 값 없음으로 취급한다", () => {
    expect(resolveAvatarUrl({ customProfileUrl: "   ", equippedCharacterUrl: "c.png" })).toBe(
      "c.png",
    );
  });
});
