import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("root shouldRevalidate", () => {
  it("skips root loader revalidation during client navigations", () => {
    const source = readFileSync("app/root.tsx", "utf8");

    expect(source).toMatch(/export function shouldRevalidate\(\) \{\s+return false;\s+\}/);
  });
});
