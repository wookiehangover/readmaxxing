// @vitest-environment node

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool } from "~/lib/database/pool";
import { loader } from "~/routes/api.auth.login-options";
import { action } from "~/routes/api.auth.login-verify";

const origin = "https://example.com";
const user = { id: "user-1", displayName: "Reader" };

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  vi.stubEnv("WEBAUTHN_RP_ID", "example.com");
  vi.stubEnv("WEBAUTHN_RP_ORIGIN", origin);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function signedAssertion(challenge: string, userVerified: boolean) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Missing public key coordinates");
  const coseKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // EC2
      [3, -7], // ES256
      [-1, 1], // P-256
      [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
      [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
    ]),
  );
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin }));
  const authenticatorData = Buffer.concat([
    createHash("sha256").update("example.com").digest(),
    Buffer.from([userVerified ? 0x05 : 0x01]), // User presence, plus optional verification.
    Buffer.from([0, 0, 0, 1]), // Signature counter.
  ]);
  const signature = sign(
    "sha256",
    Buffer.concat([authenticatorData, createHash("sha256").update(clientData).digest()]),
    privateKey,
  );
  const id = randomBytes(32).toString("base64url");
  const response: AuthenticationResponseJSON = {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url"),
    },
  };
  return { response, publicKey: Buffer.from(coseKey) };
}

describe("passkey sign-in user verification", () => {
  it("asks the browser to verify the user for discoverable passkeys", async () => {
    vi.spyOn(getPool(), "query").mockImplementationOnce(async () => ({
      rows: [{ id: "challenge-row" }],
    }));

    const response = await loader();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      challengeId: "challenge-row",
      options: { rpId: "example.com", allowCredentials: [], userVerification: "required" },
    });
  });

  it.each([false, true])(
    "verifies an actual signed assertion with userVerified=%s",
    async (userVerified) => {
      const challenge = randomBytes(32).toString("base64url");
      const assertion = signedAssertion(challenge, userVerified);
      const query = vi
        .spyOn(getPool(), "query")
        .mockImplementationOnce(async () => ({ rows: [{ challenge }] }))
        .mockImplementationOnce(async () => ({ rowCount: 1, rows: [] })) // Consume the challenge.
        .mockImplementationOnce(async () => ({
          rows: [
            {
              id: assertion.response.id,
              userId: user.id,
              publicKey: assertion.publicKey,
              counter: 0,
            },
          ],
        }))
        .mockImplementationOnce(async () => ({ rowCount: 1, rows: [] })) // Update counter.
        .mockImplementationOnce(async () => ({ rowCount: 1, rows: [] })) // Update last-used timestamp.
        .mockImplementationOnce(async () => ({ rows: [{ id: "session-1" }] }))
        .mockImplementationOnce(async () => ({ rows: [user] }));

      const response = await action({
        request: new Request(`${origin}/api/auth/login-verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId: "challenge-row", response: assertion.response }),
        }),
      });

      if (userVerified) {
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ verified: true, user });
        expect(response.headers.get("set-cookie")).toContain("readmax_session=session-1");
      } else {
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: "Verification failed",
          detail: "Error: User verification required, but user could not be verified",
        });
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(query).toHaveBeenCalledTimes(3);
      }
    },
  );
});
