import { recoveryOwnerError } from "~/lib/database/sync-delivery/recovery-owner";
import { requireAuth } from "~/lib/database/auth-middleware";
import { listRecovery, RecoveryConflict } from "~/lib/database/sync-delivery/recovery";
import { CanonicalOwnershipConflict } from "~/lib/database/sync-delivery/canonical-version";
import { admitRecovery } from "~/lib/database/sync-delivery/recovery-admission";
import { getRecoveryBook } from "~/lib/database/sync-delivery/recovery-book";
export async function loader({ request }: { request: Request }) {
  const { userId } = await requireAuth(request);
  const ownerError = recoveryOwnerError(request, userId);
  if (ownerError) return ownerError;
  const url = new URL(request.url);
  try {
    const targetBookId = url.searchParams.get("targetBookId");
    if (targetBookId) return Response.json(await getRecoveryBook(userId, targetBookId));
    return Response.json(
      await listRecovery(
        userId,
        url.searchParams.get("cursor"),
        Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50)),
      ),
    );
  } catch (error) {
    if (error instanceof CanonicalOwnershipConflict)
      return Response.json({ error: "Not found" }, { status: 404 });
    if (error instanceof TypeError || error instanceof SyntaxError)
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    throw error;
  }
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { userId } = await requireAuth(request);
  const ownerError = recoveryOwnerError(request, userId);
  if (ownerError) return ownerError;
  try {
    const detail = await admitRecovery(userId, await request.json());
    return detail ? Response.json(detail) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof CanonicalOwnershipConflict)
      return Response.json({ error: "Not found" }, { status: 404 });
    if (error instanceof RecoveryConflict)
      return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof TypeError || error instanceof SyntaxError)
      return Response.json({ error: "Invalid recovery admission" }, { status: 400 });
    throw error;
  }
}
