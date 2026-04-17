/**
 * Server-side auth helpers for reading/writing session cookies
 * and enforcing authentication on requests.
 */

import { SESSION_MAX_AGE_SECONDS } from "~/lib/auth-config";
import { getSession } from "./auth/session";

const SESSION_COOKIE_NAME = "readmax_session";

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Append a Set-Cookie header that persists the session ID.
 */
export function setSessionCookie(headers: Headers, sessionId: string): void {
  const isSecure = process.env.NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (isSecure) {
    parts.push("Secure");
  }
  headers.append("Set-Cookie", parts.join("; "));
}

/**
 * Append a Set-Cookie header that clears the session cookie.
 */
export function clearSessionCookie(headers: Headers): void {
  const parts = [`${SESSION_COOKIE_NAME}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  headers.append("Set-Cookie", parts.join("; "));
}

// ---------------------------------------------------------------------------
// Request auth helpers
// ---------------------------------------------------------------------------

/**
 * Parse the session cookie from the request, look up the session in the DB,
 * and return `{ userId }` if valid, or `null` otherwise.
 *
 * Note: `getSession` from the DAL already filters out expired sessions.
 */
export async function getSessionFromRequest(request: Request): Promise<{ userId: string } | null> {
  // No database configured — auth is unavailable
  if (!process.env.DATABASE_URL) return null;

  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const sessionId = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME);
  if (!sessionId) return null;

  const session = await getSession(sessionId);
  if (!session) return null;

  return { userId: session.userId };
}

/**
 * Like `getSessionFromRequest`, but throws a 401 Response when the
 * request is not authenticated. Use in loaders/actions that require auth.
 *
 * The thrown body is always `{ error: "auth_required" }` so API clients can
 * pattern-match a single shape across routes.
 */
export async function requireAuth(request: Request): Promise<{ userId: string }> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    throw Response.json({ error: "auth_required" }, { status: 401 });
  }
  return session;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single cookie value from a Cookie header string.
 */
export function parseCookieValue(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));

  if (!match) return undefined;
  return match.slice(name.length + 1);
}
