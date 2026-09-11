/** Canonicalization is for received JSON only; never use it for local raw custody. */
export async function deliveryFingerprint(change: unknown): Promise<string> {
  const wire = JSON.parse(JSON.stringify(change)) as Record<string, unknown>;
  delete wire.synced;
  delete wire.failure;
  const output: string[] = [];
  const stack: Array<{ value?: unknown; literal?: string }> = [{ value: wire }];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.literal !== undefined) {
      output.push(item.literal);
      continue;
    }
    const value = item.value;
    if (value === null || typeof value !== "object") {
      output.push(JSON.stringify(value) ?? "null");
      continue;
    }
    const array = Array.isArray(value);
    const keys = array ? value.map((_, i) => String(i)) : Object.keys(value).sort();
    output.push(array ? "[" : "{");
    stack.push({ literal: array ? "]" : "}" });
    for (let i = keys.length - 1; i >= 0; i--) {
      if (i < keys.length - 1) stack.push({ literal: "," });
      stack.push({ value: (value as Record<string, unknown>)[keys[i]] });
      if (!array) stack.push({ literal: `${JSON.stringify(keys[i])}:` });
    }
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(output.join("")));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
