/** Equality for custody, never JSON equality. Unknown clone kinds remain distinct. */
export async function equalRaw(a: unknown, b: unknown): Promise<boolean> {
  const left = new Map<object, object>();
  const right = new Map<object, object>();
  async function equal(a: unknown, b: unknown): Promise<boolean> {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (left.has(a) || right.has(b)) return left.get(a) === b && right.get(b) === a;
    left.set(a, b);
    right.set(b, a);
    if (a.constructor !== b.constructor) return false;
    const bytes = (x: ArrayBufferLike, y: ArrayBufferLike) => {
      const u = new Uint8Array(x),
        v = new Uint8Array(y);
      return u.length === v.length && u.every((byte, i) => byte === v[i]);
    };
    if (a instanceof Blob && b instanceof Blob) {
      if (a.type !== b.type || a.size !== b.size) return false;
      if (
        typeof File !== "undefined" &&
        a instanceof File &&
        b instanceof File &&
        (a.name !== b.name || a.lastModified !== b.lastModified)
      )
        return false;
      return bytes(await a.arrayBuffer(), await b.arrayBuffer());
    }
    if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) return bytes(a, b);
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      return (
        a.byteOffset === b.byteOffset &&
        a.byteLength === b.byteLength &&
        (await equal(a.buffer, b.buffer))
      );
    }
    if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime());
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
    if (
      !Array.isArray(a) &&
      Object.getPrototypeOf(a) !== Object.prototype &&
      Object.getPrototypeOf(a) !== null
    )
      return false;
    const keys = Object.keys(a),
      other = Object.keys(b);
    if (keys.length !== other.length) return false;
    for (const key of keys) {
      if (
        !Object.hasOwn(b, key) ||
        !(await equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
      )
        return false;
    }
    return true;
  }
  return equal(a, b);
}

const transactionBoundaries = new WeakMap<IDBObjectStore, Array<() => void>>();

/** Resume in an IDB request callback task before issuing writes after Blob IO. */
export function liveTransactionBoundary(store: IDBObjectStore): Promise<void> {
  const pending = transactionBoundaries.get(store);
  if (!pending) throw new Error("Missing live transaction");
  return new Promise((resolve) => pending.push(resolve));
}

/** A byte comparison may await Blob IO; keep this IDB transaction live until it finishes. */
export async function inLiveTransaction<T>(
  store: IDBObjectStore,
  work: () => Promise<T>,
): Promise<T> {
  let active = true;
  const pending: Array<() => void> = [];
  transactionBoundaries.set(store, pending);
  const keepAlive = () => {
    if (!active) return;
    const request = store.get("__custody_keepalive__");
    request.onsuccess = () => {
      keepAlive();
      for (const resolve of pending.splice(0)) resolve();
    };
  };
  keepAlive();
  try {
    return await work();
  } catch (error) {
    store.transaction.abort();
    throw error;
  } finally {
    active = false;
    transactionBoundaries.delete(store);
  }
}
