import { promisifyRequest } from "idb-keyval";
import { custodyReviewVersion } from "./custody-encoding";
import { getCustodyAccess, factsKey, type CustodyFacts, type CustodyItem } from "./custody-journal";
import { custodySession } from "./custody-session";
import { equalRaw, inLiveTransaction, liveTransactionBoundary } from "./raw-snapshot";
import { getBookRemapStore, getCustodyStore } from "./stores";
import { withSyncIdentityLock } from "./sync-lock";

/** Explicitly discards one reviewed private snapshot, never a live record or sibling revision. */
export async function discardLocalRecovery(input: {
  id: string;
  expectedVersion: string;
  ownerId?: string;
}): Promise<void> {
  const session = custodySession(input.ownerId);
  if (!input.expectedVersion) throw new Error("Review the local recovery item before discarding");
  await withSyncIdentityLock(async () => {
    const access = await getCustodyAccess(input.id, input.ownerId);
    // Hold the alias snapshot as well as custody claims across asynchronous byte
    // comparison. Another tab's alias or binding write cannot slip past the CAS.
    await getBookRemapStore()("readonly", (aliases) => {
      const done = promisifyRequest(aliases.transaction);
      const work = inLiveTransaction(aliases, async () => {
        const keys = await promisifyRequest(aliases.getAllKeys());
        const values = await promisifyRequest(aliases.getAll());
        const aliasEntries = keys.map((key, index) => [key, values[index]]);
        await getCustodyStore()("readwrite", (store) => {
          const done = promisifyRequest(store.transaction);
          const work = inLiveTransaction(store, async () => {
            const item = await promisifyRequest<CustodyItem | undefined>(store.get(input.id));
            const facts = await promisifyRequest<CustodyFacts | undefined>(
              store.get(factsKey(input.id)),
            );
            if (!item || !facts || facts.retired || facts.conflict)
              throw new Error("Local recovery item unavailable");
            const groupOwner = await promisifyRequest(
              store.get(["binding", item.partition, item.operationId]),
            );
            const partition = await promisifyRequest(store.get("profile-unbound-epoch"));
            const bindings = await Promise.all(
              access.authorization.bindings.map(async ([key]) => [
                key,
                await promisifyRequest(store.get(key as IDBValidKey)),
              ]),
            );
            const authorization = { facts, groupOwner, partition, bindings };
            if (!(await equalRaw(authorization, access.authorization)))
              throw new Error("Local recovery ownership changed; review again");
            const version = await custodyReviewVersion({
              item,
              authorization,
              aliases: aliasEntries,
            });
            if (version !== input.expectedVersion)
              throw new Error("Local recovery item changed; review again");
            // Raw identity/bytes are compared inside the transaction, not treated
            // as receipt coverage by a JSON fingerprint or declared file hash.
            await liveTransactionBoundary(store);
            const latest = await promisifyRequest<CustodyItem>(store.get(input.id));
            if (!(await equalRaw(item, latest)))
              throw new Error("Local recovery item changed; review again");
            await liveTransactionBoundary(store);
            session.checkActive();
            store.put({ ...facts, retired: true, discarded: true }, factsKey(input.id));
            store.delete(input.id);
          });
          return Promise.all([done, work]).then(() => {});
        });
      });
      return Promise.all([done, work]).then(() => {});
    });
  });
}
