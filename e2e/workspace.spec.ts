import { test, expect, type Frame, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAppHydration } from "./helpers/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");

/** Upload a test epub and wait for its reading route to hydrate. */
async function uploadTestBook(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(TEST_EPUB);

  const readingShell = page.getByTestId("reading-shell");
  const mobileReadingTabs = page.getByTestId("mobile-reading-tabs");
  const libraryBook = page.getByRole("button", { name: "Open Test Book for E2E" });
  const readerIsVisible = async () =>
    (await readingShell.isVisible().catch(() => false)) ||
    (await mobileReadingTabs.isVisible().catch(() => false));
  await expect
    .poll(
      async () => (await readerIsVisible()) || (await libraryBook.isVisible().catch(() => false)),
      { timeout: 20_000 },
    )
    .toBe(true);

  if (!(await readerIsVisible())) {
    await libraryBook.click({ force: true, timeout: 5_000 }).catch(() => {});
    await expect.poll(readerIsVisible, { timeout: 20_000 }).toBe(true);
  }
}

/**
 * Upload a book. The first upload auto-opens the reader panel, so we just
 * wait for the reader toolbar to initialize.
 */
async function uploadAndOpenBook(page: Page) {
  await uploadTestBook(page);

  // The book auto-opens on upload (handleBookAdded -> openBook). Wait for the
  // reader toolbar (prev/next buttons) as a signal that the reader is ready.
  await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
    timeout: 20_000,
  });
}

test.describe("Workspace route", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
    await page.goto("/favicon.svg", { waitUntil: "domcontentloaded" });

    // Clear IndexedDB + storage to isolate each test.
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
    });

    // Reload after clearing storage to get a fresh state
    await page.goto("/");
    await waitForAppHydration(page);
  });

  test("loads and renders library chrome", async ({ page }) => {
    const navigation = page.getByRole("navigation", { name: "Library navigation" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Library", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.locator('input[type="file"][accept=".epub,.pdf"]').first()).toBeAttached();
  });

  test("upload book via file input and verify it appears in the library", async ({ page }) => {
    await uploadTestBook(page);
    await page.goto("/library");
    await waitForAppHydration(page);
    await expect(page.getByRole("button", { name: "Open Test Book for E2E" })).toBeVisible();
  });

  test("uploaded book opens in a reader panel", async ({ page }) => {
    await uploadAndOpenBook(page);

    await expect(page.getByTestId("reading-shell")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
      timeout: 10_000,
    });
  });

  test("desktop reader opens Details from the reader menu", async ({ page }) => {
    await uploadAndOpenBook(page);

    const tabs = page.getByRole("tablist", { name: "Reading tools" });
    const detailsTab = tabs.getByRole("tab", { name: "Details", exact: true });

    await expect(tabs.getByRole("tab")).toHaveText(["Notes", "Discuss", "Outline"]);
    await page.getByRole("button", { name: "Reader menu" }).first().click();
    await page.getByRole("menuitem", { name: "Details", exact: true }).click();

    await expect(tabs.getByRole("tab")).toHaveText(["Notes", "Discuss", "Outline", "Details"]);
    await expect(detailsTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tabpanel").getByRole("heading", { name: "Test Book for E2E", exact: true }),
    ).toBeVisible();

    await tabs.getByRole("tab", { name: "Notes", exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveText(["Notes", "Discuss", "Outline"]);
    await expect(detailsTab).toHaveCount(0);
  });

  test("mobile EPUB tracks, settles, and stays mounted across reader tabs", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uploadTestBook(page);

    const mobileReader = page.getByTestId("mobile-reading-tabs");
    const tabs = mobileReader.getByRole("tablist", { name: "Reading sections" });
    const bookSurface = mobileReader.locator(":scope > [aria-label='Book surface']");
    const iframe = bookSurface.locator("iframe").first();

    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveText(["Read", "Notes", "Discuss", "Outline"]);
    await expect(tabs.getByRole("tab", { name: "Read", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(bookSurface).toBeVisible();
    await expect(iframe).toBeAttached();
    await expect(page.getByRole("button", { name: "Previous page" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next page" })).toHaveCount(0);
    await iframe.evaluate((element) => element.setAttribute("data-mobile-reader-test", "mounted"));

    const surfaceBox = await bookSurface.boundingBox();
    const frameBox = await iframe.boundingBox();
    if (!surfaceBox || !frameBox) throw new Error("Could not measure mobile EPUB geometry");
    expect(frameBox.x).toBeCloseTo(surfaceBox.x, 0);
    expect(frameBox.x + frameBox.width).toBeCloseTo(surfaceBox.x + surfaceBox.width, 0);
    const restingGeometry = await page
      .frameLocator("iframe")
      .first()
      .locator("body")
      .evaluate((body) => {
        const style = getComputedStyle(body);
        return {
          viewportWidth: body.ownerDocument.documentElement.clientWidth,
          paddingLeft: Number.parseFloat(style.paddingLeft),
          paddingRight: Number.parseFloat(style.paddingRight),
        };
      });
    expect(restingGeometry.viewportWidth).toBeCloseTo(frameBox.width, 0);
    expect(restingGeometry.paddingLeft).toBe(40);
    expect(restingGeometry.paddingRight).toBe(40);

    const epubHtml = page.frameLocator("iframe").first().locator("html");
    const readPageState = () =>
      epubHtml.evaluate((element) => {
        const scrolling = element.ownerDocument.scrollingElement ?? element;
        return `${scrolling.scrollLeft}:${element.ownerDocument.body.textContent?.trim()}`;
      });
    const initialPageState = await readPageState();
    const getContentFrame = async () => {
      const frame = await (await iframe.elementHandle())?.contentFrame();
      if (!frame) throw new Error("Could not get EPUB content frame");
      return frame;
    };
    const dispatchTouch = async (
      frame: Frame,
      type: "touchstart" | "touchmove" | "touchend",
      x: number,
      time: number,
    ) => {
      await frame.evaluate(
        ({ type, x, time }) => {
          const point = { identifier: 1, clientX: x, clientY: 100 };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === "touchend" ? [] : [point] },
            changedTouches: { value: [point] },
            timeStamp: { value: time },
          });
          document.dispatchEvent(event);
        },
        { type, x, time },
      );
    };
    const snapBackFrame = await getContentFrame();
    await dispatchTouch(snapBackFrame, "touchstart", 280, 10);
    await dispatchTouch(snapBackFrame, "touchmove", 230, 210);
    await expect
      .poll(() => iframe.evaluate((element) => (element as HTMLElement).style.transform))
      .toBe("");
    await expect(bookSurface.locator("iframe")).toHaveCount(1);
    await expect.poll(readPageState).toBe(initialPageState);
    await dispatchTouch(snapBackFrame, "touchend", 230, 410);
    await expect.poll(readPageState).toBe(initialPageState);
    await expect(bookSurface.locator("iframe")).toHaveCount(1);
    await expect
      .poll(() => iframe.evaluate((element) => (element as HTMLElement).style.transform))
      .toBe("");

    const commitFrame = await getContentFrame();
    await dispatchTouch(commitFrame, "touchstart", 280, 500);
    await dispatchTouch(commitFrame, "touchmove", 100, 700);
    await expect
      .poll(() => iframe.evaluate((element) => (element as HTMLElement).style.transform))
      .toBe("");
    await expect(bookSurface.locator("iframe")).toHaveCount(1);
    await expect.poll(readPageState).toBe(initialPageState);
    await dispatchTouch(commitFrame, "touchend", 100, 900);
    await expect.poll(readPageState).not.toBe(initialPageState);
    await expect(bookSurface.locator("iframe")).toHaveCount(1);
    await expect
      .poll(() => iframe.evaluate((element) => (element as HTMLElement).style.transform))
      .toBe("");

    await iframe.evaluate((element) => element.setAttribute("data-mobile-reader-test", "mounted"));

    const currentFrame = await (await iframe.elementHandle())?.contentFrame();
    if (!currentFrame) throw new Error("Could not get remounted EPUB content frame");
    await currentFrame.evaluate(() => {
      const paragraph = document.querySelector("p");
      if (!paragraph) throw new Error("No paragraph found in EPUB");
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const addToNotebook = page.getByRole("button", { name: "Add to Notebook" });
    await expect(addToNotebook).toBeVisible();
    await addToNotebook.click();

    for (const name of ["Notes", "Discuss", "Outline"]) {
      const tab = tabs.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(bookSurface).toBeAttached();
      await expect(iframe).toHaveAttribute("data-mobile-reader-test", "mounted");

      if (name === "Notes") await expect(page.locator("blockquote").first()).toBeVisible();
    }

    await page.getByRole("button", { name: "Reader menu" }).click();
    await page.getByRole("menuitem", { name: "Details", exact: true }).click();
    await expect(
      mobileReader
        .getByRole("tabpanel")
        .getByRole("heading", { name: "Test Book for E2E", exact: true }),
    ).toBeVisible();
    await expect(bookSurface).toBeAttached();
    await expect(iframe).toHaveAttribute("data-mobile-reader-test", "mounted");

    await tabs.getByRole("tab", { name: "Read", exact: true }).click();
    await expect(bookSurface).toBeVisible();
    await expect(iframe).toHaveAttribute("data-mobile-reader-test", "mounted");
  });

  test("mobile EPUB keeps the final real page aligned to the repeated inset", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uploadTestBook(page);

    const bookSurface = page
      .getByTestId("mobile-reading-tabs")
      .locator(":scope > [aria-label='Book surface']");
    const iframe = bookSurface.locator("iframe").first();
    await expect(iframe).toBeAttached();
    const frame = await (await iframe.elementHandle())?.contentFrame();
    if (!frame) throw new Error("Could not get EPUB content frame");

    await frame.evaluate(() => {
      const body = document.body;
      const style = getComputedStyle(body);
      const pageHeight =
        document.documentElement.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom);
      body.replaceChildren(
        ...["first", "middle", "final"].map((name) => {
          const page = document.createElement("div");
          page.style.height = `${pageHeight}px`;
          const marker = document.createElement("div");
          marker.dataset.pageMarker = name;
          marker.textContent = name;
          page.append(marker);
          return page;
        }),
      );
    });

    // Force the navigator to remeasure the synthetic three-page section.
    await page.setViewportSize({ width: 391, height: 844 });
    await expect.poll(() => frame.evaluate(() => document.documentElement.clientWidth)).toBe(391);
    await expect
      .poll(() =>
        frame.evaluate(() => {
          const scrolling = document.scrollingElement ?? document.documentElement;
          return scrolling.scrollWidth / scrolling.clientWidth;
        }),
      )
      .toBe(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        frame.evaluate(() => {
          const scrolling = document.scrollingElement ?? document.documentElement;
          return scrolling.scrollWidth / scrolling.clientWidth;
        }),
      )
      .toBe(3);

    const markerBox = (name: string) =>
      frame.locator(`[data-page-marker="${name}"]`).evaluate((marker) => {
        const rect = marker.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
    const first = await markerBox("first");
    const dispatchTouch = async (
      type: "touchstart" | "touchmove" | "touchend",
      x: number,
      time: number,
    ) => {
      await frame.evaluate(
        ({ type, x, time }) => {
          const point = { identifier: 1, clientX: x, clientY: 100 };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === "touchend" ? [] : [point] },
            changedTouches: { value: [point] },
            timeStamp: { value: time },
          });
          document.dispatchEvent(event);
        },
        { type, x, time },
      );
    };
    const turnNext = async (time: number, expectedOffset: number) => {
      await dispatchTouch("touchstart", 300, time);
      await dispatchTouch("touchmove", 100, time + 200);
      await dispatchTouch("touchend", 100, time + 400);
      await expect
        .poll(() =>
          frame.evaluate(() =>
            Math.round((document.scrollingElement ?? document.documentElement).scrollLeft),
          ),
        )
        .toBe(expectedOffset);
    };

    await turnNext(100, 390);
    const middle = await markerBox("middle");
    await turnNext(600, 780);
    const final = await markerBox("final");

    expect(middle.left).toBeCloseTo(first.left, 0);
    expect(middle.right).toBeCloseTo(first.right, 0);
    expect(final.left).toBeCloseTo(first.left, 0);
    expect(final.right).toBeCloseTo(first.right, 0);
  });

  test("reader has navigation buttons", async ({ page }) => {
    await uploadAndOpenBook(page);

    const prevButton = page.getByRole("button", { name: "Previous page" });
    const nextButton = page.getByRole("button", { name: "Next page" });

    await expect(prevButton.first()).toBeAttached();
    await expect(nextButton.first()).toBeAttached();

    // Click next — should not throw
    await nextButton.first().click();
  });

  test("search bar opens, finds results, and highlights matches", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Open search with keyboard shortcut
    await page.getByRole("button", { name: "Previous page" }).first().focus();
    await page.keyboard.press("Meta+f");

    // Verify search bar appears — it has an input with placeholder
    const searchInput = page.getByPlaceholder("Search in book…");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type a search query and wait for the debounced search to resolve
    await searchInput.fill("elephant");
    await expect(page.getByText("1 of 1")).toBeVisible({ timeout: 10_000 });

    // The match renders as a highlight decoration in the reader iframe —
    // either through the CSS Custom Highlight API or overlay spans.
    await expect
      .poll(
        async () => {
          let count = 0;
          for (const frame of page.frames()) {
            count += await frame
              .evaluate(
                () =>
                  ((globalThis as { CSS?: { highlights?: { size: number } } }).CSS?.highlights
                    ?.size ?? 0) +
                  document.querySelectorAll("[data-decoration-id^='search-highlight-']").length,
              )
              .catch(() => 0);
          }
          return count;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  test("TOC popover opens when book has table of contents", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for the TOC button to appear (only shows when book has TOC)
    const tocButton = page.getByRole("button", { name: "Table of Contents" });
    await expect(tocButton.first()).toBeVisible({ timeout: 15_000 });

    // Click the TOC button
    await tocButton.first().click();

    // Verify TOC popover content — should show chapter titles
    // Use .first() since TOC entries may appear in both sidebar and reader popovers
    await expect(
      page.getByRole("button", { name: "Chapter 1: The Beginning" }).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Chapter 2: The End" }).first()).toBeVisible();
  });

  test("highlight reference navigate and delete in notebook", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for epub iframe to be ready with content
    const iframe = page.frameLocator("iframe").first();
    const chapterText = iframe.locator("p").first();
    await expect(chapterText).toBeVisible({ timeout: 20_000 });

    // Open the Notes rail FIRST so the callback map is registered.
    const notebookTab = page.getByRole("tab", { name: "Notes" });
    await expect(notebookTab).toBeVisible({ timeout: 10_000 });
    await notebookTab.click();

    // Wait for notebook panel to render
    await page.waitForTimeout(1_000);

    // The reader stays visible beside the notebook in focused mode.
    await expect(chapterText).toBeVisible({ timeout: 15_000 });

    // Programmatically select text inside the epub iframe to trigger epubjs "selected" event
    const iframeHandle = await page.locator("iframe").first().elementHandle();
    if (!iframeHandle) throw new Error("Could not get iframe element handle");
    const iframeFrame = await iframeHandle.contentFrame();
    if (!iframeFrame) throw new Error("Could not get iframe content frame");

    await iframeFrame.evaluate(() => {
      const p = document.querySelector("p");
      if (!p || !p.firstChild) throw new Error("No paragraph found in epub");
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    // Wait for the highlight popover to appear (portaled to document.body)
    const highlightBtn = page.getByRole("button", { name: "Add to Notebook" });
    await expect(highlightBtn).toBeVisible({ timeout: 10_000 });

    // Click "Add to Notebook" to save the highlight
    await highlightBtn.click();

    // Switch to the Notes rail to see the highlight reference.
    await notebookTab.click();

    // Wait for the highlight reference blockquote to appear in the notebook
    const highlightRef = page.locator("blockquote").first();
    await expect(highlightRef).toBeVisible({ timeout: 15_000 });

    // Verify the blockquote contains some highlighted text
    const blockquoteText = await highlightRef.textContent();
    expect(blockquoteText?.length).toBeGreaterThan(0);

    // Test navigate: click the blockquote to navigate to the highlight
    await highlightRef.click();
    // Navigation should focus the reader panel — verify the reader is still showing
    await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
      timeout: 10_000,
    });

    // Test delete: hover the blockquote and click the delete button
    // Re-focus the notebook panel
    await notebookTab.click();

    // Wait for blockquote to be visible again
    const highlightRefAgain = page.locator("blockquote").first();
    await expect(highlightRefAgain).toBeVisible({ timeout: 10_000 });

    // Click the delete button (force: true since it's opacity-hidden until hover)
    const deleteBtn = page.locator('[title="Delete highlight"]').first();
    await deleteBtn.click({ force: true, timeout: 5_000 });

    // Verify the highlight reference blockquote is removed from the notebook
    await expect(page.locator("blockquote")).toHaveCount(0, { timeout: 10_000 });
  });

  test("highlight created with notebook closed appears when notebook opens", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for epub iframe to be ready with content
    const iframe = page.frameLocator("iframe").first();
    const chapterText = iframe.locator("p").first();
    await expect(chapterText).toBeVisible({ timeout: 20_000 });

    // Highlight handlers register after persisted annotations finish loading.
    await page.waitForTimeout(1_000);

    // Do NOT open the notebook first — this is the regression scenario.
    // Select text inside the epub iframe and save a highlight.
    const iframeHandle = await page.locator("iframe").first().elementHandle();
    if (!iframeHandle) throw new Error("Could not get iframe element handle");
    const iframeFrame = await iframeHandle.contentFrame();
    if (!iframeFrame) throw new Error("Could not get iframe content frame");

    await iframeFrame.evaluate(() => {
      const p = document.querySelector("p");
      if (!p || !p.firstChild) throw new Error("No paragraph found in epub");
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const highlightBtn = page.getByRole("button", { name: "Add to Notebook" });
    await expect(highlightBtn).toBeVisible({ timeout: 10_000 });
    await highlightBtn.click();

    // Now open the Notes rail — the highlight reference should already be
    // persisted in IDB via the fallback path, so the blockquote must appear.
    const notebookTab = page.getByRole("tab", { name: "Notes" });
    await expect(notebookTab).toBeVisible({ timeout: 10_000 });
    await notebookTab.click();

    const highlightRef = page.locator("blockquote").first();
    await expect(highlightRef).toBeVisible({ timeout: 15_000 });

    // Exactly one blockquote — no duplicates from a double-write.
    await expect(page.locator("blockquote")).toHaveCount(1);

    // Delete must still work from the fallback-created node.
    const deleteBtn = page.locator('[title="Delete highlight"]').first();
    await deleteBtn.click({ force: true, timeout: 5_000 });
    await expect(page.locator("blockquote")).toHaveCount(0, { timeout: 10_000 });
  });

  test("reader settings menu opens", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for the reader formatting button
    const settingsButton = page.getByRole("button", { name: "Reader menu" });
    await expect(settingsButton.first()).toBeVisible({ timeout: 15_000 });

    // Open settings dropdown
    await settingsButton.first().click();
    await page.getByRole("menuitem", { name: "Formatting" }).hover();

    // Verify layout options are visible
    await expect(page.getByText("Layout")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Single Page")).toBeVisible();
    await expect(page.getByText("Two Page Spread")).toBeVisible();
    await expect(page.getByText("Continuous Scroll")).toBeVisible();
  });
});
