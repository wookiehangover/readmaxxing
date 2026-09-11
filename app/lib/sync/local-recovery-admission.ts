import { get, set } from "idb-keyval";
import { bindCustody, getCustodyAccess, retainCustody } from "./custody-journal";
import { custodySession, unboundPartition } from "./custody-session";
import { localRecoveryDetail } from "./custody-export";
import { localRecoverySnapshot } from "./local-recovery-source";
import { custodyReviewVersion } from "./custody-encoding";
import { getCustodyStore } from "./stores";
import type { RecoveryAdmission, RecoveryDetail } from "./delivery-types";
import { equalDeliveredEnvelope } from "./delivery-fingerprint";

interface AdmissionDraft {
  kind: "local-recovery-admission";
  ownerId: string;
  sourceId: string;
  sourceVersion: string;
  request: RecoveryAdmission;
}
export async function prepareLocalRecoveryAdmission(input: {
  ownerId: string;
  id: string;
  expectedVersion: string;
}): Promise<string> {
  const session = custodySession(input.ownerId);
  session.checkActive();
  if (!input.ownerId) throw new Error("Sign in before recovering local text");
  const source = await localRecoveryDetail(input.id, input.ownerId);
  if (!input.expectedVersion || source.version !== input.expectedVersion)
    throw new Error("Local recovery item changed; review again");
  const snapshot = await localRecoverySnapshot(source.item);
  const request: RecoveryAdmission = {
    admissionId: crypto.randomUUID(),
    source: {
      installation: (await unboundPartition()).split(":")[1],
      itemId: input.id,
      version: input.expectedVersion,
    },
    snapshot,
  };
  const raw: AdmissionDraft = {
    kind: "local-recovery-admission",
    ownerId: input.ownerId,
    sourceId: input.id,
    sourceVersion: await custodyReviewVersion(source.item),
    request,
  };
  const id = await retainCustody({
    source: "local-recovery-admission",
    key: request.admissionId,
    operationId: request.admissionId,
    raw,
    role: "intended",
    ownerId: input.ownerId,
  });
  session.checkActive();
  return id;
}
export async function submitLocalRecoveryAdmission(input: {
  ownerId: string;
  submissionId: string;
}): Promise<RecoveryDetail> {
  const session = custodySession(input.ownerId);
  session.checkActive();
  const draft = (await localRecoveryDetail(input.submissionId, input.ownerId)).item
    .raw as AdmissionDraft;
  if (draft.kind !== "local-recovery-admission" || draft.ownerId !== input.ownerId)
    throw new Error("Local admission unavailable");
  const source = await localRecoveryDetail(draft.sourceId, input.ownerId);
  if ((await custodyReviewVersion(source.item)) !== draft.sourceVersion)
    throw new Error("Local recovery source changed; review again");
  const previous = await get<RecoveryDetail>(
    ["admission-result", input.submissionId],
    getCustodyStore(),
  );
  if (previous) {
    if (previous.ownerId !== input.ownerId) throw new Error("Recovery response account changed");
    session.checkActive();
    return previous;
  }
  await getCustodyAccess(input.submissionId, input.ownerId);
  session.checkActive();
  const response = await fetch("/api/sync/recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Recovery-Owner": input.ownerId },
    body: JSON.stringify(draft.request),
  });
  session.checkActive();
  if (!response.ok)
    throw new Error(
      `Local recovery admission failed (${response.status}); original remains retained`,
    );
  const detail = (await response.json()) as RecoveryDetail;
  if (
    detail.ownerId !== input.ownerId ||
    !detail.receiptId ||
    detail.canonicalVersion !== detail.canonical?.version ||
    !(await equalDeliveredEnvelope(draft.request.snapshot, detail.originalSnapshot))
  )
    throw new Error("Invalid local recovery response");
  // First binding follows authoritative admission; a rejected account must not
  // appropriate an otherwise unbound original just by preparing a request.
  if (!(await bindCustody(draft.sourceId, input.ownerId)))
    throw new Error("Local recovery account binding changed");
  await getCustodyAccess(draft.sourceId, input.ownerId);
  await getCustodyAccess(input.submissionId, input.ownerId);
  session.checkActive();
  await set(["admission-result", input.submissionId], detail, getCustodyStore());
  session.checkActive();
  return detail;
}
