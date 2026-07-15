import { createHash } from "node:crypto";
import { redirect } from "react-router";
import type { Route } from "./+types/api.auth.magic-link.consume";
import { SESSION_MAX_AGE_SECONDS } from "~/lib/auth-config";
import { setSessionCookie } from "~/lib/database/auth-middleware";
import { getMagicLinkByHash } from "~/lib/database/auth/magic-link";
import { createSession } from "~/lib/database/auth/session";

const MAGIC_LINK_ERROR_REDIRECT = "/login?error=magic_link";

export async function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    throw redirect(MAGIC_LINK_ERROR_REDIRECT);
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const magicLink = await getMagicLinkByHash(tokenHash);
  if (!magicLink || magicLink.expiresAt.getTime() <= Date.now()) {
    throw redirect(MAGIC_LINK_ERROR_REDIRECT);
  }

  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const session = await createSession(magicLink.userId, expiresAt);
  if (!session) {
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }

  const headers = new Headers();
  setSessionCookie(headers, session.id);
  throw redirect("/", { headers });
}
