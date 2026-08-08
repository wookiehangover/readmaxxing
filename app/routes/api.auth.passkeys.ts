import { requireAuth } from "~/lib/database/auth-middleware";
import { getPasskeysByUserId } from "~/lib/database/auth/passkey";

export async function loader({ request }: { request: Request }) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }

  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);
  const passkeys = await getPasskeysByUserId(userId);

  return Response.json({
    passkeys: passkeys.map(({ id, name, createdAt, deviceType, backedUp, lastUsedAt }) => ({
      id,
      name,
      createdAt,
      deviceType,
      backedUp,
      lastUsedAt,
    })),
  });
}
