// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";
import { startLoginCallback, type LoginCallback } from "../src/login-callback";

const origin = "https://readmaxxing.app";
const token = "12345678-1234-1234-1234-123456789abc";
let callback: LoginCallback | undefined;
afterEach(async () => {
  await callback?.close();
  callback = undefined;
});

function post(state = callback!.state, value = token, requestOrigin = origin) {
  return fetch(callback!.url, {
    method: "POST",
    headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ state, token: value }),
  });
}

describe("temporary login callback server", () => {
  it("accepts one matching callback and acknowledges only after credentials are saved", async () => {
    const connect = vi.fn(async () => {});
    callback = await startLoginCallback(origin, connect);
    expect(new URL(callback.url).hostname).toBe("127.0.0.1");
    expect(callback.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const response = await post();
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(await callback.result).toBe("connected");
    expect(connect).toHaveBeenCalledWith(token, expect.any(AbortSignal));
    await expect(post()).rejects.toThrow();
  });
  it("supports the browser's CORS and private-network preflight", async () => {
    callback = await startLoginCallback(origin, vi.fn());
    const response = await fetch(callback.url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("access-control-allow-private-network")).toBe("true");
  });
  it("finishes login if the browser disconnects while the session is being saved", async () => {
    let started!: () => void;
    let finish!: () => void;
    const beginning = new Promise<void>((resolve) => {
      started = resolve;
    });
    callback = await startLoginCallback(
      origin,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const controller = new AbortController();
    const request = fetch(callback.url, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token, state: callback.state }),
      signal: controller.signal,
    }).catch(() => null);
    await beginning;
    controller.abort();
    await request;
    finish();
    expect(await callback.result).toBe("connected");
  });
  it("rejects wrong origins, state, hosts, paths, and malformed payloads without consuming login", async () => {
    const connect = vi.fn(async () => {});
    callback = await startLoginCallback(origin, connect);
    expect((await post(callback.state, token, "https://attacker.example")).status).toBe(403);
    expect((await post("x".repeat(43))).status).toBe(403);
    expect((await post(callback.state, "invalid-token")).status).toBe(400);
    const wrongHost = await new Promise<{ status: number; allowOrigin: unknown }>(
      (resolve, reject) => {
        const request = httpRequest(
          callback!.url,
          { method: "POST", headers: { Origin: origin, Host: "attacker.example" } },
          (response) => {
            response.resume();
            resolve({
              status: response.statusCode!,
              allowOrigin: response.headers["access-control-allow-origin"],
            });
          },
        );
        request.on("error", reject);
        request.end();
      },
    );
    expect(wrongHost.status).toBe(403);
    expect(wrongHost.allowOrigin).toBeUndefined();
    expect((await fetch(callback.url, { headers: { Origin: origin } })).status).toBe(405);
    expect(
      (await fetch(callback.url + "/other", { method: "POST", headers: { Origin: origin } }))
        .status,
    ).toBe(404);
    expect(
      (
        await fetch(callback.url, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect(connect).not.toHaveBeenCalled();
    expect((await post()).status).toBe(200);
  });
  it("allows manual fallback when authentication fails", async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce(undefined);
    callback = await startLoginCallback(origin, connect);
    expect((await post()).status).toBe(400);
    expect((await post()).status).toBe(200);
    expect(await callback.result).toBe("connected");
  });
  it("closes after its timeout and after cancellation", async () => {
    callback = await startLoginCallback(origin, vi.fn(), 30);
    expect(await callback.result).toBe("closed");
    await expect(post()).rejects.toThrow();
    await callback.close();
    callback = await startLoginCallback(origin, vi.fn());
    await callback.close();
    expect(await callback.result).toBe("closed");
    await expect(post()).rejects.toThrow();
  });
  it("cancels in-flight authentication before allowing a manual attempt", async () => {
    let started!: () => void;
    const beginning = new Promise<void>((resolve) => {
      started = resolve;
    });
    callback = await startLoginCallback(
      origin,
      (_token, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
          started();
        }),
    );
    const request = post().catch(() => null);
    await beginning;
    expect((await post()).status).toBe(409);
    await callback.close();
    expect(await callback.result).toBe("closed");
    await request;
  });
});
