import type { CustodyItem } from "./custody-journal";
import { equalRaw } from "./raw-snapshot";
import { encodeCustodyRaw } from "./custody-encoding";

const entities: Record<string, string> = {
  "ebook-reader-db/books": "book",
  "ebook-reader-notebooks/notebooks": "notebook",
  "ebook-reader-highlights/highlights": "highlight",
  "ebook-reader-bookmarks/bookmarks": "bookmark",
  "ebook-reader-positions/positions": "position",
};
const supported = new Set([
  "book",
  "notebook",
  "position",
  "highlight",
  "bookmark",
  "chat_session",
  "settings",
]);

function record(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** A supported projection is explicit; private raw always remains the source of truth. */
export async function localRecoverySnapshot(item: CustodyItem): Promise<Record<string, unknown>> {
  let raw = item.raw;
  if (item.source === "localStorage" && item.key === "app-settings" && typeof raw === "string")
    raw = JSON.parse(raw);
  if (!record(raw)) throw new Error("This local snapshot has no supported text record");
  let snapshot: Record<string, unknown>;
  if (
    supported.has(String(raw.entity)) &&
    typeof raw.id === "string" &&
    typeof raw.entityId === "string"
  ) {
    snapshot = structuredClone(raw);
  } else {
    const entity =
      item.source === "localStorage" && item.key === "app-settings"
        ? "settings"
        : entities[item.source];
    if (!entity || typeof item.key !== "string")
      throw new Error("This local snapshot has no supported text record");
    snapshot = {
      id: `local:${item.id}`,
      entity,
      entityId: item.key,
      operation: raw.deletedAt != null ? "delete" : "put",
      data: raw,
      ...(Object.hasOwn(raw, "updatedAt") ? { timestamp: raw.updatedAt } : {}),
    };
  }
  let projected: Record<string, unknown>;
  try {
    projected = JSON.parse(
      JSON.stringify(snapshot, (_key, value) => {
        if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value))
          return undefined;
        if (typeof value === "bigint") return null;
        return value;
      }),
    );
  } catch {
    throw new Error("This local record requires an export before it can be edited");
  }
  if (!record(projected.data))
    throw new Error("This local snapshot has no supported editable content");
  if (
    !Number.isSafeInteger(snapshot.timestamp) ||
    (snapshot.timestamp as number) < 0 ||
    !(await equalRaw(snapshot, projected))
  ) {
    const { root, nodes } = await encodeCustodyRaw(snapshot.timestamp);
    projected.recoveryProjection = {
      kind: "local-raw-projection",
      requiresNewEdit: true,
      sourceItemId: item.id,
      originalClock: { present: Object.hasOwn(snapshot, "timestamp"), root, nodes },
    };
  }
  return projected;
}

export function localRecoveryFile(item: CustodyItem, kind: "file" | "cover"): Blob | ArrayBuffer {
  let raw = item.raw;
  if (record(raw) && record(raw.data)) raw = raw.data;
  if (record(raw)) raw = kind === "cover" ? raw.coverBlob : raw.fileData;
  else {
    const inferredKind = raw instanceof Blob && raw.type.startsWith("image/") ? "cover" : "file";
    if (kind !== inferredKind)
      throw new Error(`This snapshot does not contain retained ${kind} bytes`);
  }
  if (raw instanceof Blob || raw instanceof ArrayBuffer) return raw;
  if (ArrayBuffer.isView(raw))
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  throw new Error(`This snapshot does not contain retained ${kind} bytes`);
}

export async function localRecoveryCapabilities(item: CustodyItem) {
  let text = false,
    requiresNewEdit = false;
  try {
    const snapshot = await localRecoverySnapshot(item);
    text = true;
    requiresNewEdit = !!snapshot.recoveryProjection;
  } catch {
    /* Unsupported source remains inspectable/exportable. */
  }
  const files = (["file", "cover"] as const).filter((kind) => {
    try {
      localRecoveryFile(item, kind);
      return true;
    } catch {
      return false;
    }
  });
  const raw = record(item.raw) ? item.raw : {};
  const data = record(raw.data) ? raw.data : raw;
  const suggestedBookId =
    typeof data.bookId === "string"
      ? data.bookId
      : ["book", "notebook", "position"].includes(String(raw.entity)) &&
          typeof raw.entityId === "string"
        ? raw.entityId
        : typeof item.key === "string"
          ? item.key
          : undefined;
  return { text, requiresNewEdit, files, suggestedBookId };
}
