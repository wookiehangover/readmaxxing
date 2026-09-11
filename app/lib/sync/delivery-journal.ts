import { getBookRemaps } from "./remap-journal";
import { remapChange } from "./remap-references";
import { deliveryFingerprint } from "./delivery-fingerprint";
import { get, promisifyRequest, update } from "idb-keyval";
import { ulid } from "ulid";
import {
  bindCustody,
  factsKey,
  listCustody,
  retainCustody,
  type CustodyFacts,
} from "./custody-journal";
import { custodySession } from "./custody-session";
import { equalRaw, inLiveTransaction } from "./raw-snapshot";
import { getChangeLogStore, getCustodyStore } from "./stores";
import type { ChangeEntry } from "./types";
import type { DeliveryReference } from "./delivery-types";

function isChange(raw: unknown): raw is ChangeEntry {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as ChangeEntry;
  return (
    typeof value.id === "string" &&
    typeof value.entityId === "string" &&
    typeof value.entity === "string" &&
    !value.synced
  );
}

/** Private snapshots remain authoritative when an old tab erases the shared projection. */
export async function restoreJournalChanges(
  ownerId: string,
  isStopped: () => boolean,
): Promise<void> {
  const session = custodySession(ownerId);
  const remaps = await getBookRemaps(ownerId);
  for (const { item, facts } of await listCustody(ownerId, { omitBinary: true })) {
    session.checkActive();
    if (isStopped()) return;
    if (facts.receiptId || facts.acknowledged || facts.conflict || !isChange(item.raw)) continue;
    if (!(await bindCustody(item.id, ownerId))) continue;
    const raw = item.raw;
    let original = raw;
    for (let pass = 0; pass < remaps.length; pass++) {
      const rewritten = remaps.reduce(remapChange, original);
      if (rewritten === original) break;
      original = { ...rewritten, revision: (original.revision ?? 0) + 1 };
    }
    let fingerprint: string;
    try {
      fingerprint = await deliveryFingerprint({ ...original, ownerId });
    } catch {
      continue;
    } // Non-JSON raw remains available locally without blocking healthy projections.
    if (await get(["ack", ownerId, original.id, fingerprint], getCustodyStore())) continue;
    // Keep each original revision's transport ID stable, independent of old row deletion.
    let projectionId =
      (await get<string>(`projection:${item.id}`, getCustodyStore())) ?? original.id;
    const current = await get<ChangeEntry>(projectionId, getChangeLogStore());
    if (
      current &&
      (await equalRaw(
        { ...current, ownerId: undefined, failure: undefined, synced: false },
        { ...original, ownerId: undefined, failure: undefined, synced: false },
      ))
    )
      continue;
    if (
      current &&
      !(await equalRaw(
        { ...current, ownerId: undefined, failure: undefined, synced: false },
        { ...original, ownerId: undefined, failure: undefined, synced: false },
      ))
    ) {
      const key = `projection:${item.id}`;
      await update<string>(key, (value) => value ?? ulid(), getCustodyStore());
      projectionId = (await get<string>(key, getCustodyStore()))!;
      await update<CustodyFacts>(
        factsKey(item.id),
        (facts) => ({ ...facts, projectionId }),
        getCustodyStore(),
      );
    }
    session.checkActive();
    if (isStopped()) return;
    const projected = { ...original, id: projectionId, ownerId, synced: false };
    await retainCustody({
      source: "changelog",
      key: projectionId,
      raw: projected,
      role: "transport",
      operationId: item.id,
      ownerId,
    });
    await getChangeLogStore()("readwrite", (store) => {
      const request = store.get(projectionId);
      request.onsuccess = () => {
        if (!request.result) store.put(projected, projectionId);
      };
      return promisifyRequest(store.transaction);
    });
  }
}

/** All submitted snapshots are private before fetch, including legacy observations. */
export async function protectOutgoing(changes: ChangeEntry[], ownerId: string): Promise<void> {
  for (const change of changes) {
    const id = await retainCustody({
      source: "changelog",
      key: change.id,
      raw: change,
      role: "transport",
      operationId: `send:${change.id}:${change.revision ?? 0}`,
      ownerId,
    });
    if (!(await bindCustody(id, ownerId))) throw new Error("Outgoing account binding changed");
  }
}

/** Fingerprints apply only to received JSON. Raw comparison separately gates retirement. */
export async function receiveJournalRevision(
  ownerId: string,
  sent: ChangeEntry,
  delivery: DeliveryReference,
  expectedFingerprint: string,
  candidates?: Awaited<ReturnType<typeof listCustody>>,
): Promise<boolean> {
  const session = custodySession(ownerId);
  if (
    delivery.fingerprintVersion !== 1 ||
    delivery.payloadFingerprint !== expectedFingerprint ||
    !delivery.receiptId
  )
    return false;
  const wire = JSON.parse(JSON.stringify(sent)) as ChangeEntry;
  for (const { item, facts } of candidates ?? (await listCustody(ownerId, { omitBinary: true }))) {
    if (facts.conflict) continue;
    const raw = item.raw;
    const transport = isChange(raw);
    if (transport) {
      if (
        raw.id !== sent.id ||
        !(await equalRaw(
          { ...raw, ownerId, failure: undefined, synced: false },
          { ...sent, ownerId, failure: undefined, synced: false },
        ))
      )
        continue;
    } else if (!(await equalRaw(raw, wire.data))) continue;
    if (!(await bindCustody(item.id, ownerId))) continue;
    // JSON strips undefined, invalid clocks and bytes; those original revisions stay local.
    const exact = transport
      ? (await equalRaw(raw.data, wire.data)) && Object.is(raw.timestamp, wire.timestamp)
      : await equalRaw(raw, wire.data);
    session.checkActive();
    await getCustodyStore()("readwrite", (store) => {
      const done = promisifyRequest(store.transaction);
      const work = inLiveTransaction(store, async () => {
        const latest = await promisifyRequest<CustodyFacts>(store.get(factsKey(item.id)));
        if (latest.ownerId !== ownerId || latest.conflict) return;
        session.checkActive();
        store.put({ ...latest, receiptId: delivery.receiptId, retired: exact }, factsKey(item.id));
        if (exact) {
          // One latest proof per storage key prevents recapturing acknowledged
          // editor states as an unbounded undo history. Old proofs have receipts.
          if (!transport)
            store.put({ raw, receiptId: delivery.receiptId }, [
              "coverage",
              ownerId,
              item.source,
              item.key,
            ]);
          store.delete(item.id);
        }
      });
      return Promise.all([done, work]).then(() => {});
    });
  }
  return true;
}

/** An exact updated request can stop legacy retries without claiming receipt/byte coverage. */
export async function acknowledgeJournalProjection(
  ownerId: string,
  sent: ChangeEntry,
  candidates?: Awaited<ReturnType<typeof listCustody>>,
): Promise<void> {
  await update(
    ["ack", ownerId, sent.id, await deliveryFingerprint({ ...sent, ownerId })],
    () => true,
    getCustodyStore(),
  );
  for (const { item, facts } of candidates ?? (await listCustody(ownerId, { omitBinary: true }))) {
    if (!isChange(item.raw)) continue;
    const projection = facts.projectionId;
    const raw = item.raw;
    if (
      (projection ?? raw.id) !== sent.id ||
      !(await equalRaw(
        { ...raw, id: sent.id, ownerId, failure: undefined, synced: false },
        { ...sent, ownerId, failure: undefined, synced: false },
      ))
    )
      continue;
    if (!(await bindCustody(item.id, ownerId))) continue;
    await update<CustodyFacts>(
      factsKey(item.id),
      (facts) => (facts?.ownerId === ownerId ? { ...facts, acknowledged: true } : (facts ?? {})),
      getCustodyStore(),
    );
  }
}
