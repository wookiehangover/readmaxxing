import { requireAuth } from "~/lib/database/auth-middleware";
import {
  countPasskeysByUserId,
  deletePasskey,
  getPasskeyById,
  updatePasskeyName,
} from "~/lib/database/auth/passkey";

interface ActionArgs {
  request: Request;
  params: { id: string };
}

async function getOwnedPasskey(id: string, userId: string) {
  const passkey = await getPasskeyById(id);
  return passkey?.userId === userId ? passkey : null;
}

export async function action({ request, params }: ActionArgs) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { userId } = await requireAuth(request);
  const passkey = await getOwnedPasskey(params.id, userId);
  if (!passkey) {
    return Response.json({ error: "Passkey not found" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    if ((await countPasskeysByUserId(userId)) <= 1) {
      return Response.json({ error: "Cannot remove the last passkey" }, { status: 400 });
    }

    const deleted = await deletePasskey(passkey.id, userId);
    return deleted
      ? Response.json({ ok: true })
      : Response.json({ error: "Passkey not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("name" in body) ||
    (typeof body.name !== "string" && body.name !== null)
  ) {
    return Response.json({ error: "name must be a string or null" }, { status: 400 });
  }

  const updated = await updatePasskeyName(passkey.id, userId, body.name);
  return updated
    ? Response.json({ ok: true })
    : Response.json({ error: "Passkey not found" }, { status: 404 });
}
