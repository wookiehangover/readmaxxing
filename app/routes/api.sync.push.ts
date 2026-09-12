import { requireAuth } from "~/lib/database/auth-middleware";
import {
  receiveBatch,
  deliveryReference,
  type ReceiptRow,
} from "~/lib/database/sync-delivery/intake";
import { processDeliveries, readReceipts } from "~/lib/database/sync-delivery/worker";
import type { SyncPushRequest, SyncPushResponse } from "~/lib/sync/types";

export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL)
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { userId } = await requireAuth(request);
  let body: SyncPushRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.changes))
    return Response.json({ error: "Invalid changes" }, { status: 400 });
  try {
    const intake = await receiveBatch(userId, body.changes);
    // Intake has committed. A failed application/decision cannot erase custody.
    try {
      await processDeliveries(userId);
    } catch (error) {
      console.error("Sync application deferred", error);
    }
    const rows = await readReceipts(
      userId,
      intake.received.map((row) => row.receiptId),
    );
    const groups = new Map<string, ReceiptRow[]>();
    for (const row of rows) groups.set(row.changeId, [...(groups.get(row.changeId) ?? []), row]);
    const response: SyncPushResponse = {
      accepted: [],
      rejected: [],
      notReceived: intake.notReceived.map((id) => ({ id, code: "not_received" })),
      serverTimestamp: new Date().toISOString(),
    };
    for (const [id, versions] of [...groups].sort(
      ([a], [b]) =>
        body.changes.findIndex((entry) => entry.id === a) -
        body.changes.findIndex((entry) => entry.id === b),
    )) {
      const deliveryFields =
        body.supportsDurableReceipts === 1 ? { deliveries: versions.map(deliveryReference) } : {};
      const aliases = new Set(
        versions.map(
          (row) => (row.decisionEvidence as { canonicalId?: string } | null)?.canonicalId,
        ),
      );
      const complete =
        versions.every((row) => ["applied", "covered"].includes(row.state)) && aliases.size === 1;
      if (complete) {
        const canonicalId = aliases.values().next().value;
        response.accepted.push({ id, ...(canonicalId ? { canonicalId } : {}), ...deliveryFields });
      } else
        response.rejected.push({
          id,
          reason: "Durably retained; not applied",
          retryable: versions.some((row) => !["needs_resolution", "resolved"].includes(row.state)),
          ...deliveryFields,
        });
    }
    const noProgress =
      body.changes.length > 0 && !response.accepted.length && !response.rejected.length;
    return Response.json(response, { status: noProgress ? 503 : 200 });
  } catch (error) {
    console.error("Sync custody intake failed", error);
    return Response.json(
      { error: "Mutations not received" },
      { status: error instanceof TypeError ? 400 : 503 },
    );
  }
}
