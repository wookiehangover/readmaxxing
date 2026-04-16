/**
 * WebAuthn and session configuration constants.
 *
 * RP_ID and RP_ORIGIN are required environment variables.
 */

/** Relying Party display name shown during WebAuthn ceremonies. */
export const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Readmaxxing";

/** Relying Party ID — must match the domain the app is served from. */
export function getRpId(): string {
  const value = process.env.WEBAUTHN_RP_ID;
  if (!value) throw new Error("Missing required environment variable: WEBAUTHN_RP_ID");
  return value;
}

/** Relying Party origin — full origin URL. */
export function getRpOrigin(): string {
  const value = process.env.WEBAUTHN_RP_ORIGIN;
  if (!value) throw new Error("Missing required environment variable: WEBAUTHN_RP_ORIGIN");
  return value;
}

/** Session max-age in seconds (30 days). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Challenge TTL in seconds (5 minutes). */
export const CHALLENGE_TTL_SECONDS = 5 * 60;
