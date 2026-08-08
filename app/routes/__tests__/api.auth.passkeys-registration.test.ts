// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteChallenge: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  getChallenge: vi.fn(),
  getPasskeysByUserId: vi.fn(),
  requireAuth: vi.fn(),
  saveChallenge: vi.fn(),
  savePasskey: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
}));
vi.mock("~/lib/auth-config", () => ({
  RP_NAME: "Readmaxxing",
  CHALLENGE_TTL_SECONDS: 300,
  getRpId: () => "example.com",
  getRpOrigin: () => "https://example.com",
}));
vi.mock("~/lib/database/auth/challenge", () => ({
  deleteChallenge: mocks.deleteChallenge,
  getChallenge: mocks.getChallenge,
  saveChallenge: mocks.saveChallenge,
}));
vi.mock("~/lib/database/auth-middleware", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("~/lib/database/auth/passkey", () => ({
  getPasskeysByUserId: mocks.getPasskeysByUserId,
  savePasskey: mocks.savePasskey,
}));

import { action as optionsAction } from "~/routes/api.auth.passkeys.register-options";
import { action as verifyAction } from "~/routes/api.auth.passkeys.register-verify";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgres://configured";
  mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
});

function post(path: string, body?: unknown): Request {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("add-passkey registration options", () => {
  it("uses the session user handle, excludes existing passkeys, and owns the challenge", async () => {
    mocks.getPasskeysByUserId.mockResolvedValue([
      { id: "credential-1", transports: "internal,hybrid" },
    ]);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "challenge-1" });
    mocks.saveChallenge.mockResolvedValue({ id: "challenge-row-1" });

    const request = post("/api/auth/passkeys/register-options");
    const response = await optionsAction({ request });

    expect(mocks.requireAuth).toHaveBeenCalledWith(request);
    expect(mocks.getPasskeysByUserId).toHaveBeenCalledWith("user-1");
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        userID: new TextEncoder().encode("user-1"),
        excludeCredentials: [{ id: "credential-1", transports: ["internal", "hybrid"] }],
      }),
    );
    expect(mocks.saveChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", type: "registration" }),
    );
    await expect(response.json()).resolves.toEqual({
      options: { challenge: "challenge-1" },
      challengeId: "challenge-row-1",
    });
  });

  it("returns 500 when saveChallenge fails", async () => {
    mocks.getPasskeysByUserId.mockResolvedValue([]);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "challenge-1" });
    mocks.saveChallenge.mockResolvedValue(null);

    const request = post("/api/auth/passkeys/register-options");
    const response = await optionsAction({ request });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Failed to create challenge" });
  });
});

describe("add-passkey registration verification", () => {
  it("rejects invalid JSON body", async () => {
    const request = new Request("https://example.com/api/auth/passkeys/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    const response = await verifyAction({ request });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body" });
  });

  it("rejects missing challengeId", async () => {
    const response = await verifyAction({
      request: post("/api/auth/passkeys/register-verify", {
        response: { id: "credential-1" },
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.getChallenge).not.toHaveBeenCalled();
  });

  it("rejects empty string challengeId", async () => {
    const response = await verifyAction({
      request: post("/api/auth/passkeys/register-verify", {
        challengeId: "",
        response: { id: "credential-1" },
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.getChallenge).not.toHaveBeenCalled();
  });

  it("rejects numeric challengeId", async () => {
    const response = await verifyAction({
      request: post("/api/auth/passkeys/register-verify", {
        challengeId: 123,
        response: { id: "credential-1" },
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.getChallenge).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied foreign user ID", async () => {
    const response = await verifyAction({
      request: post("/api/auth/passkeys/register-verify", {
        challengeId: "challenge-row-1",
        userId: "user-2",
        response: { id: "credential-1" },
      }),
    });

    expect(response.status).toBe(403);
    expect(mocks.getChallenge).not.toHaveBeenCalled();
    expect(mocks.savePasskey).not.toHaveBeenCalled();
  });

  it("rejects a registration challenge owned by another user", async () => {
    mocks.getChallenge.mockResolvedValue({
      challenge: "challenge-1",
      type: "registration",
      userId: "user-2",
    });

    const response = await verifyAction({
      request: post("/api/auth/passkeys/register-verify", {
        challengeId: "challenge-row-1",
        response: { id: "credential-1" },
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.deleteChallenge).not.toHaveBeenCalled();
    expect(mocks.savePasskey).not.toHaveBeenCalled();
  });

  it("saves a verified passkey only for the session user", async () => {
    mocks.getChallenge.mockResolvedValue({
      challenge: "challenge-1",
      type: "registration",
      userId: "user-1",
    });
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

    const response = await verifyAction({
      request: post("/api/auth/passkeys/register-verify", {
        challengeId: "challenge-row-1",
        response: { id: "credential-1" },
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.deleteChallenge).toHaveBeenCalledWith("challenge-row-1");
    expect(mocks.savePasskey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", webauthnUserId: "user-1" }),
    );
    await expect(response.json()).resolves.toEqual({ verified: true });
  });
});
