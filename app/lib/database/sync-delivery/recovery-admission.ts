import { sql } from "pg-sql";
import { withBookOwnerTransaction } from "../book/canonical-book-write";
import { canonicalJSON, isEnvelope } from "./identity";
import { receiveEntry } from "./intake";
import { decide } from "./worker";
import { getRecovery, RecoveryConflict } from "./recovery";
import type { RecoveryAdmission } from "~/lib/sync/delivery-types";

const supported = new Set([
  "book",
  "notebook",
  "position",
  "highlight",
  "bookmark",
  "chat_session",
  "settings",
]);

export async function admitRecovery(account: string, request: RecoveryAdmission) {
  if (
    !request ||
    typeof request.admissionId !== "string" ||
    !request.admissionId ||
    !request.source ||
    ![request.source.installation, request.source.itemId, request.source.version].every(
      (value) => typeof value === "string" && value.length > 0,
    ) ||
    !isEnvelope(request.snapshot) ||
    !supported.has(request.snapshot.entity)
  )
    throw new TypeError("Invalid recovery admission");
  const id = await withBookOwnerTransaction(account, async (client) => {
    const prior = (
      await client.query<{ request: unknown; receiptId: string }>(sql`
      SELECT request,receipt_id AS "receiptId" FROM readmax.sync_recovery_admission
      WHERE account_id=${account} AND admission_id=${request.admissionId}
    `)
    ).rows[0];
    if (prior) {
      if (canonicalJSON(prior.request) !== canonicalJSON(request))
        throw new RecoveryConflict("Admission identity reused");
      return prior.receiptId;
    }
    await client.query(
      sql`INSERT INTO readmax."user"(id) VALUES(${account}) ON CONFLICT DO NOTHING`,
    );
    const row = await receiveEntry(client, account, request.snapshot);
    if (!row) return null;
    // Intake only takes custody. Never schedule a historical local projection for application.
    // Preserve an exact receipt's already committed terminal proof on subsequent admission.
    if (!["applied", "covered", "resolved", "needs_resolution"].includes(row.state))
      await decide(client, row, "needs_resolution", "local_recovery_review", null);
    await client.query(sql`INSERT INTO readmax.sync_recovery_admission(account_id,admission_id,receipt_id,request)
      VALUES(${account},${request.admissionId},${row.receiptId},${canonicalJSON(request)}::jsonb)`);
    return row.receiptId;
  });
  return id ? getRecovery(account, id) : null;
}
