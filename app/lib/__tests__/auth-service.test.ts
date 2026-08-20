import { startRegistration } from "@simplewebauthn/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authService } from "~/lib/auth-service";

vi.mock("@simplewebauthn/browser", () => ({ startRegistration: vi.fn() }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AuthService passkeys", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists passkeys", async () => {
    const passkeys = [
      {
        id: "credential-1",
        name: "Laptop",
        createdAt: "2026-07-24T00:00:00.000Z",
        deviceType: "multiDevice",
        backedUp: true,
        lastUsedAt: null,
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse({ passkeys }));

    const result = await authService.listPasskeys();

    expect(result).toEqual(passkeys);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/passkeys");
  });

  it("adds a passkey through the browser registration ceremony", async () => {
    const options = { challenge: "challenge" };
    const registration = { id: "credential-2" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ options, challengeId: "challenge-row-1" }))
      .mockResolvedValueOnce(jsonResponse({ verified: true }));
    vi.mocked(startRegistration).mockResolvedValueOnce(
      registration as Awaited<ReturnType<typeof startRegistration>>,
    );

    const result = await authService.addPasskey();

    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/passkeys/register-options", {
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/passkeys/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: "challenge-row-1", response: registration }),
    });
    expect(result).toEqual({ verified: true });
  });

  it("renames a passkey", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await authService.renamePasskey("credential/1", "Phone");

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/passkeys/credential%2F1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Phone" }),
    });
  });

  it("removes a passkey", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await authService.removePasskey("credential-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/passkeys/credential-1", {
      method: "DELETE",
    });
  });

  it("maps route failures to AuthError", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Cannot remove the last passkey" }, 400));

    const error = await authService.removePasskey("credential-1").catch((cause) => cause);

    expect(error).toMatchObject({
      _tag: "AuthError",
      operation: "removePasskey",
      cause: new Error("Cannot remove the last passkey"),
    });
  });
});
