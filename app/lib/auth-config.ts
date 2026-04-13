/**
 * WebAuthn and session configuration constants.
 *
 * RP_ID and RP_ORIGIN are required environment variables —
 * the app will throw at startup if they are missing.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Relying Party display name shown during WebAuthn ceremonies. */
export const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Readmaxxing";

/** Relying Party ID — must match the domain the app is served from. */
export const RP_ID = requireEnv("WEBAUTHN_RP_ID");

/** Relying Party origin — full origin URL (e.g. https://read.example.com). */
export const RP_ORIGIN = requireEnv("WEBAUTHN_RP_ORIGIN");

/** Session max-age in seconds (30 days). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Challenge TTL in seconds (5 minutes). */
export const CHALLENGE_TTL_SECONDS = 5 * 60;
