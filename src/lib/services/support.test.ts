import { describe, expect, it } from "vitest";
import { normalizeTelegramLink } from "@/lib/services/supportService";
import { kstDateKey, popupExternalUrl, popupImagePath } from "@/lib/services/eventPopupService";

describe("고객센터 Telegram 링크 정규화", () => {
  it("@아이디를 t.me 주소로 변환한다", () => {
    expect(normalizeTelegramLink("@angel_support")).toEqual({
      ok: true,
      url: "https://t.me/angel_support",
    });
  });

  it("이미 t.me 주소면 그대로 사용한다", () => {
    expect(normalizeTelegramLink("https://t.me/angel_support").url).toBe(
      "https://t.me/angel_support",
    );
  });

  it("공백과 http, 끝 슬래시를 정리한다", () => {
    expect(normalizeTelegramLink(" http://t.me/angel_support/ ").url).toBe(
      "https://t.me/angel_support",
    );
    expect(normalizeTelegramLink("t.me/angel_support").url).toBe("https://t.me/angel_support");
  });

  it("빈 값은 미설정으로 허용한다", () => {
    expect(normalizeTelegramLink("   ")).toEqual({ ok: true, url: "" });
  });

  it("텔레그램이 아닌 주소는 차단한다", () => {
    const r = normalizeTelegramLink("https://example.com/support");
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("허용되지 않는 아이디 형식은 차단한다", () => {
    expect(normalizeTelegramLink("@ab").ok).toBe(false);
    expect(normalizeTelegramLink("@bad-id!").ok).toBe(false);
  });
});

describe("팝업 오늘 다시 보지 않기 (KST)", () => {
  it("KST 날짜 기준으로 키를 만든다", () => {
    // 2026-09-07 16:00 UTC = 2026-09-08 01:00 KST
    expect(kstDateKey(new Date("2026-09-07T16:00:00Z"))).toBe("2026-09-08");
    expect(kstDateKey(new Date("2026-09-07T14:00:00Z"))).toBe("2026-09-07");
  });
});

describe("이벤트 팝업 이미지 값", () => {
  it("과거 public URL에서 storage 경로를 복구한다", () => {
    expect(
      popupImagePath(
        "https://x.supabase.co/storage/v1/object/public/shop-assets/popups/a.png",
      ),
    ).toBe("popups/a.png");
  });
  it("signed URL의 token을 제거하고 경로만 남긴다", () => {
    expect(
      popupImagePath("https://x.supabase.co/storage/v1/object/sign/shop-assets/popups/b.png?token=zz"),
    ).toBe("popups/b.png");
  });
  it("blob/localhost 값은 사용하지 않는다", () => {
    expect(popupImagePath("blob:http://x/1")).toBeNull();
    expect(popupImagePath("http://localhost:8080/a.png")).toBeNull();
  });
  it("storage 경로는 그대로 유지한다", () => {
    expect(popupImagePath("popups/c.webp")).toBe("popups/c.webp");
  });
  it("외부 이미지 주소는 그대로 사용한다", () => {
    expect(popupExternalUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(popupExternalUrl("popups/c.webp")).toBeNull();
  });
});
