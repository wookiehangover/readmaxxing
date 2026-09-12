import { get, set } from "idb-keyval";
import { getCustodyAccess, bindCustody, retainCustody } from "./custody-journal";
import { custodyReviewVersion } from "./custody-encoding";
import { custodySession } from "./custody-session";
import { localRecoveryDetail } from "./custody-export";
import { localRecoveryFile } from "./local-recovery-source";
import { uploadFile } from "./file-uploads";
import { getCustodyStore } from "./stores";
import { requestRecoveryPull } from "./recovery-refresh";
import type { RecoveryBookTarget } from "./delivery-types";

interface FileDraft {
  kind: "local-file-recovery";
  ownerId: string;
  sourceId: string;
  sourceVersion: string;
  targetBookId: string;
  expectedCanonicalVersion: string;
  type: "file" | "cover";
}
export async function getRecoveryBookTarget(
  ownerId: string,
  bookId: string,
): Promise<RecoveryBookTarget> {
  const session = custodySession(ownerId);
  session.checkActive();
  const response = await fetch(`/api/sync/recovery?targetBookId=${encodeURIComponent(bookId)}`, {
    headers: { "X-Recovery-Owner": ownerId },
  });
  if (!response.ok) throw new Error("An owned current book is required for this file");
  const target = (await response.json()) as RecoveryBookTarget;
  session.checkActive();
  if (
    target.ownerId !== ownerId ||
    target.canonical?.entity !== "book" ||
    !target.canonical.entityId ||
    target.canonical.status !== "present" ||
    !target.canonical.data ||
    !target.canonical.version
  )
    throw new Error("An owned live canonical book is required for this file");
  return target;
}
export async function prepareLocalFileRecovery(input: {
  ownerId: string;
  id: string;
  expectedVersion: string;
  targetBookId: string;
  expectedCanonicalVersion: string;
  type: "file" | "cover";
}): Promise<string> {
  const session = custodySession(input.ownerId);
  session.checkActive();
  const source = await localRecoveryDetail(input.id, input.ownerId);
  if (!input.expectedVersion || source.version !== input.expectedVersion)
    throw new Error("Local file changed; review again");
  localRecoveryFile(source.item, input.type);
  const target = await getRecoveryBookTarget(input.ownerId, input.targetBookId);
  if (
    target.canonical.version !== input.expectedCanonicalVersion ||
    target.canonical.entityId !== input.targetBookId
  )
    throw new Error("File target changed; review the canonical book again");
  if (!(await bindCustody(input.id, input.ownerId)))
    throw new Error("Local file account binding changed");
  const raw: FileDraft = {
    kind: "local-file-recovery",
    ownerId: input.ownerId,
    sourceId: input.id,
    sourceVersion: await custodyReviewVersion(source.item),
    targetBookId: input.targetBookId,
    expectedCanonicalVersion: input.expectedCanonicalVersion,
    type: input.type,
  };
  const operationId = crypto.randomUUID();
  const id = await retainCustody({
    source: "local-file-recovery",
    key: operationId,
    operationId,
    raw,
    role: "intended",
    ownerId: input.ownerId,
  });
  session.checkActive();
  return id;
}
export async function submitLocalFileRecovery(input: {
  ownerId: string;
  submissionId: string;
}): Promise<RecoveryBookTarget> {
  const session = custodySession(input.ownerId);
  session.checkActive();
  const draft = (await localRecoveryDetail(input.submissionId, input.ownerId)).item
    .raw as FileDraft;
  if (draft.kind !== "local-file-recovery" || draft.ownerId !== input.ownerId)
    throw new Error("Local file submission unavailable");
  const source = await localRecoveryDetail(draft.sourceId, input.ownerId);
  if ((await custodyReviewVersion(source.item)) !== draft.sourceVersion)
    throw new Error("Selected retained file revision changed");
  let url = await get<string>(["file-recovery-url", input.submissionId], getCustodyStore());
  if (!url) {
    const target = await getRecoveryBookTarget(input.ownerId, draft.targetBookId);
    if (
      target.canonical.version !== draft.expectedCanonicalVersion ||
      target.canonical.entityId !== draft.targetBookId
    )
      throw new Error("File target changed; review again");
    const data = localRecoveryFile(source.item, draft.type);
    await getCustodyAccess(draft.sourceId, input.ownerId);
    session.checkActive();
    url =
      (await uploadFile(
        { userId: input.ownerId, uploadRetryState: new Map() },
        draft.targetBookId,
        data,
        draft.type,
        draft.type === "file" && target.canonical.data?.format === "pdf"
          ? "application/pdf"
          : undefined,
        { ownerId: input.ownerId, expectedCanonicalVersion: draft.expectedCanonicalVersion },
      )) ?? undefined;
    if (!url) throw new Error("File upload was not confirmed; selected bytes remain retained");
    await getCustodyAccess(draft.sourceId, input.ownerId);
    session.checkActive();
    await set(["file-recovery-url", input.submissionId], url, getCustodyStore());
  }
  const current = await getRecoveryBookTarget(input.ownerId, draft.targetBookId);
  const key = draft.type === "file" ? "remoteFileUrl" : "remoteCoverUrl";
  if (current.canonical.entityId !== draft.targetBookId || current.canonical.data?.[key] !== url)
    throw new Error("Upload is not yet published to this book; selected bytes remain retained");
  await getCustodyAccess(draft.sourceId, input.ownerId);
  await getCustodyAccess(input.submissionId, input.ownerId);
  session.checkActive();
  requestRecoveryPull(input.ownerId);
  return current;
}
