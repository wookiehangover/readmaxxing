// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliCallback, sendCliCallback } from "../cli-login-callback";

const state = "a".repeat(43);
const url = "http://127.0.0.1:54321/callback";
afterEach(() => vi.unstubAllGlobals());

describe("browser callback", () => {
  it("accepts the CLI's loopback URL and rejects other destinations or missing state", () => {
    expect(parseCliCallback(new URLSearchParams({ callback: url, state }))).toEqual({ url, state });
    for (const callback of [
      "https://attacker.example/callback",
      "http://127.0.0.1.attacker.example:54321/callback",
      "http://localhost:54321/callback",
      "http://192.168.1.1:54321/callback",
      "http://user:password@127.0.0.1:54321/callback",
      "http://127.0.0.1:80/callback",
      `${url}?redirect=elsewhere`,
      `${url}#fragment`,
      `${url}/extra`,
    ]) {
      expect(parseCliCallback(new URLSearchParams({ callback, state }))).toBeNull();
    }
    expect(parseCliCallback(new URLSearchParams({ callback: url }))).toBeNull();
    expect(parseCliCallback(new URLSearchParams({ callback: url, state: "invalid" }))).toBeNull();
  });
  it("sends the token in a POST body without cookies or redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await sendCliCallback({ url, state }, "token");
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "token", state }),
        credentials: "omit",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("requires a successful acknowledgement", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const response of [
      new Response("", { status: 400 }),
      Response.json({ ok: false }),
      new Response("not json"),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(sendCliCallback({ url, state }, "token")).rejects.toThrow();
    }
  });
});
