import type { DockviewApi, SerializedDockview } from "dockview-react";

type RestoreDockviewApi = Pick<DockviewApi, "clear" | "fromJSON" | "panels" | "removePanel">;

export function removeOrphanedPanels(
  api: Pick<DockviewApi, "panels" | "removePanel">,
  existingBookIds: ReadonlySet<string>,
): boolean {
  let succeeded = true;
  for (const panel of Array.from(api.panels)) {
    const bookId = (panel.params as Record<string, unknown> | undefined)?.bookId;
    if (typeof bookId !== "string" || existingBookIds.has(bookId)) continue;
    try {
      api.removePanel(panel);
      console.log(`[workspace] Removed orphaned panel ${panel.id} for deleted book ${bookId}`);
    } catch (error) {
      succeeded = false;
      console.error(`[workspace] Failed to remove orphaned panel ${panel.id}:`, error);
    }
  }
  return succeeded;
}

export async function restoreDockviewLayout(
  api: RestoreDockviewApi,
  layout: SerializedDockview,
  existingBookIds: ReadonlySet<string>,
  clearStoredLayout: () => Promise<void>,
): Promise<boolean> {
  try {
    api.fromJSON(layout);
    if (!removeOrphanedPanels(api, existingBookIds)) {
      throw new Error("Failed to remove one or more orphaned dockview panels");
    }
    return true;
  } catch (error) {
    console.error("Failed to restore dockview layout:", error);
    try {
      api.clear();
    } catch (clearError) {
      console.error("Failed to clear broken dockview layout:", clearError);
    }
    try {
      await clearStoredLayout();
    } catch (clearError) {
      console.error("Failed to clear stored dockview layout:", clearError);
    }
    return false;
  }
}
