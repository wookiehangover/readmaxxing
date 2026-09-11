import { SESSION_MAX_AGE_SECONDS } from "~/lib/auth-config";
import { requireAuth } from "~/lib/database/auth-middleware";
import { createSession } from "~/lib/database/auth/session";

/** Issue a separate, revocable CLI session after explicit browser approval. */
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  // This endpoint reveals a credential, so require a same-origin browser request.
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const { userId } = await requireAuth(request);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const session = await createSession(userId, expiresAt);
  if (!session) return Response.json({ error: "Failed to create session" }, { status: 500 });
  return Response.json(
    { token: session.id, expiresAt: session.expiresAt },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}
