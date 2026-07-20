import { expect, test, type Page } from "@playwright/test";

async function openDemo(page: Page, query = "test=1") {
  await page.goto(`/demo/?${query}`);
  await expect.poll(() => page.evaluate(() => window.__epubDemo.snapshot().state)).toBe("settled");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect.poll(() => page.evaluate(() => window.__epubDemo.snapshot().state)).toBe("settled");
  return page.evaluate(() => window.__epubDemo.snapshot());
}

test("loads fixture content, reports scrolling relocations, and navigates fragments", async ({
  page,
}) => {
  const initial = await openDemo(page, "test=1&stress=1&fixture=minimal-epub3.epub");

  expect(initial.sandbox).toBe("allow-same-origin allow-scripts");
  expect(initial.iframeSrc).toMatch(/^blob:/);
  expect(initial.text).toContain("Fixture");
  expect(initial.visibleAnchors[0]).toContain("Fixture");
  expect(initial.visibleAnchors.at(-1)).toBeTruthy();
  expect(initial.relocation).toMatchObject({
    spineIndex: 0,
    localProgression: 0,
    totalProgression: 0,
  });

  const emitted = await page.evaluate(() => window.__epubDemo.scrollBurst([0.2, 0.45, 0.75]));
  expect(emitted).toBe(1);
  const scrolled = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(scrolled.relocation?.localProgression).toBeGreaterThan(0.65);
  expect(scrolled.relocation?.localProgression).toBeLessThanOrEqual(1);
  expect(scrolled.relocation?.totalProgression).toBe(scrolled.relocation?.localProgression);

  await page.evaluate(() => window.__epubDemo.displayFragment("stress-050"));
  const fragment = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(fragment.visibleAnchors).toContain("stress-050");
  expect(fragment.relocation?.href).toBe("EPUB/text/chapter.xhtml");
});

test("renders the Pretext error report only behind its opt-in flag", async ({ page }) => {
  await openDemo(page);
  await expect(page.locator("#pretext-report")).toBeHidden();

  await openDemo(page, "test=1&pretext=1&fixture=minimal-epub3.epub");
  const report = page.locator("#pretext-report");
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute("data-state", "measured");
  await expect(report.locator("tbody tr")).not.toHaveCount(0);
});

test("enforces sandbox and CSP against malicious fixtures without egress", async ({ page }) => {
  const externalResponses: string[] = [];
  const dialogs: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("example.invalid")) externalResponses.push(response.url());
  });
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await openDemo(page, "test=1&securityProbe=1&fixture=script-content.epub");
  const originalUrl = page.url();

  const before = await page.evaluate(() => window.__epubDemo.securitySnapshot());
  expect(before).toMatchObject({
    scripts: 0,
    handlers: 0,
    dangerousUrls: 0,
    refreshes: 0,
    foreignObjects: 0,
    formAction: null,
    submitFormAction: null,
    topTarget: null,
    scriptRan: false,
    handlerRan: false,
    javascriptRan: false,
    svgRan: false,
  });
  expect(before.csp).toContain("script-src 'none'");
  expect(before.csp).toContain("connect-src 'none'");
  expect(before.csp).toContain("font-src blob: 'self'");
  expect(before.csp).toContain("form-action 'none'");

  await page.evaluate(() => window.__epubDemo.exerciseSecurity());
  expect(await page.evaluate(() => window.__epubDemo.securitySnapshot())).toMatchObject({
    scriptRan: false,
    handlerRan: false,
    javascriptRan: false,
    svgRan: false,
    topHref: originalUrl,
  });
  await page.evaluate(() => window.__epubDemo.load("external-references.epub"));
  await page.evaluate(() => window.__epubDemo.load("meta-refresh.epub"));
  expect((await page.evaluate(() => window.__epubDemo.securitySnapshot())).refreshes).toBe(0);
  expect(page.url()).toBe(originalUrl);
  expect(dialogs).toEqual([]);
  expect(externalResponses).toEqual([]);
});

test("loads real blob images and fonts, settles frames, resettles resize, and revokes URLs", async ({
  page,
}) => {
  await openDemo(page, "test=1&fixture=images.epub");
  const images = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(images.images).toHaveLength(1);
  expect(images.images[0]).toMatchObject({ complete: true, naturalWidth: 1 });
  expect(images.images[0]?.src).toMatch(/^blob:/);
  expect(images.settleRafCycles).toBeGreaterThanOrEqual(1);
  const oldUrls = [images.images[0]?.src, images.iframeSrc].filter(
    (url): url is string => url !== undefined,
  );

  await page.evaluate(() => window.__epubDemo.load("embedded-font.epub"));
  const font = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(font.fontsStatus).toBe("loaded");
  expect(font.text).toContain("Embedded font");
  const lifecycle = await page.evaluate(() => window.__epubDemo.lifecycle());
  expect(oldUrls).toHaveLength(2);
  expect(oldUrls.every((url) => lifecycle.revoked.includes(url))).toBe(true);

  const cycles = font.settleRafCycles;
  const anchor = font.visibleAnchors[0];
  await page.evaluate(() => window.__epubDemo.setReaderWidth(560));
  await expect
    .poll(() => page.evaluate(() => window.__epubDemo.snapshot().settleRafCycles))
    .toBeGreaterThan(cycles);
  expect((await page.evaluate(() => window.__epubDemo.snapshot())).visibleAnchors[0]).toBe(anchor);
});

for (const { direction, fixture, position } of [
  { direction: "ltr", fixture: "images.epub", position: /^(?:left|0%)$/ },
  { direction: "rtl", fixture: "rtl.epub", position: /^(?:right|100%)$/ },
] as const) {
  test(`aligns contained images with the ${direction} text edge in paginated flow`, async ({
    page,
  }) => {
    await openDemo(page, `test=1&flow=paginated&fixture=${fixture}`);

    const alignment = await page.evaluate((expectedDirection) => {
      const frame = document.querySelector<HTMLIFrameElement>("iframe");
      const doc = frame?.contentDocument;
      const image = doc?.querySelector<HTMLImageElement>('img[alt="pixel"]');
      const text = doc?.querySelector<HTMLElement>("#text-edge");
      const container = doc?.querySelector<HTMLElement>("#image-container");
      const view = doc?.defaultView;
      if (!image || !text || !container || !view) throw new Error("Image fixture did not render");

      const imageRect = image.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const bodyStyle = view.getComputedStyle(doc.body);
      return {
        imageEdge: expectedDirection === "rtl" ? imageRect.right : imageRect.left,
        textEdge: expectedDirection === "rtl" ? textRect.right : textRect.left,
        imageLeft: imageRect.left,
        imageRight: imageRect.right,
        containerLeft: containerRect.left,
        containerRight: containerRect.right,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        columnStride:
          Number.parseFloat(bodyStyle.columnWidth) + Number.parseFloat(bodyStyle.columnGap),
        objectPosition: view.getComputedStyle(image).objectPosition,
      };
    }, direction);

    // Publisher margins narrow the containing block below the column width.
    // The image must stay within both edges rather than spilling into the gutter.
    expect(alignment.imageWidth).toBeGreaterThan(alignment.imageHeight);
    expect(alignment.imageLeft).toBeGreaterThanOrEqual(alignment.containerLeft - 0.5);
    expect(alignment.imageRight).toBeLessThanOrEqual(alignment.containerRight + 0.5);
    const columnDelta = (alignment.imageEdge - alignment.textEdge) / alignment.columnStride;
    expect(columnDelta).toBeCloseTo(Math.round(columnDelta), 1);
    expect(alignment.objectPosition.split(/\s+/)[0]).toMatch(position);
  });
}

test("cancels a display during browser settling and retains one current frame", async ({
  page,
}) => {
  await openDemo(page, "test=1&stress=1&flow=paginated&fixture=duplicate-spine.epub");
  const result = await page.evaluate(() => window.__epubDemo.cancelDuringSettle());

  expect(result.first).toBe("AbortError");
  expect(result.second.spineIndex).toBe(1);
  expect(result.frames).toBe(1);
  expect((await page.evaluate(() => window.__epubDemo.snapshot())).state).toBe("settled");
});

test("uses real CSS columns across pages, spreads, and duplicate spine boundaries", async ({
  page,
}) => {
  const initial = await openDemo(
    page,
    "test=1&stress=1&flow=paginated&fixture=duplicate-spine.epub",
  );
  expect(initial.pageCount).toBeGreaterThan(2);
  expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
  expect(initial.pageStyle).toContain("column-width:");
  const initialAnchor = initial.visibleAnchors[0];

  const traversal = await page.evaluate(async () => {
    let nextCount = 0;
    while (nextCount < 100 && (await window.__epubDemo.next())) nextCount += 1;
    const end = window.__epubDemo.snapshot();
    let previousCount = 0;
    while (previousCount < nextCount && (await window.__epubDemo.previous())) previousCount += 1;
    return { nextCount, previousCount, end, returned: window.__epubDemo.snapshot() };
  });
  expect(traversal.nextCount).toBeGreaterThan(initial.pageCount);
  expect(traversal.nextCount).toBeLessThan(100);
  expect(traversal.previousCount).toBe(traversal.nextCount);
  expect(traversal.end.relocation?.spineIndex).toBe(1);
  expect(traversal.returned.relocation?.spineIndex).toBe(0);
  expect(traversal.returned.visibleAnchors[0]).toBe(initialAnchor);

  await page.evaluate(() => window.__epubDemo.setPreferences({ spread: "double" }));
  const spread = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(spread.pageStyle).toMatch(/column-width:[1-9][0-9]*px/);
  expect(spread.pageCount).toBeGreaterThan(initial.pageCount);
});

test("advances RTL pages logically and returns to the same anchor", async ({ page }) => {
  const initial = await openDemo(page, "test=1&stress=1&flow=paginated&fixture=rtl.epub");
  const anchor = initial.visibleAnchors[0];
  expect(initial.direction).toBe("rtl");
  expect(initial.pageCount).toBeGreaterThan(1);

  expect(await page.evaluate(() => window.__epubDemo.next())).toBe(true);
  const next = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(next.relocation?.localProgression).toBeGreaterThan(0);
  expect(next.visibleAnchors[0]).not.toBe(anchor);
  expect(await page.evaluate(() => window.__epubDemo.previous())).toBe(true);
  expect((await page.evaluate(() => window.__epubDemo.snapshot())).visibleAnchors[0]).toBe(anchor);
});

test("preserves the visible anchor across preferences, flow, spread, and resize", async ({
  page,
}) => {
  await openDemo(page, "test=1&stress=1&flow=paginated&fixture=minimal-epub3.epub");
  await page.evaluate(async () => {
    await window.__epubDemo.next();
    await window.__epubDemo.next();
  });
  const anchor = (await page.evaluate(() => window.__epubDemo.snapshot())).visibleAnchors[0];

  for (const preferences of [
    { fontSize: 145, lineHeight: 1.9, theme: "sepia" as const },
    { spread: "double" as const },
    { flow: "scrolled" as const },
  ]) {
    await page.evaluate((update) => window.__epubDemo.setPreferences(update), preferences);
    expect((await page.evaluate(() => window.__epubDemo.snapshot())).visibleAnchors).toContain(
      anchor,
    );
  }
  const beforeResize = await page.evaluate(() => window.__epubDemo.snapshot());
  await page.evaluate(() => window.__epubDemo.setReaderWidth(620));
  await expect
    .poll(() => page.evaluate(() => window.__epubDemo.snapshot().settleRafCycles))
    .toBeGreaterThan(beforeResize.settleRafCycles);
  await expect.poll(() => page.evaluate(() => window.__epubDemo.snapshot().state)).toBe("settled");
  expect((await page.evaluate(() => window.__epubDemo.snapshot())).visibleAnchors).toContain(
    anchor,
  );
});

test("renders native highlights when available and overlay geometry with resize hit testing", async ({
  page,
  browserName,
}) => {
  await openDemo(page, "test=1&fixture=minimal-epub3.epub");
  expect(await page.evaluate(() => window.__epubDemo.selectText("Fixture"))).toBe(true);
  expect(await page.evaluate(() => window.__epubDemo.addHighlight())).toBe(true);
  const automatic = await page.evaluate(() => window.__epubDemo.snapshot());
  if (automatic.decorationMode === "native") expect(automatic.nativeHighlightRules).toBe(1);
  else expect(automatic.overlayRects.length).toBeGreaterThan(0);
  if (browserName === "chromium") expect(automatic.decorationMode).toBe("native");

  await page.goto("/demo/?test=1&overlay=1&fixture=minimal-epub3.epub");
  await expect.poll(() => page.evaluate(() => window.__epubDemo.snapshot().state)).toBe("settled");
  await page.evaluate(() => window.__epubDemo.selectText("Fixture"));
  await page.evaluate(() => window.__epubDemo.addHighlight());
  const before = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(before.decorationMode).toBe("overlay");
  expect(before.overlayRects.length).toBeGreaterThan(0);
  expect(before.overlayRects[0]?.width).toBeGreaterThan(0);

  await page.evaluate(() => window.__epubDemo.setPreferences({ fontSize: 180 }));
  const after = await page.evaluate(() => window.__epubDemo.snapshot());
  expect(after.overlayRects.length).toBeGreaterThan(0);
  expect(after.overlayRects[0]?.width).not.toBe(before.overlayRects[0]?.width);
  expect(await page.evaluate(() => window.__epubDemo.clickHighlight())).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__epubDemo.snapshot().decorationClicks))
    .toBe(1);
});
