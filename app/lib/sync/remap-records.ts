import { promisifyRequest, type UseStore } from "idb-keyval";
import { retainCustody, storeIdentity, validateCustodyOwner } from "./custody-journal";
import { custodySession } from "./custody-session";
import { equalRaw, inLiveTransaction, liveTransactionBoundary } from "./raw-snapshot";

/** Source, target and intended revisions have custody before a conditional atomic move. */
export async function moveRemapRecord<T>(
  useStore: UseStore,
  fromKey: string,
  toKey: string,
  merge: (source: T, target: T | undefined) => T | undefined,
  options: {
    matches?: (source: T) => boolean;
    prepare?: (source: T) => Promise<void>;
    keepSource?: (source: T) => T;
    checkActive?: () => void;
    ownerId?: string;
  } = {},
): Promise<boolean> {
  const session = custodySession(options.ownerId);
  const source = await storeIdentity(useStore);
  const operationId = crypto.randomUUID();
  const check = () => {
    session.checkActive();
    options.checkActive?.();
  };
  for (;;) {
    check();
    const [snapshot, sourcePresent, target, targetPresent] = await useStore("readonly", (store) =>
      Promise.all([
        promisifyRequest<T | undefined>(store.get(fromKey)),
        promisifyRequest(store.count(fromKey)),
        promisifyRequest<T | undefined>(store.get(toKey)),
        promisifyRequest(store.count(toKey)),
      ]),
    );
    if (snapshot === undefined || (options.matches && !options.matches(snapshot))) return false;
    await validateCustodyOwner(session.ownerId, snapshot, source, fromKey);
    await validateCustodyOwner(session.ownerId, target, source, toKey);
    const merged = merge(structuredClone(snapshot), structuredClone(target));
    const kept = options.keepSource?.(structuredClone(snapshot));
    for (const [key, raw, role, present] of [
      [fromKey, snapshot, "before", sourcePresent],
      [toKey, target, "before", targetPresent],
      [toKey, merged, "intended", merged !== undefined],
      [fromKey, kept, "intended", kept !== undefined],
    ] as const) {
      if (present)
        await retainCustody({ source, key, raw, role, operationId, ownerId: session.ownerId });
    }
    if (
      !(await equalRaw(snapshot, structuredClone(snapshot))) ||
      !(await equalRaw(target, structuredClone(target)))
    )
      throw new Error("Unsupported raw kind retained before remap");
    await options.prepare?.(snapshot);
    check();
    let retry = false;
    await useStore("readwrite", (store) => {
      const done = promisifyRequest(store.transaction);
      const work = inLiveTransaction(store, async () => {
        const current = await promisifyRequest<T | undefined>(store.get(fromKey));
        const currentTarget = await promisifyRequest<T | undefined>(store.get(toKey));
        const currentSourcePresent = await promisifyRequest(store.count(fromKey));
        const currentTargetPresent = await promisifyRequest(store.count(toKey));
        if (
          currentSourcePresent !== sourcePresent ||
          currentTargetPresent !== targetPresent ||
          !(await equalRaw(current, snapshot)) ||
          !(await equalRaw(currentTarget, target))
        ) {
          retry = true;
          return;
        }
        await liveTransactionBoundary(store);
        check();
        if (merged !== undefined) store.put(merged, toKey);
        if (fromKey !== toKey) {
          if (kept !== undefined) store.put(kept, fromKey);
          else store.delete(fromKey);
        }
      });
      return Promise.all([done, work]).then(() => {});
    });
    if (!retry) return true;
  }
}
