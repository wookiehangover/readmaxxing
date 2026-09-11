import { recoveryOwnerError } from "~/lib/database/sync-delivery/recovery-owner";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getRecovery } from "~/lib/database/sync-delivery/recovery";
export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { receiptId?: string };
}) {
  const { userId } = await requireAuth(request);
  const ownerError = recoveryOwnerError(request, userId);
  if (ownerError) return ownerError;
  const detail = await getRecovery(userId, params.receiptId ?? "");
  return detail
    ? Response.json(
        { formatVersion: 1, custody: "received-json-only", ...detail },
        {
          headers: {
            "Content-Disposition": `attachment; filename="receipt-${detail.receiptId}.json"`,
          },
        },
      )
    : Response.json({ error: "Not found" }, { status: 404 });
}
