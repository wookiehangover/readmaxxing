import type { Route } from "./+types/api.auth.magic-link";
import { getRpOrigin, MAGIC_LINK_TTL_SECONDS } from "~/lib/auth-config";
import { generateMagicLinkToken } from "~/lib/auth-token.server";
import { requireAuth } from "~/lib/database/auth-middleware";
import { replaceMagicLinkForUser } from "~/lib/database/auth/magic-link";

export async function action({ request }: Route.ActionArgs) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { userId } = await requireAuth(request);
  const { token, tokenHash } = generateMagicLinkToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000);

  const magicLink = await replaceMagicLinkForUser({ userId, tokenHash, expiresAt });
  if (!magicLink) {
    return Response.json({ error: "Failed to create magic link" }, { status: 500 });
  }

  return Response.json({
    url: `${getRpOrigin()}/api/auth/magic-link/consume?token=${token}`,
    expiresAt: expiresAt.toISOString(),
  });
}
