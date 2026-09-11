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
  session.checkActive();
  return { item, facts: access.facts };
}

/** Versioned graph representation; attachments remain exact bytes, never JSON placeholders. */
export async function exportLocalRecovery(id: string, ownerId?: string) {
  const session = custodySession(ownerId);
  const { item } = await localRecoveryDetail(id, ownerId);
  const seen = new Map<object, number>();
  const nodes: unknown[] = [];
  const attachments: Array<{
    node: number;
    kind: string;
    mime: string;
    size: number;
    checksum: string;
    bytes: ArrayBuffer;
  }> = [];
  async function encode(value: unknown): Promise<unknown> {
    if (value === undefined) return { type: "undefined" };
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
      return { type: "number", value: Object.is(value, -0) ? "-0" : String(value) };
    if (typeof value === "bigint") return { type: "bigint", value: String(value) };
    if (!value || typeof value !== "object") return { type: typeof value, value };
    if (seen.has(value)) return { ref: seen.get(value) };
    const node = nodes.length;
    seen.set(value, node);
    nodes.push(null);
    if (ArrayBuffer.isView(value)) {
      nodes[node] = {
        type: value.constructor.name,
        buffer: await encode(value.buffer),
        byteOffset: value.byteOffset,
        byteLength: value.byteLength,
      };
    } else if (value instanceof Blob || value instanceof ArrayBuffer) {
      const bytes = value instanceof Blob ? await value.arrayBuffer() : value.slice(0);
      const checksum = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const kind = value.constructor.name;
      const mime = value instanceof Blob ? value.type : "application/octet-stream";
      attachments.push({ node, kind, mime, size: bytes.byteLength, checksum, bytes });
      nodes[node] = {
        type: kind,
        attachment: attachments.length - 1,
        ...(typeof File !== "undefined" && value instanceof File
          ? { name: value.name, lastModified: value.lastModified }
          : {}),
      };
    } else if (value instanceof Date)
      nodes[node] = { type: "Date", value: await encode(value.getTime()) };
    else if (
      Array.isArray(value) ||
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null
    ) {
      const properties: Array<[string, unknown]> = [];
      for (const key of Object.keys(value))
        properties.push([key, await encode((value as Record<string, unknown>)[key])]);
      nodes[node] = {
        type: Array.isArray(value) ? "Array" : "Object",
        ...(Array.isArray(value) ? { length: value.length } : {}),
        properties,
      };
    } else
      throw new Error(`Unsupported raw kind ${value.constructor?.name}; original remains retained`);
    return { ref: node };
  }
  const root = await encode(item.raw);
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
