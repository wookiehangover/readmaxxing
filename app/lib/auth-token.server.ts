import { createHash, randomBytes } from "node:crypto";

export interface MagicLinkToken {
  token: string;
  tokenHash: string;
}

export function generateMagicLinkToken(): MagicLinkToken {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}
