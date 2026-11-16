import { describe, expect, it } from "vitest";
import {
  ANGEL_SESSION_COOKIE,
  clearCookieHeader,
  cookieHeader,
  isSameOriginPost,
  tokenFromCookie,
} from "./session.server";

describe("Railway Telegram session boundaries", () => {
  const token = "ab".repeat(32);

  it("issues a secure host-only HttpOnly cookie", () => {
    const cookie = cookieHeader(token);
    expect(cookie).toContain(`${ANGEL_SESSION_COOKIE}=${token}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=43200");
  });

  it("parses only a 64-character lowercase hexadecimal session token", () => {
    expect(tokenFromCookie(`other=1; ${ANGEL_SESSION_COOKIE}=${token}`)).toBe(token);
    expect(tokenFromCookie(`${ANGEL_SESSION_COOKIE}=abc`)).toBeNull();
    expect(tokenFromCookie(`${ANGEL_SESSION_COOKIE}=${"A".repeat(64)}`)).toBeNull();
    expect(tokenFromCookie(null)).toBeNull();
  });

  it("expires the cookie for logout", () => {
    expect(clearCookieHeader()).toContain("Max-Age=0");
  });

  it("rejects cross-origin and non-JSON login submissions", () => {
    const url = "https://preview.example.com/api/public/railway-auth";
    const req = (origin: string, type: string) => new Request(url, {
      method: "POST",
      headers: { origin, "content-type": type }
    });
    expect(isSameOriginPost(req("https://preview.example.com", "application/json"))).toBe(true);
    expect(isSameOriginPost(req("https://evil.example.com", "application/json"))).toBe(false);
    expect(isSameOriginPost(req("https://preview.example.com", "text/plain"))).toBe(false);
    expect(isSameOriginPost(new Request(url, { method: "POST" }))).toBe(false);
  });
});
