import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("service-worker navigation fallback", () => {
  it("denies debug routes from the cached app shell", () => {
    const source = readFileSync("vite.config.ts", "utf8");
    expect(source).toContain(
      "navigateFallbackDenylist: [/^\\/api\\//, /^\\/share\\//, /^\\/debug\\//]",
    );
  });
});
