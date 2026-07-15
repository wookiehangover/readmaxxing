import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateMagicLinkToken } from "~/lib/auth-token.server";

describe("generateMagicLinkToken", () => {
  it("returns the SHA-256 hash of the generated token", () => {
    const { token, tokenHash } = generateMagicLinkToken();

    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("generates unique tokens", () => {
    const first = generateMagicLinkToken();
    const second = generateMagicLinkToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });
});
