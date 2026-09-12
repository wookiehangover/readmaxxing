export class UnsupportedCustodyKindError extends Error {}

/** Lossless graph/byte representation shared by exports and review version tokens. */
export async function encodeCustodyRaw(raw: unknown) {
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
      throw new UnsupportedCustodyKindError(
        `Unsupported raw kind ${value.constructor?.name}; original remains retained`,
      );
    return { ref: node };
  }
  const root = await encode(raw);
  return { root, nodes, attachments };
}

export async function custodyReviewVersion(value: unknown): Promise<string> {
  const { root, nodes, attachments } = await encodeCustodyRaw(value);
  const text = JSON.stringify({
    root,
    nodes,
    attachments: attachments.map(({ bytes: _bytes, ...meta }) => meta),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
