// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  upsertUser: vi.fn(),
  getPasskeysByUserId: vi.fn(),
  saveChallenge: vi.fn(),
  getChallenge: vi.fn(),
  deleteChallenge: vi.fn(),
  savePasskey: vi.fn(),
  createSession: vi.fn(),
  setSessionCookie: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
}));
vi.mock("~/lib/auth-config", () => ({
  RP_NAME: "Readmaxxing",
  CHALLENGE_TTL_SECONDS: 300,
  SESSION_MAX_AGE_SECONDS: 2_592_000,
  getRpId: () => "example.com",
  getRpOrigin: () => "https://example.com",
}));
vi.mock("~/lib/database/user/user", () => ({ upsertUser: mocks.upsertUser }));
vi.mock("~/lib/database/auth/passkey", () => ({
  getPasskeysByUserId: mocks.getPasskeysByUserId,
  savePasskey: mocks.savePasskey,
}));
vi.mock("~/lib/database/auth/challenge", () => ({
  saveChallenge: mocks.saveChallenge,
  getChallenge: mocks.getChallenge,
  deleteChallenge: mocks.deleteChallenge,
}));
vi.mock("~/lib/database/auth/session", () => ({ createSession: mocks.createSession }));
vi.mock("~/lib/database/auth-middleware", () => ({
  setSessionCookie: mocks.setSessionCookie,
}));

import { loader } from "~/routes/api.auth.register-options";
import { action } from "~/routes/api.auth.register-verify";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgres://configured";
});

describe("create-account passkey registration", () => {
  it("uses the newly created account ID as the WebAuthn user handle", async () => {
    mocks.upsertUser.mockImplementation(async (id: string) => ({
      id,
      displayName: null,
      createdAt: new Date(),
      lastSyncAt: null,
    }));
    mocks.getPasskeysByUserId.mockResolvedValue([]);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "challenge-1" });
    mocks.saveChallenge.mockResolvedValue({ id: "challenge-row-1" });

    const response = await loader();
    const body = (await response.json()) as { userId: string };

    expect(mocks.upsertUser).toHaveBeenCalledOnce();
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ userID: new TextEncoder().encode(body.userId) }),
    );
    expect(mocks.saveChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ userId: body.userId }),
    );
  });

  it("persists the account ID as the WebAuthn user ID after verification", async () => {
    mocks.getChallenge.mockResolvedValue({ challenge: "challenge-1", userId: "user-1" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "credential-1",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });
    mocks.createSession.mockResolvedValue({ id: "session-1" });

    const response = await action({
      request: new Request("https://example.com/api/auth/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: "challenge-row-1",
          userId: "user-1",
          response: { id: "credential-1" },
        }),
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.savePasskey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", webauthnUserId: "user-1" }),
    );
  });
});
