import { createHmac, timingSafeEqual } from "node:crypto";
import type { ShareLinkRow } from "~/lib/database/share/share-link";
import { getEnv } from "~/lib/env.server";

const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

function getDownloadSecret(): string | null {
  return getEnv().SHARE_DOWNLOAD_SECRET ?? null;
}

export function signDownloadToken(shareId: string, useCount: number): string | null {
  const secret = getDownloadSecret();
  if (!secret) return null;

  const expiresAt = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const data = `${shareId}.${useCount}.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyDownloadToken(token: string, shareLink: ShareLinkRow): boolean {
  const secret = getDownloadSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [shareId, useCountText, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  const useCount = Number(useCountText);
  if (
    shareId !== shareLink.id ||
    useCount !== shareLink.useCount ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return false;
  }

  const data = `${shareId}.${useCountText}.${expiresAtText}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
