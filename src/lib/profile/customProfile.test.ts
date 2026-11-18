import { describe, expect, it } from "vitest";
import {
  CUSTOM_PROFILE_DAYS,
  CUSTOM_PROFILE_PRICE,
  coverCropRect,
  customProfileRemainLabel,
  customProfileStatusLabel,
  formatFileSize,
  validateProfileDimensions,
  validateProfileFile,
} from "./customProfile";

describe("커스텀 프로필 정책", () => {
  it("가격/기간은 30,000P · 7일 고정", () => {
    expect(CUSTOM_PROFILE_PRICE).toBe(30_000);
    expect(CUSTOM_PROFILE_DAYS).toBe(7);
  });

  it("JPG/PNG/WEBP만 허용한다", () => {
    expect(validateProfileFile({ name: "a.jpg", type: "image/jpeg", size: 1000 }).ok).toBe(true);
    expect(validateProfileFile({ name: "a.png", type: "image/png", size: 1000 }).ok).toBe(true);
    expect(validateProfileFile({ name: "a.webp", type: "image/webp", size: 1000 }).ok).toBe(true);
  });

  it("SVG/GIF 등 비허용 형식은 차단한다", () => {
    const svg = validateProfileFile({ name: "a.svg", type: "image/svg+xml", size: 1000 });
    expect(svg.ok).toBe(false);
    expect(svg.message).toContain("JPG, PNG, WEBP");
    expect(validateProfileFile({ name: "a.gif", type: "image/gif", size: 1000 }).ok).toBe(false);
    expect(validateProfileFile({ name: "a.exe", type: "application/x-msdownload", size: 10 }).ok).toBe(false);
    // 확장자만 위장한 경우도 차단
    expect(validateProfileFile({ name: "a.png", type: "image/svg+xml", size: 10 }).ok).toBe(false);
  });

  it("5MB 초과는 차단한다", () => {
    const r = validateProfileFile({ name: "a.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 + 1 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("5MB");
    expect(validateProfileFile({ name: "a.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 }).ok).toBe(true);
  });

  it("400px 미만 / 2000px 초과 해상도는 차단한다", () => {
    expect(validateProfileDimensions(399, 800).ok).toBe(false);
    expect(validateProfileDimensions(400, 400).ok).toBe(true);
    expect(validateProfileDimensions(2000, 2000).ok).toBe(true);
    expect(validateProfileDimensions(2001, 800).ok).toBe(false);
  });

  it("중앙 크롭은 정사각형이며 긴 변을 잘라낸다", () => {
    expect(coverCropRect(1200, 800)).toEqual({ sx: 200, sy: 0, size: 800 });
    expect(coverCropRect(800, 1200)).toEqual({ sx: 0, sy: 200, size: 800 });
    expect(coverCropRect(800, 800)).toEqual({ sx: 0, sy: 0, size: 800 });
  });

  it("상태 문구는 미구매/사용중/만료 예정/만료됨/관리자 해제로 구분된다", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    expect(customProfileStatusLabel("NONE", false, null, now)).toBe("미구매");
    expect(customProfileStatusLabel("ACTIVE", true, "2026-01-16T00:00:00Z", now)).toBe("사용중");
    expect(customProfileStatusLabel("ACTIVE", true, "2026-01-10T06:00:00Z", now)).toBe("만료 예정");
    expect(customProfileStatusLabel("EXPIRED", false, "2026-01-09T00:00:00Z", now)).toBe("만료됨");
    expect(customProfileStatusLabel("DISABLED", false, "2026-01-16T00:00:00Z", now)).toBe("관리자 해제");
  });

  it("남은 기간 문구", () => {
    const now = Date.parse("2026-01-10T00:00:00Z");
    expect(customProfileRemainLabel("2026-01-16T14:00:00Z", now)).toBe("6일 14시간");
    expect(customProfileRemainLabel("2026-01-09T00:00:00Z", now)).toBe("만료");
    expect(customProfileRemainLabel(null, now)).toBe("-");
  });

  it("용량 표기", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024 * 300)).toBe("300 KB");
    expect(formatFileSize(1024 * 1024 * 1.25)).toBe("1.3 MB");
  });
});
