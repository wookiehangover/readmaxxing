// @vitest-environment node

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMagicLinkByHashMock = vi.hoisted(() => vi.fn());
const createSessionMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/database/auth/magic-link", () => ({
  getMagicLinkByHash: getMagicLinkByHashMock,
}));

vi.mock("~/lib/database/auth/session", () => ({
  createSession: createSessionMock,
  getSession: vi.fn(),
}));

import { SESSION_MAX_AGE_SECONDS } from "~/lib/auth-config";
import { loader } from "~/routes/api.auth.magic-link.consume";

const NOW = new Date("2026-07-15T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getMagicLinkByHashMock.mockReset();
  createSessionMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function load(token: string): Promise<Response> {
  const url = new URL("http://localhost/api/auth/magic-link/consume");
  url.searchParams.set("token", token);
  try {
    return await loader({ request: new Request(url), params: {}, context: {} } as Parameters<
      typeof loader
    >[0]);
  } catch (cause) {
    if (cause instanceof Response) return cause;
    throw cause;
  }
}

describe("magic link consume loader", () => {
  it("creates a session cookie and redirects valid links to the app", async () => {
    getMagicLinkByHashMock.mockResolvedValue({
      id: "link-1",
      userId: "user-1",
      tokenHash: "stored-hash",
      expiresAt: new Date(NOW.getTime() + 60_000),
      createdAt: NOW,
    });
    createSessionMock.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(NOW.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
      createdAt: NOW,
    });

    const response = await load("valid-token");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(response.headers.get("Set-Cookie")).toContain("readmax_session=session-1");
    expect(getMagicLinkByHashMock).toHaveBeenCalledWith(
      createHash("sha256").update("valid-token").digest("hex"),
    );
    expect(createSessionMock).toHaveBeenCalledWith(
      "user-1",
      new Date(NOW.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
    );
  });

  it("redirects expired links to the login error state", async () => {
    getMagicLinkByHashMock.mockResolvedValue({
      id: "link-1",
      userId: "user-1",
      tokenHash: "stored-hash",
      expiresAt: new Date(NOW.getTime() - 1),
      createdAt: NOW,
    });

    const response = await load("expired-token");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?error=magic_link");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("redirects invalid links to the login error state", async () => {
    getMagicLinkByHashMock.mockResolvedValue(null);

    const response = await load("invalid-token");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?error=magic_link");
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
