import { get, promisifyRequest, type UseStore } from "idb-keyval";

/** Each database move is atomic; its cross-database replay is durable first. */
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
  } = {},
): Promise<boolean> {
  for (;;) {
    options.checkActive?.();
    const snapshot = await get<T>(fromKey, useStore);
    if (snapshot === undefined || (options.matches && !options.matches(snapshot))) return false;
    await options.prepare?.(snapshot);
    options.checkActive?.();
    let retry = false;
    let changed = false;
    await useStore("readwrite", (store) => {
      const sourceRequest = store.get(fromKey);
      const targetRequest = store.get(toKey);
      targetRequest.onsuccess = () => {
        const source = sourceRequest.result as T | undefined;
        if (source === undefined || (options.matches && !options.matches(source))) return;
        // A producer edited the source during replay preparation. Preserve that
        // version too before moving it; never delete a snapshot we did not retain.
        if (options.prepare && JSON.stringify(source) !== JSON.stringify(snapshot)) {
          retry = true;
          return;
        }
        const target = targetRequest.result as T | undefined;
        const merged = merge(source, target);
        if (merged !== undefined) store.put(merged, toKey);
        if (fromKey !== toKey) {
          if (options.keepSource) store.put(options.keepSource(source), fromKey);
          else store.delete(fromKey);
        }
        changed = true;
      };
      return promisifyRequest(store.transaction);
    });
    if (!retry) return changed;
  }
}
