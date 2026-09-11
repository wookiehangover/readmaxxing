import { entries, get, promisifyRequest, type UseStore } from "idb-keyval";
import { custodySession, unboundPartition } from "./custody-session";
import { equalRaw, inLiveTransaction } from "./raw-snapshot";
import {
  getBookRemapStore,
  getCustodyStore,
  getBookStore,
  getNotebookStore,
  getPositionStore,
  getHighlightStore,
  getBookmarkStore,
  getChatSessionStore,
} from "./stores";

export interface CustodyItem {
  kind: "snapshot";
  id: string;
  operationId: string;
  partition: string;
  source: string;
  key: IDBValidKey;
  role: "before" | "intended" | "transport";
  provenance: "authored-unbound" | "observed-unattributed" | "account";
  raw: unknown;
  createdAt: number;
}
export interface CustodyMetadata extends Omit<CustodyItem, "raw"> {
  ownership: {
    entity?: unknown;
    entityId?: unknown;
    data: {
      id?: unknown;
      bookId?: unknown;
      sessionId?: unknown;
      ownerId?: unknown;
      userId?: unknown;
    };
    ownerId?: unknown;
    userId?: unknown;
  };
  binary: boolean;
}
function custodyMetadata(item: CustodyItem): CustodyMetadata {
  const value =
    item.raw && typeof item.raw === "object" ? (item.raw as Record<string, unknown>) : {};
  const data =
    value.data && typeof value.data === "object" ? (value.data as Record<string, unknown>) : value;
  const { raw: _raw, ...metadata } = item;
  return {
    ...metadata,
    binary:
      item.raw instanceof Blob || item.raw instanceof ArrayBuffer || ArrayBuffer.isView(item.raw),
    ownership: {
      entity: value.entity,
      entityId: value.entityId,
      ownerId: value.ownerId,
      userId: value.userId,
      data: {
        id: data.id,
        bookId: data.bookId,
        sessionId: data.sessionId,
        ownerId: data.ownerId,
        userId: data.userId,
      },
    },
  };
}
export interface CustodyFacts {
  ownerId?: string;
  receiptId?: string;
  conflict?: boolean;
  retired?: boolean;
  acknowledged?: boolean;
  projectionId?: string;
}
export const factsKey = (id: string) => `facts:${id}`;

export async function storeIdentity(store: UseStore): Promise<string> {
  return store("readonly", (objectStore) =>
    Promise.resolve(`${objectStore.transaction.db.name}/${objectStore.name}`),
  );
}

function explicitOwners(raw: unknown, seen = new Set<object>()): string[] {
  if (!raw || typeof raw !== "object" || seen.has(raw)) return [];
  seen.add(raw);
  if (Array.isArray(raw)) return raw.flatMap((value) => explicitOwners(value, seen));
  const value = raw as Record<string, unknown>;
  return [
    value.ownerId,
    value.userId,
    ...(value.data && typeof value.data === "object" ? explicitOwners(value.data, seen) : []),
  ].filter((id): id is string => typeof id === "string" && !!id);
}

/** Known local resource/alias ownership wins over historical first-binding. */
export async function validateCustodyOwner(
  ownerId: string | undefined,
  raw: unknown,
  source?: string,
  key?: IDBValidKey,
): Promise<string | undefined> {
  const owners = new Set(explicitOwners(raw));
  if (source && source !== "localStorage" && key !== undefined) {
    const binding = await get<string>(["resource", source, key], getCustodyStore());
    if (binding) owners.add(binding);
  }
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const data =
    value.data && typeof value.data === "object" ? (value.data as Record<string, unknown>) : value;
  const refs = new Set([key, value.entityId, data.id, data.bookId, data.sessionId]);
  // A producer can reach recordChange after an account switch. Consult the
  // actual entity's existing custody binding before retaining an outgoing copy.
  const entityStores: Record<string, () => UseStore> = {
    book: getBookStore,
    notebook: getNotebookStore,
    position: getPositionStore,
    highlight: getHighlightStore,
    bookmark: getBookmarkStore,
    chat_session: getChatSessionStore,
  };
  const entityStore = typeof value.entity === "string" ? entityStores[value.entity] : undefined;
  const entityKey = value.entity === "chat_session" ? data.bookId : value.entityId;
  const resources: Array<[UseStore, string]> = [];
  if (entityStore && typeof entityKey === "string") resources.push([entityStore(), entityKey]);
  const bookId =
    typeof data.bookId === "string"
      ? data.bookId
      : ["book", "notebook", "position"].includes(String(value.entity))
        ? value.entityId
        : undefined;
  if (typeof bookId === "string") resources.push([getBookStore(), bookId]);
  for (const [store, resourceId] of resources) {
    const binding = await get<string>(
      ["resource", await storeIdentity(store), resourceId],
      getCustodyStore(),
    );
    if (binding) owners.add(binding);
  }
  const aliases = (
    await entries<string, { ownerId: string; fromId: string; toId: string }>(getBookRemapStore())
  )
    .map(([, alias]) => alias)
    .filter((alias) => alias?.ownerId && (refs.has(alias.fromId) || refs.has(alias.toId)));
  // An authenticated owner's own alias proof is authoritative for its terminal.
  // Another account's graph must not extend or override that proof.
  const relevant =
    ownerId && aliases.some((alias) => alias.ownerId === ownerId)
      ? aliases.filter((alias) => alias.ownerId === ownerId)
      : aliases;
  for (const alias of relevant) owners.add(alias.ownerId);
  if (owners.size > 1 || (ownerId && owners.size && !owners.has(ownerId)))
    throw new Error("Foreign local ownership; record retained");
  return [...owners][0] ?? ownerId;
}

/** Collision-safe immutable add. A reused token never replaces different raw data. */
export async function retainCustody(input: {
  source: string;
  key: IDBValidKey;
  raw: unknown;
  role: CustodyItem["role"];
  operationId?: string;
  ownerId?: string;
}): Promise<string> {
  const raw = structuredClone(input.raw);
  const session = custodySession(input.ownerId);
  const evidencedOwner = await validateCustodyOwner(session.ownerId, raw, input.source, input.key);
  const ownerId = input.role === "before" ? evidencedOwner : session.ownerId;
  const partition = ownerId ? `account:${ownerId}` : await unboundPartition();
  const operationId = input.operationId ?? crypto.randomUUID();
  if (ownerId && input.role !== "transport") {
    const covered = await get<{ raw: unknown; receiptId: string }>(
      ["coverage", ownerId, input.source, input.key],
      getCustodyStore(),
    );
    if (covered && (await equalRaw(covered.raw, raw))) return `covered:${covered.receiptId}`;
  }
  const prefix = JSON.stringify([partition, operationId, input.source, input.key, input.role]);
  let id = prefix;
  let collisionIndex = 0;
  for (;;) {
    session.checkActive();
    let collision = false;
    let matched = false;
    await getCustodyStore()("readwrite", (store) => {
      const done = promisifyRequest(store.transaction);
      const work = inLiveTransaction(store, async () => {
        const existing = await promisifyRequest<CustodyItem | undefined>(store.get(id));
        if (existing) {
          matched = await equalRaw(existing.raw, raw);
          collision = !matched;
          return;
        }
        if (await promisifyRequest(store.get(`meta:${id}`))) {
          collision = true;
          return;
        }
        session.checkActive();
        if (ownerId && input.source !== "localStorage") {
          const resourceKey = ["resource", input.source, input.key];
          const bound = await promisifyRequest<string | undefined>(store.get(resourceKey));
          if (bound && bound !== ownerId) throw new Error("Foreign local binding; record retained");
          store.put(ownerId, resourceKey);
        }
        const item: CustodyItem = {
          kind: "snapshot",
          id,
          operationId,
          partition,
          source: input.source,
          key: input.key,
          role: input.role,
          provenance: ownerId
            ? "account"
            : input.role === "before"
              ? "observed-unattributed"
              : "authored-unbound",
          raw,
          createdAt: Date.now(),
        };
        store.add(item, id);
        store.add(custodyMetadata(item), `meta:${id}`);
        store.add({ ownerId } satisfies CustodyFacts, factsKey(id));
      });
      return Promise.all([done, work]).then(() => {});
    });
    if (!collision || matched) return id;
    id = `${prefix}:${crypto.randomUUID()}:${++collisionIndex}`;
  }
}

/** One transaction chooses the first account; another tab can never rebind it. */
export async function bindCustody(id: string, ownerId: string): Promise<boolean> {
  const session = custodySession(ownerId);
  const item = await get<CustodyItem>(id, getCustodyStore());
  if (!item || item.kind !== "snapshot") return false;
  await validateCustodyOwner(ownerId, item.raw, item.source, item.key);
  session.checkActive();
  let bound = false;
  await getCustodyStore()("readwrite", (store) => {
    const done = promisifyRequest(store.transaction);
    const work = inLiveTransaction(store, async () => {
      const facts =
        (await promisifyRequest<CustodyFacts | undefined>(store.get(factsKey(id)))) ?? {};
      const groupKey = ["binding", item.partition, item.operationId];
      const groupOwner = await promisifyRequest<string | undefined>(store.get(groupKey));
      const resourceKey = ["resource", item.source, item.key];
      const resourceOwner =
        item.source === "localStorage"
          ? undefined
          : await promisifyRequest<string | undefined>(store.get(resourceKey));
      if (
        facts.conflict ||
        [facts.ownerId, groupOwner, resourceOwner].some((owner) => owner && owner !== ownerId)
      )
        return;
      session.checkActive();
      store.put({ ...facts, ownerId }, factsKey(id));
      store.put(ownerId, groupKey);
      if (item.source !== "localStorage") store.put(ownerId, resourceKey);
      bound = true;
    });
    return Promise.all([done, work]).then(() => {});
  });
  return bound;
}

function sameUnboundProfile(candidate: string, current: string): boolean {
  const parts = candidate.split(":");
  const currentParts = current.split(":");
  return (
    parts.length === 3 &&
    currentParts.length === 3 &&
    parts[0] === "unbound" &&
    currentParts[0] === "unbound" &&
    !!parts[1] &&
    !!parts[2] &&
    parts[1] === currentParts[1]
  );
}

/** Metadata-only enumeration excludes foreign bindings before any raw snapshot read. */
export async function listCustodyMetadata(
  ownerId?: string,
): Promise<Array<{ item: CustodyMetadata; facts: CustodyFacts }>> {
  const session = custodySession(ownerId);
  const partition = await unboundPartition();
  const all = await getCustodyStore()("readonly", (store) =>
    promisifyRequest<CustodyMetadata[]>(store.getAll(IDBKeyRange.bound("meta:", "meta:\uffff"))),
  );
  const result: Array<{ item: CustodyMetadata; facts: CustodyFacts }> = [];
  for (const item of all) {
    const storedFacts = (await get<CustodyFacts>(factsKey(item.id), getCustodyStore())) ?? {};
    const groupOwner = await get<string>(
      ["binding", item.partition, item.operationId],
      getCustodyStore(),
    );
    const fact = { ...storedFacts, ownerId: storedFacts.ownerId ?? groupOwner };
    if (
      fact.retired ||
      (fact.ownerId ? fact.ownerId !== ownerId : !sameUnboundProfile(item.partition, partition))
    )
      continue;
    try {
      const resourceOwner = await validateCustodyOwner(
        ownerId,
        item.ownership,
        item.source,
        item.key,
      );
      // A different operation may have bound this resource after its snapshot
      // was captured. Such evidence must also hide it while signed out.
      if (resourceOwner && resourceOwner !== ownerId) continue;
    } catch {
      continue;
    }
    result.push({ item, facts: fact });
  }
  session.checkActive();
  return result;
}

export async function listCustody(
  ownerId?: string,
  options: { omitBinary?: boolean } = {},
): Promise<Array<{ item: CustodyItem; facts: CustodyFacts }>> {
  const session = custodySession(ownerId);
  const result: Array<{ item: CustodyItem; facts: CustodyFacts }> = [];
  for (const { item: metadata, facts } of await listCustodyMetadata(ownerId)) {
    if (options.omitBinary && metadata.binary) continue;
    session.checkActive();
    const item = await get<CustodyItem>(metadata.id, getCustodyStore());
    if (item) result.push({ item, facts });
  }
  session.checkActive();
  return result;
}
