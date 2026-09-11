import { get, set } from "idb-keyval";
import { createChangeEntry } from "./change-log";
import {
  retainCustody,
  bindCustody,
  getCustodyAccess,
  validateCustodyOwner,
} from "./custody-journal";
import { localRecoveryDetail } from "./custody-export";
import { custodySession } from "./custody-session";
import { equalRaw } from "./raw-snapshot";
import { getCustodyStore } from "./stores";
import { requestRecoveryPull } from "./recovery-refresh";
import type { RecoveryDetail, RecoveryResolution, DeliverySummary } from "./delivery-types";
import type { EntityType } from "./types";

interface RetainedResolution {
  kind: "recovery-resolution";
  ownerId: string;
  receiptId: string;
  request: RecoveryResolution;
}

/** Create once per explicit user action; retain its ID for retries after uncertain outcomes. */
export async function prepareRecoveryResolution(input: {
  ownerId: string;
  detail: RecoveryDetail;
  action: RecoveryResolution["action"];
  data?: Record<string, unknown>;
}): Promise<string> {
  const session = custodySession(input.ownerId);
  session.checkActive();
  if (!input.ownerId) throw new Error("Sign in before submitting a recovery action");
  const detail = structuredClone(input.detail);
  if (detail.ownerId !== input.ownerId) throw new Error("Recovery detail account changed");
  const request: RecoveryResolution = {
    resolutionId: crypto.randomUUID(),
    expectedDecisionVersion: detail.decisionVersion,
    expectedCanonicalVersion: detail.canonicalVersion,
    action: input.action,
  };
  if (
    !detail.receiptId ||
    !detail.canonicalVersion ||
    detail.canonicalVersion !== detail.canonical.version
  )
    throw new Error("Refresh the recovery detail before acting");
  if (input.action === "submit_edit" || input.action === "restore_copy") {
    const canonical = detail.canonical;
    if (
      !canonical.entityId ||
      !input.data ||
      (input.action === "submit_edit"
        ? canonical.status !== "present"
        : !["present", "missing", "deleted"].includes(canonical.status))
    )
      throw new Error("A current editable canonical target is required");
    if (
      ![
        "book",
        "notebook",
        "position",
        "highlight",
        "bookmark",
        "chat_session",
        "settings",
      ].includes(canonical.entity)
    )
      throw new Error("This record cannot be edited through recovery");
    if (
      input.action === "restore_copy" &&
      !["book", "highlight", "bookmark", "chat_session"].includes(canonical.entity)
    )
      throw new Error(
        "This record needs an existing parent and cannot be restored as a separate copy",
      );
    const entityId = input.action === "restore_copy" ? crypto.randomUUID() : canonical.entityId;
    const data = structuredClone(input.data);
    // Reference fields come from the reviewed canonical target, not editable JSON.
    for (const field of ["bookId", "sessionId"])
      if (canonical.data && Object.hasOwn(canonical.data, field))
        data[field] = canonical.data[field];
    if (["notebook", "position"].includes(canonical.entity)) data.bookId = entityId;
    if (["book", "highlight", "bookmark", "chat_session"].includes(canonical.entity))
      data.id = entityId;
    const timestamp = Date.now();
    if (canonical.entity !== "settings") data.updatedAt = timestamp;
    await validateCustodyOwner(input.ownerId, { ...detail.originalSnapshot, data });
    request.newMutation = createChangeEntry({
      entity: canonical.entity as EntityType,
      entityId,
      operation: "put",
      data,
      timestamp,
      ownerId: input.ownerId,
    });
  }
  const raw: RetainedResolution = {
    kind: "recovery-resolution",
    ownerId: input.ownerId,
    receiptId: detail.receiptId,
    request,
  };
  const id = await retainCustody({
    source: "recovery-resolution",
    key: request.resolutionId,
    operationId: request.resolutionId,
    role: "intended",
    ownerId: input.ownerId,
    raw,
  });
  if (!(await bindCustody(id, input.ownerId))) throw new Error("Recovery account binding changed");
  session.checkActive();
  return id;
}

/** Guarded server resolution is the only writer; the existing pull owner refreshes local records. */
export async function submitRecoveryResolution(input: {
  ownerId: string;
  submissionId: string;
}): Promise<DeliverySummary> {
  const session = custodySession(input.ownerId);
  session.checkActive();
  const { item } = await localRecoveryDetail(input.submissionId, input.ownerId);
  const raw = item.raw as RetainedResolution;
  if (raw?.kind !== "recovery-resolution" || raw.ownerId !== input.ownerId)
    throw new Error("Recovery submission unavailable");
  const previous = await get<DeliverySummary>(
    ["recovery-result", input.submissionId],
    getCustodyStore(),
  );
  if (previous) {
    if (previous.ownerId !== input.ownerId) throw new Error("Recovery response account changed");
    await getCustodyAccess(input.submissionId, input.ownerId);
    session.checkActive();
    if (raw.request.action !== "keep_canonical") requestRecoveryPull(input.ownerId);
    return previous;
  }
  let body: string;
  try {
    body = JSON.stringify(raw.request);
    if (!(await equalRaw(raw.request, JSON.parse(body)))) throw new Error("Non-JSON edit");
  } catch {
    throw new Error(
      "This edit contains values that require a local export; original remains retained",
    );
  }
  await getCustodyAccess(input.submissionId, input.ownerId);
  session.checkActive();
  const response = await fetch(`/api/sync/recovery/${encodeURIComponent(raw.receiptId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Recovery-Owner": input.ownerId },
    body,
  });
  session.checkActive();
  if (!response.ok) {
    if (response.status === 409)
      throw new Error("Recovery state changed; refresh and review again");
    throw new Error(`Recovery submission failed (${response.status}); retained for retry`);
  }
  const result = (await response.json()) as DeliverySummary;
  if (
    result.ownerId !== input.ownerId ||
    result.receiptId !== raw.receiptId ||
    !Number.isInteger(result.decisionVersion)
  )
    throw new Error("Invalid recovery response; submission remains retained");
  await getCustodyAccess(input.submissionId, input.ownerId);
  session.checkActive();
  // This proof belongs to the resolution, not to byte coverage of any source.
  await set(["recovery-result", input.submissionId], result, getCustodyStore());
  session.checkActive();
  if (raw.request.action !== "keep_canonical") requestRecoveryPull(input.ownerId);
  return result;
}
