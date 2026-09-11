import { promisifyRequest, type UseStore } from "idb-keyval";
import { retainCustody, storeIdentity, validateCustodyOwner } from "./custody-journal";
import { custodySession } from "./custody-session";
import { equalRaw, inLiveTransaction, liveTransactionBoundary } from "./raw-snapshot";

/** Canonical storage writes are write-ahead and compare again inside the final transaction. */
export async function custodyUpdate<T>(
  key: IDBValidKey,
  updater: (value: T | undefined) => T | undefined,
  useStore: UseStore,
  options: {
    ownerId?: string;
    remove?: boolean;
    covered?: T;
    matches?: (value: T | undefined) => boolean;
  } = {},
): Promise<void> {
  const session = custodySession(options.ownerId);
  const source = await storeIdentity(useStore);
  const operationId = crypto.randomUUID();
  for (;;) {
    session.checkActive();
    const [before, present] = await useStore("readonly", (store) =>
      Promise.all([
        promisifyRequest<T | undefined>(store.get(key)),
        promisifyRequest(store.count(key)),
      ]),
    );

    if (options.matches && !options.matches(before)) return;
    const intended = options.remove ? undefined : updater(structuredClone(before));
    if (present && !options.remove && (await equalRaw(before, intended))) return;
    if (!present && options.remove) return;
    await validateCustodyOwner(session.ownerId, before, source, key);
    if (present && (options.covered === undefined || !(await equalRaw(before, options.covered))))
      await retainCustody({
        source,
        key,
        raw: before,
        role: "before",
        operationId,
        ownerId: session.ownerId,
      });
    if (!options.remove)
      await retainCustody({
        source,
        key,
        raw: intended,
        role: "intended",
        operationId,
        ownerId: session.ownerId,
      });
    session.checkActive();
    if (!(await equalRaw(before, structuredClone(before))))
      throw new Error("Unsupported raw kind retained before write");
    let retry = false;
    await useStore("readwrite", (store) => {
      const done = promisifyRequest(store.transaction);
      const work = inLiveTransaction(store, async () => {
        const current = await promisifyRequest<T | undefined>(store.get(key));
        const currentPresent = await promisifyRequest(store.count(key));
        if (currentPresent !== present || !(await equalRaw(current, before))) {
          retry = true;
          return;
        }
        await liveTransactionBoundary(store);
        session.checkActive();
        if (options.remove) store.delete(key);
        else store.put(intended, key);
      });
      return Promise.all([done, work]).then(() => {});
    });
    if (!retry) return;
  }
}

export function custodySet<T>(key: IDBValidKey, value: T, store: UseStore): Promise<void> {
  const snapshot = structuredClone(value);
  return custodyUpdate(key, () => snapshot, store);
}
export function custodyDelete(
  key: IDBValidKey,
  store: UseStore,
  matches?: (value: unknown) => boolean,
  covered?: unknown,
): Promise<void> {
  return custodyUpdate(key, () => undefined, store, { remove: true, matches, covered });
}

/** Settings keep their existing localStorage owner; raw strings are retained before conversion. */
export async function custodyLocalStorageSet(key: string, value: string): Promise<void> {
  const session = custodySession();
  const operationId = crypto.randomUUID();
  for (;;) {
    const before = localStorage.getItem(key);
    if (before === value) return;
    await retainCustody({ source: "localStorage", key, raw: before, role: "before", operationId });
    await retainCustody({ source: "localStorage", key, raw: value, role: "intended", operationId });
    session.checkActive();
    if (localStorage.getItem(key) !== before) continue;
    localStorage.setItem(key, value);
    return;
  }
}
