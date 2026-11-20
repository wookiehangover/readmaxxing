export const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Readmaxxing";

export function getRpId(): string {
  const value = process.env.WEBAUTHN_RP_ID;
  if (!value) throw new Error("Missing required environment variable: WEBAUTHN_RP_ID");
  return value;
}

export function getRpOrigin(): string {
  const value = process.env.WEBAUTHN_RP_ORIGIN;
  if (!value) throw new Error("Missing required environment variable: WEBAUTHN_RP_ORIGIN");
  return value;
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const CHALLENGE_TTL_SECONDS = 5 * 60;

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
