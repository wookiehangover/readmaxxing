import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/database/auth-middleware", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/database/auth/passkey", () => ({ getPasskeysByUserId: vi.fn() }));

import { requireAuth } from "~/lib/database/auth-middleware";
import { getPasskeysByUserId } from "~/lib/database/auth/passkey";
import { loader } from "~/routes/api.auth.passkeys";

const requireAuthMock = vi.mocked(requireAuth);
const getPasskeysByUserIdMock = vi.mocked(getPasskeysByUserId);
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://example";
  requireAuthMock.mockReset();
  requireAuthMock.mockResolvedValue({ userId: "user-1" });
  getPasskeysByUserIdMock.mockReset();
  getPasskeysByUserIdMock.mockResolvedValue([]);
});

afterEach(() => {
  if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

async function resolveResponse(result: Promise<Response>): Promise<Response> {
  try {
    return await result;
  } catch (cause) {
    if (cause instanceof Response) return cause;
    throw cause;
  }
}

describe("passkey list API", () => {
  it("requires an authenticated session", async () => {
    requireAuthMock.mockRejectedValue(Response.json({ error: "auth_required" }, { status: 401 }));

    const response = await resolveResponse(
      loader({ request: new Request("http://localhost/api/auth/passkeys") }),
    );

    expect(response.status).toBe(401);
    expect(getPasskeysByUserIdMock).not.toHaveBeenCalled();
  });

  it("returns only public fields for the current user's passkeys", async () => {
    getPasskeysByUserIdMock.mockResolvedValue([
      {
        id: "passkey-1",
        userId: "user-1",
        publicKey: Buffer.from("private credential material"),
        webauthnUserId: "user-1",
        counter: 3,
        deviceType: "multiDevice",
        backedUp: true,
        transports: "internal",
        name: "Laptop",
        lastUsedAt: new Date("2026-07-23T12:00:00.000Z"),
        createdAt: new Date("2026-07-22T12:00:00.000Z"),
      },
    ]);

    const response = await loader({
      request: new Request("http://localhost/api/auth/passkeys"),
    });

    expect(getPasskeysByUserIdMock).toHaveBeenCalledWith("user-1");
    await expect(response.json()).resolves.toEqual({
      passkeys: [
        {
          id: "passkey-1",
          name: "Laptop",
          createdAt: "2026-07-22T12:00:00.000Z",
          deviceType: "multiDevice",
          backedUp: true,
          lastUsedAt: "2026-07-23T12:00:00.000Z",
        },
      ],
    });
  });
});
