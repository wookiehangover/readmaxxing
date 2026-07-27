import { describe, expect, it } from "vitest";
import { consumePendingClusterActivation } from "~/hooks/use-workspace-layout";

describe("consumePendingClusterActivation", () => {
  const clusters = new Map([
    ["book-a", {}],
    ["book-b", {}],
    ["book-c", {}],
  ]);

  it("selects the pending non-last cluster after a remount", () => {
    const pending = { current: "book-b" as string | null };
    const active = { current: "book-c" as string | null };

    consumePendingClusterActivation(pending, active, clusters);

    expect(active.current).toBe("book-b");
    expect(pending.current).toBeNull();
  });

  it("consumes an activation when the clicked cluster was already active", () => {
    const pending = { current: "book-b" as string | null };
    const active = { current: "book-b" as string | null };

    consumePendingClusterActivation(pending, active, clusters);

    expect(active.current).toBe("book-b");
    expect(pending.current).toBeNull();
  });
});
