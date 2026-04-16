import { getSessionFromRequest, clearSessionCookie } from "~/lib/database/auth-middleware";
import { deleteSession } from "~/lib/database/auth/session";

export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const headers = new Headers();

  // Try to read and delete the existing session
  const sessionInfo = await getSessionFromRequest(request);
  if (sessionInfo) {
    // getSessionFromRequest returns { userId }, but we need the session ID
    // to delete it. Re-parse the cookie to get the raw session ID.
    const cookieHeader = request.headers.get("Cookie");
    const sessionId = cookieHeader
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("readmax_session="))
      ?.slice("readmax_session=".length);

    if (sessionId) {
      await deleteSession(sessionId);
    }
  }

  clearSessionCookie(headers);

  return Response.json({ success: true }, { headers });
}
