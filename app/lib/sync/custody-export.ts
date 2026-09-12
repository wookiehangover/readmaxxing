import {
  encodeCustodyRaw,
  custodyReviewVersion,
  UnsupportedCustodyKindError,
} from "./custody-encoding";
import { entries } from "idb-keyval";
import { getBookRemapStore } from "./stores";
import { get } from "idb-keyval";
import { getCustodyStore } from "./stores";
import { getCustodyAccess, listCustodyMetadata, type CustodyItem } from "./custody-journal";
import { custodySession } from "./custody-session";

export async function localRecoverySummaries(ownerId?: string) {
  return (await listCustodyMetadata(ownerId)).map(({ item, facts }) => ({
    id: item.id,
    source: item.source,
    key: item.key,
    role: item.role,
    createdAt: item.createdAt,
    provenance: item.provenance,
    ownerId: facts.ownerId,
    receiptId: facts.receiptId,
    status: facts.conflict
      ? "ownership-conflict"
      : facts.receiptId
        ? "raw-not-covered"
        : facts.ownerId
          ? "local-not-received"
          : "needs-account-binding",
  }));
}

export async function localRecoveryDetail(id: string, ownerId?: string) {
  const session = custodySession(ownerId);
  await getCustodyAccess(id, ownerId);
  const item = await get<CustodyItem>(id, getCustodyStore());
  if (!item) throw new Error("Local recovery item unavailable");
  const access = await getCustodyAccess(id, ownerId);
  const aliases = await entries(getBookRemapStore());
  let version = "";
  try {
    version = await custodyReviewVersion({ item, authorization: access.authorization, aliases });
  } catch (error) {
    // Detail remains inspectable even for clone kinds that cannot yet be
    // exported or compared exactly; an empty token forbids destructive action.
    if (!(error instanceof UnsupportedCustodyKindError)) throw error;
  }
  await getCustodyAccess(id, ownerId);
  session.checkActive();
  return { item, facts: access.facts, version };
}

/** Versioned graph representation; attachments remain exact bytes, never JSON placeholders. */
export async function exportLocalRecovery(id: string, ownerId?: string) {
  const session = custodySession(ownerId);
  const { item } = await localRecoveryDetail(id, ownerId);
  const { root, nodes, attachments } = await encodeCustodyRaw(item.raw);
  const { facts } = await getCustodyAccess(id, ownerId);
  session.checkActive();
  return {
    manifest: {
      version: 1,
      id: item.id,
      source: item.source,
      key: item.key,
      role: item.role,
      partition: item.partition,
      ownerId: facts.ownerId,
      receiptId: facts.receiptId,
      root,
      nodes,
    },
    attachments,
  };
}
