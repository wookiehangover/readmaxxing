import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB_1 = resolve(__dirname, "fixtures/test-book.epub");
const TEST_EPUB_2 = resolve(__dirname, "fixtures/test-book-2.epub");

/**
 * Upload an epub by path and wait for its dockview tab to appear. Uses the
 * first hidden file input, which is the sidebar's upload input. The reader
 * mounts automatically on upload (handleBookAdded → openBook).
 */
async function uploadBook(page: Page, path: string, expectedTitle: string) {
  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(path);
  await expect(page.locator(".dv-default-tab", { hasText: expectedTitle }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/** ClusterBar pills are scoped to the tablist with aria-label "Open books". */
function clusterPills(page: Page) {
  return page.getByRole("tablist", { name: "Open books" }).getByRole("tab");
}

test.describe("Layout modes", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });

    // Clear storage and pre-collapse sidebar (same pattern as workspace.spec.ts:
    // prevents the sidebar auto-collapse transition from racing epubjs init).
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      localStorage.setItem(
        "app-settings",
        JSON.stringify({ sidebarCollapsed: true, updatedAt: Date.now() }),
      );
    });

    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });
  });

  test("defaults to focused mode and renders a cluster pill per open book", async ({ page }) => {
    // Confirm the persisted settings default (no explicit layoutMode set →
    // focused is the default from settings.ts).
    const layoutMode = await page.evaluate(() => {
      const raw = localStorage.getItem("app-settings");
      if (!raw) return undefined;
      try {
        return (JSON.parse(raw) as { layoutMode?: string }).layoutMode ?? "focused";
      } catch {
        return undefined;
      }
    });
    // No explicit value set → app uses the default ("focused"). Either
    // undefined (unset) or "focused" is acceptable here.
    expect(layoutMode === undefined || layoutMode === "focused").toBe(true);

    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");

    // ClusterBar is rendered and shows exactly one pill (active).
    await expect(clusterPills(page)).toHaveCount(1);
    const pill1 = clusterPills(page).first();
    await expect(pill1).toHaveAttribute("aria-selected", "true");
    await expect(pill1).toContainText("Test Book for E2E");
  });

  test("opening a second book adds a pill and swaps the active cluster", async ({ page }) => {
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");
    await uploadBook(page, TEST_EPUB_2, "Second Test Book");

    const pills = clusterPills(page);
    await expect(pills).toHaveCount(2);

    // Last-opened cluster is active; only one pill should be selected.
    await expect(pills.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(pills.nth(0)).toHaveAttribute("aria-selected", "false");

    // Focused mode mounts at most one book-reader panel at a time. Use
    // anchored regexes to exclude the auto-opened "Discuss: …" chat tab.
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Second Test Book$/ }),
    ).toHaveCount(1);
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Test Book for E2E$/ }),
    ).toHaveCount(0);

    // Click the first pill → swap back to the first cluster.
    await pills.nth(0).click();
    await expect(pills.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(pills.nth(1)).toHaveAttribute("aria-selected", "false");
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Test Book for E2E$/ }),
    ).toHaveCount(1);
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Second Test Book$/ }),
    ).toHaveCount(0);
  });

  test("Cmd+1..9 activates the Nth cluster, and is ignored in editable elements", async ({
    page,
  }) => {
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");
    await uploadBook(page, TEST_EPUB_2, "Second Test Book");

    const pills = clusterPills(page);
    await expect(pills).toHaveCount(2);
    await expect(pills.nth(1)).toHaveAttribute("aria-selected", "true");

    // Click outside any input to ensure activeElement is not editable.
    await page
      .locator(".dv-dockview")
      .first()
      .click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("Meta+1");
    await expect(pills.nth(0)).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });

    // Open reader search and focus its input → shortcut must be ignored.
    await page.getByRole("button", { name: "Search in book" }).first().click();
    const searchInput = page.getByPlaceholder("Search in book…");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.click();
    await searchInput.fill("hello");
    await page.keyboard.press("Meta+2");
    // Shortcut should not have swapped clusters and the input keeps focus.
    await expect(pills.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(searchInput).toHaveValue(/hello/);
  });

  test("opening the same book twice does not create a duplicate cluster", async ({ page }) => {
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");

    // Re-uploading the same file hits the findByFileHash early-return path
    // and calls openBook(existing). In focused mode this must activate the
    // existing cluster rather than create a new one. This also avoids the
    // multi-book swap path, so it does not trigger the focused-mode bug
    // noted above.
    const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
    await fileInput.setInputFiles(TEST_EPUB_1);

    // Allow any potential state churn to settle.
    await page.waitForTimeout(500);

    await expect(clusterPills(page)).toHaveCount(1);
    // Exactly one book-reader tab (not counting the "Discuss: Test Book…"
    // chat tab that also contains the book title).
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Test Book for E2E$/ }),
    ).toHaveCount(1);
  });

  test("focused mode disables tab drag-and-drop on dockview tabs", async ({ page }) => {
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");

    // dockview reflects disableDnd by setting draggable=false on .dv-tab.
    const tab = page.locator(".dv-tab").first();
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute("draggable", "false");
  });

  test("closing a cluster via its pill X button removes the cluster and its panels", async ({
    page,
  }) => {
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");
    await uploadBook(page, TEST_EPUB_2, "Second Test Book");

    await expect(clusterPills(page)).toHaveCount(2);

    // Close the active (second) cluster. The X button is hidden until hover,
    // so we click with force to bypass the opacity-0 check.
    await page.getByRole("button", { name: "Close Second Test Book" }).click({ force: true });

    await expect(clusterPills(page)).toHaveCount(1);
    await expect(clusterPills(page).first()).toContainText("Test Book for E2E");
    await expect(clusterPills(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".dv-default-tab", { hasText: "Second Test Book" })).toHaveCount(0);
  });

  test("freeform mode hides the cluster bar and re-enables tab drag", async ({ page }) => {
    // Force freeform mode via localStorage and reload. This test covers the
    // render-level guarantees of freeform mode in isolation; the switcher
    // UI flow is covered by the dedicated test below.
    await page.evaluate(() => {
      localStorage.setItem(
        "app-settings",
        JSON.stringify({
          sidebarCollapsed: true,
          layoutMode: "freeform",
          updatedAt: Date.now(),
        }),
      );
    });
    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });

    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");

    // ClusterBar is scoped to focused mode; in freeform it must not render.
    await expect(page.getByRole("tablist", { name: "Open books" })).toHaveCount(0);

    // In freeform, dockview runs with `disableDnd={false}`, which surfaces
    // as `draggable="true"` on rendered tabs.
    await expect(page.locator(".dv-tab").first()).toHaveAttribute("draggable", "true");
  });

  test("switcher UI toggles focused ↔ freeform via dropdown", async ({ page }) => {
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");

    // Start in focused mode: cluster bar visible, trigger reflects "Focused".
    // The visible label is hidden when the sidebar is collapsed (the default
    // in this spec's beforeEach), so assert against the stable aria-label.
    const trigger = page.getByTestId("layout-mode-trigger");
    await expect(clusterPills(page)).toHaveCount(1);
    await expect(trigger).toHaveAttribute("aria-label", /Focused/);

    // Open the dropdown and pick Freeform → mode flips immediately.
    await trigger.click();
    await page.getByTestId("layout-mode-freeform").click();

    // Cluster bar is gone; trigger now reflects "Freeform".
    await expect(page.getByRole("tablist", { name: "Open books" })).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-label", /Freeform/);

    // Switch back to focused via the dropdown.
    await trigger.click();
    await page.getByTestId("layout-mode-focused").click();
    await expect(trigger).toHaveAttribute("aria-label", /Focused/);
    await expect(clusterPills(page)).toHaveCount(1);
    await expect(clusterPills(page).first()).toHaveAttribute("aria-selected", "true");
  });

  test("mode toggle preserves focused state across a round trip", async ({ page }) => {
    // Open two books in the default (focused) mode. Both should appear as
    // pills; only the last-opened cluster is visible.
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");
    await uploadBook(page, TEST_EPUB_2, "Second Test Book");
    await expect(clusterPills(page)).toHaveCount(2);

    const trigger = page.getByTestId("layout-mode-trigger");

    // Toggle to freeform — ClusterBar disappears.
    await trigger.click();
    await page.getByTestId("layout-mode-freeform").click();
    await expect(page.getByRole("tablist", { name: "Open books" })).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-label", /Freeform/);

    // Toggle back to focused. Focused's session state (both clusters) must
    // survive the round trip: ClusterBar shows both pills and exactly one
    // cluster's book reader is mounted. Before the fix, the mode-switch
    // flush would write dockview JSON to whichever mode `layoutModeRef`
    // pointed at — corrupting focused's slot — and the second pill would
    // vanish.
    await trigger.click();
    await page.getByTestId("layout-mode-focused").click();
    await expect(trigger).toHaveAttribute("aria-label", /Focused/);
    await expect(clusterPills(page)).toHaveCount(2);
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Test Book for E2E$|^Second Test Book$/ }),
    ).toHaveCount(1);

    // Swapping via the inactive pill still works after the round trip.
    const pills = clusterPills(page);
    const firstSelected = await pills.nth(0).getAttribute("aria-selected");
    const inactivePill = firstSelected === "true" ? pills.nth(1) : pills.nth(0);
    await inactivePill.click();
    await expect(inactivePill).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });
  });

  test("toggling freeform → focused cleans up untracked panels", async ({ page }) => {
    // Force freeform mode at load time so both books mount simultaneously.
    await page.evaluate(() => {
      localStorage.setItem(
        "app-settings",
        JSON.stringify({
          sidebarCollapsed: true,
          layoutMode: "freeform",
          updatedAt: Date.now(),
        }),
      );
    });
    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });

    // In freeform, both books mount as sibling panels (no swap logic).
    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");
    await uploadBook(page, TEST_EPUB_2, "Second Test Book");
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Test Book for E2E$/ }),
    ).toHaveCount(1);
    await expect(
      page.locator(".dv-default-tab").filter({ hasText: /^Second Test Book$/ }),
    ).toHaveCount(1);

    // Toggle to focused via the switcher. Both untracked book panels should
    // be reconciled into tracked clusters (two pills) and all but one
    // should be unmounted (the single-cluster-visible invariant).
    const trigger = page.getByTestId("layout-mode-trigger");
    await trigger.click();
    await page.getByTestId("layout-mode-focused").click();
    await expect(trigger).toHaveAttribute("aria-label", /Focused/);

    const pills = clusterPills(page);
    await expect(pills).toHaveCount(2);

    // Exactly one book-reader tab mounted.
    const bookReaderTabsMounted = page
      .locator(".dv-default-tab")
      .filter({ hasText: /^Test Book for E2E$|^Second Test Book$/ });
    await expect(bookReaderTabsMounted).toHaveCount(1);

    // Switching via the other pill should still work with reconciled
    // clusters. Identify the inactive pill and click it.
    const firstPill = pills.nth(0);
    const secondPill = pills.nth(1);
    const firstSelected = await firstPill.getAttribute("aria-selected");
    const inactivePill = firstSelected === "true" ? secondPill : firstPill;
    await inactivePill.click();
    await expect(inactivePill).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });
    // Still exactly one book-reader tab mounted after the swap.
    await expect(bookReaderTabsMounted).toHaveCount(1);
  });

  test("mobile viewport still renders the cluster bar in focused mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Reload so the isMobile hook picks up the new size at mount time.
    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });

    await uploadBook(page, TEST_EPUB_1, "Test Book for E2E");
    await expect(clusterPills(page)).toHaveCount(1);
    await expect(clusterPills(page).first()).toHaveAttribute("aria-selected", "true");
  });
});
