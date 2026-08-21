import { describe, expect, it, vi } from "vitest";
import { removeOrphanedPanels, restoreDockviewLayout } from "~/hooks/workspace-layout-restore";
import type { DockviewApi, IDockviewPanel, SerializedDockview } from "dockview-react";

describe("dockview layout restore", () => {
  function panel(id: string, bookId: string) {
    return { id, params: { bookId } } as unknown as IDockviewPanel;
  }

  it("continues orphan cleanup when one panel removal throws", () => {
    const first = panel("book-missing-a", "missing-a");
    const second = panel("book-missing-b", "missing-b");
    const removePanel = vi.fn((candidate: IDockviewPanel) => {
      if (candidate === first) throw new Error("invalid operation");
    });
    const api = { panels: [first, second], removePanel } as Pick<
      DockviewApi,
      "panels" | "removePanel"
    >;

    expect(removeOrphanedPanels(api, new Set())).toBe(false);
    expect(removePanel).toHaveBeenCalledTimes(2);
    expect(removePanel).toHaveBeenLastCalledWith(second);
  });

  it("clears live and stored state after restore failure", async () => {
    const api = {
      fromJSON: vi.fn(() => {
        throw new Error("invalid operation");
      }),
      clear: vi.fn(),
      panels: [],
      removePanel: vi.fn(),
    } as unknown as Pick<DockviewApi, "clear" | "fromJSON" | "panels" | "removePanel">;
    const clearStoredLayout = vi.fn().mockResolvedValue(undefined);

    const restored = await restoreDockviewLayout(
      api,
      { grid: {}, panels: {} } as SerializedDockview,
      new Set(),
      clearStoredLayout,
    );

    expect(restored).toBe(false);
    expect(api.clear).toHaveBeenCalledOnce();
    expect(clearStoredLayout).toHaveBeenCalledOnce();
  });
});
