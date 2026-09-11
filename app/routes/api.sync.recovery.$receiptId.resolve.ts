import { requireAuth } from "~/lib/database/auth-middleware";
import { resolveRecovery, RecoveryConflict } from "~/lib/database/sync-delivery/recovery";
import type { RecoveryResolution } from "~/lib/sync/delivery-types";
export async function action({
  request,
  params,
}: {
  request: Request;
  params: { receiptId?: string };
}) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { userId } = await requireAuth(request);
  if (!/^[0-9a-f-]{36}$/i.test(params.receiptId ?? ""))
    return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const body = (await request.json()) as RecoveryResolution;
    if (
      !body ||
      typeof body.resolutionId !== "string" ||
      !body.resolutionId ||
      !Number.isInteger(body.expectedDecisionVersion) ||
      typeof body.expectedCanonicalVersion !== "string"
    )
      throw new TypeError("Invalid resolution");
    const result = await resolveRecovery(userId, params.receiptId!, body);
    return result ? Response.json(result) : Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof RecoveryConflict)
      return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof TypeError || error instanceof SyntaxError)
      return Response.json({ error: "Invalid resolution" }, { status: 400 });
    throw error;
  }
}
