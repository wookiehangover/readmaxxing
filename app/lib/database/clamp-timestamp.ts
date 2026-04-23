/**
 * Clamp a client-provided timestamp to at most `skewMs` after the server's
 * current time. Prevents a device with a fast or adversarial clock from
 * poisoning the pull cursor with far-future `updated_at` values.
 *
 * Returns an ISO string suitable for binding directly into a SQL timestamp
 * parameter. When `ts` is null/undefined/invalid, falls back to server
 * NOW().
 */
export const DEFAULT_UPDATED_AT_SKEW_MS = 5 * 60 * 1000;

export function clampUpdatedAt(
  ts: Date | null | undefined,
  skewMs: number = DEFAULT_UPDATED_AT_SKEW_MS,
): string {
  const now = Date.now();
  const upperBound = now + skewMs;
  const candidate = ts?.getTime();
  const effective = candidate != null && Number.isFinite(candidate) ? candidate : now;
  const clamped = Math.min(effective, upperBound);
  return new Date(clamped).toISOString();
}
