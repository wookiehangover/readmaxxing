import { createHash } from "node:crypto";

/** Iterative traversal: no new nesting limit on historically accepted JSON. */
export function canonicalJSON(value: unknown): string {
  const output: string[] = [];
  const stack: Array<{ value?: unknown; literal?: string }> = [{ value }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.literal !== undefined) {
      output.push(item.literal);
      continue;
    }
    const current = item.value;
    if (current === null || typeof current !== "object") {
      output.push(JSON.stringify(current) ?? "null");
      continue;
    }
    const array = Array.isArray(current);
    const keys = array ? current.map((_, i) => String(i)) : Object.keys(current).sort();
    output.push(array ? "[" : "{");
    stack.push({ literal: array ? "]" : "}" });
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      if (i < keys.length - 1) stack.push({ literal: "," });
      stack.push({ value: (current as Record<string, unknown>)[key] });
      if (!array) stack.push({ literal: `${JSON.stringify(key)}:` });
    }
  }
  return output.join("");
}
export function snapshotIdentity(entry: Record<string, unknown>) {
  const { synced: _synced, failure: _failure, ...snapshot } = entry;
  const json = canonicalJSON(snapshot);
  return { snapshot, json, fingerprint: createHash("sha256").update(json).digest("hex") };
}
export function isEnvelope(value: unknown): value is Record<string, unknown> & {
  id: string;
  entity: string;
  entityId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [record.id, record.entity, record.entityId].every(
    (v) => typeof v === "string" && v.length > 0,
  );
}
