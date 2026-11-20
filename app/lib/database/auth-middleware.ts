import { SESSION_MAX_AGE_SECONDS } from "~/lib/auth-config";
import { getSession } from "./auth/session";

const SESSION_COOKIE_NAME = "readmax_session";

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

export function clearSessionCookie(headers: Headers): void {
  const parts = [`${SESSION_COOKIE_NAME}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  headers.append("Set-Cookie", parts.join("; "));
}

export async function getSessionFromRequest(request: Request): Promise<{ userId: string } | null> {
  if (!process.env.DATABASE_URL) return null;

  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const sessionId = parseCookieValue(cookieHeader, SESSION_COOKIE_NAME);
  if (!sessionId) return null;

  const session = await getSession(sessionId);
  if (!session) return null;

  return { userId: session.userId };
}

export async function requireAuth(request: Request): Promise<{ userId: string }> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    throw Response.json({ error: "auth_required" }, { status: 401 });
  }
  return session;
}

export function parseCookieValue(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));

  if (!match) return undefined;
  return match.slice(name.length + 1);
}
