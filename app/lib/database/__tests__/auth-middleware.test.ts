import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/auth-config", () => ({
  SESSION_MAX_AGE_SECONDS: 2592000,
}));

vi.mock("~/lib/database/auth/session", () => ({
  getSession: vi.fn(),
}));

import { setSessionCookie, clearSessionCookie, parseCookieValue } from "../auth-middleware";

describe("setSessionCookie", () => {
  it("sets a cookie with the session ID and expected attributes", () => {
    const headers = new Headers();
    setSessionCookie(headers, "sess-abc-123");

    const cookie = headers.get("Set-Cookie")!;
    expect(cookie).toContain("readmax_session=sess-abc-123");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("does not include Secure in non-production env", () => {
    const headers = new Headers();
    setSessionCookie(headers, "sess-abc-123");
    const cookie = headers.get("Set-Cookie")!;
    expect(cookie).not.toContain("Secure");
  });
});

describe("clearSessionCookie", () => {
  it("sets a cookie with empty value and Max-Age=0", () => {
    const headers = new Headers();
    clearSessionCookie(headers);

    const cookie = headers.get("Set-Cookie")!;
    expect(cookie).toContain("readmax_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});

describe("parseCookieValue", () => {
  it("extracts value from a single-cookie header", () => {
    expect(parseCookieValue("readmax_session=sess-abc", "readmax_session")).toBe("sess-abc");
  });

  it("extracts value from a multi-cookie header", () => {
    expect(
      parseCookieValue("theme=dark; readmax_session=sess-xyz; lang=en", "readmax_session"),
    ).toBe("sess-xyz");
  });

  it("returns undefined when the cookie is not present", () => {
    expect(parseCookieValue("theme=dark; lang=en", "readmax_session")).toBeUndefined();
  });

  it("returns undefined for an empty cookie header", () => {
    expect(parseCookieValue("", "readmax_session")).toBeUndefined();
  });

  it("handles cookies with no spaces after semicolons", () => {
    expect(parseCookieValue("a=1;readmax_session=sess-123;b=2", "readmax_session")).toBe(
      "sess-123",
    );
  });

  it("handles cookie values containing equals signs", () => {
    expect(parseCookieValue("readmax_session=abc=def=ghi", "readmax_session")).toBe("abc=def=ghi");
  });

  it("does not match partial cookie name prefixes", () => {
    expect(parseCookieValue("readmax_session_extra=nope", "readmax_session")).toBeUndefined();
  });
});
