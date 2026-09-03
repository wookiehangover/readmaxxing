import { expect, test } from "@playwright/test";

test("short scroll pages continue across spines and stop before the next logical chapter", async ({
  page,
}) => {
  await page.goto("/demo/?test=1");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const { createNavigator, normalizePublicationPath } = await import(modulePath);
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;inset:0;width:800px;height:600px";
    document.body.append(container);
    const hrefs = ["one.xhtml", "continuation.xhtml", "final.xhtml"].map((href) =>
      normalizePublicationPath(href),
    );
    let endpoints = 0;
    let locked = false;
    const navigator = createNavigator(
      {
        metadata: { title: "Continuation", languages: [], authors: [] },
        readingOrder: hrefs.map((href: string) => ({ href, rel: [], properties: [] })),
        toc: [],
        resources: [],
        landmarks: [],
        diagnostics: [],
      },
      {
        container,
        preferences: { flow: "scrolled" },
        security: {
          resourceProvider: {
            readText: async (href: string) =>
              `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p>${href}</p></body></html>`,
            read: async () => new Uint8Array(),
            has: () => true,
            entries: () => hrefs,
            close() {},
          },
        },
        navigationPolicy: {
          resolve(target: { spineIndex: number }) {
            if (locked && target.spineIndex === 2) return false;
            return { ...target, contentRange: { key: target.spineIndex < 2 ? "first" : "final" } };
          },
          allowCommit(target: { spineIndex: number }) {
            return !locked || target.spineIndex < 2;
          },
          allowMovement() {
            return true;
          },
          boundary(direction: string, current: { spineIndex: number }) {
            if (direction === "next" && current.spineIndex === 1) {
              endpoints++;
              locked = true;
              return false;
            }
            return undefined;
          },
        },
      },
    );
    await navigator.display({ spineIndex: 0 });
    navigator.contentDocument!.defaultView!.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    for (let i = 0; i < 100 && navigator.currentRelocation?.spineIndex !== 1; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const continuation = navigator.currentRelocation?.spineIndex === 1 && endpoints === 0;
    navigator.contentDocument!.defaultView!.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    const stopped = locked && endpoints === 1 && navigator.currentRelocation?.spineIndex === 1;
    await navigator.display({ spineIndex: 2 });
    const blocked = navigator.currentRelocation?.spineIndex === 1;
    navigator.destroy();
    container.remove();
    return { continuation, stopped, blocked };
  });
  expect(result).toEqual({ continuation: true, stopped: true, blocked: true });
});

test("return locators retain UTF-16 offsets and source assertions in XHTML CDATA", async ({
  page,
}) => {
  await page.goto("/demo/?test=1");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/index.ts";
    const { generateCfi, resolveCfi } = await import(modulePath);
    const document = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><p><![CDATA[Alpha 😀 target]]></p></body></html>',
      "application/xhtml+xml",
    );
    const node = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 9);
    range.collapse(true);
    const cfi = generateCfi(range, { spineIndex: 0 });
    const resolved = resolveCfi(cfi, document, { spineIndex: 0 });
    const offset = resolved?.startOffset;
    const sameNode = resolved?.startContainer === node;
    node.nodeValue = "Changed source";
    return { offset, sameNode, replaced: resolveCfi(cfi, document, { spineIndex: 0 }) === null };
  });
  expect(result).toEqual({ offset: 9, sameNode: true, replaced: true });
});

for (const flow of ["scrolled", "single", "double"] as const) {
  test(`content boundaries stop ${flow} before same-spine text and preserve CFI restoration`, async ({
    page,
  }) => {
    await page.goto("/demo/?test=1");
    const result = await page.evaluate(async (mode) => {
      const modulePath = "/src/index.ts";
      const { createNavigator, generateCfi, normalizePublicationPath, resolveCfi } = await import(
        modulePath
      );
      const container = document.createElement("div");
      container.style.cssText =
        "position:fixed;inset:0;width:1000px;height:500px;background:white;z-index:10000";
      document.body.append(container);
      const paragraphs = Array.from(
        { length: 45 },
        (_, i) =>
          `<p id="p${i}">Allowed paragraph ${i}. ${"Readable words and supporting detail. ".repeat(10)}</p>`,
      ).join("");
      const source = `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><section><h1 id="a">First</h1>${paragraphs}<h1 id="b">FORBIDDEN NEXT CHAPTER</h1><p id="later">Later chapter text.</p></section></body></html>`;
      const href = normalizePublicationPath("chapter.xhtml");
      let locked = false;
      let endpoints = 0;
      let savedCfi = "";
      let savedProgression = 0;
      const navigator = createNavigator(
        {
          metadata: { title: "Boundary", languages: [], authors: [] },
          readingOrder: [{ href, rel: [], properties: [] }],
          resources: [],
          toc: [],
          landmarks: [],
          diagnostics: [],
        },
        {
          container,
          preferences: {
            flow: mode === "scrolled" ? "scrolled" : "paginated",
            spread: mode === "double" ? "double" : "single",
            pageTurnAnimation: "none",
          },
          security: {
            resourceProvider: {
              readText: async () => source,
              read: async () => new TextEncoder().encode(source),
              has: () => true,
              entries: () => [href],
              close() {},
            },
          },
          navigationPolicy: {
            resolve(target: { fragment?: string }) {
              return locked && target.fragment === "b"
                ? false
                : {
                    ...target,
                    contentRange:
                      target.fragment === "b" ? { key: "b", start: "b" } : { key: "a", end: "b" },
                  };
            },
            allowCommit(target: { fragment?: string }) {
              return !locked || target.fragment !== "b";
            },
            allowMovement() {
              return true;
            },
            boundary(direction: string) {
              if (direction === "next") {
                endpoints++;
                if (!locked) {
                  const doc = navigator.contentDocument!;
                  const range = doc.createRange();
                  range.selectNodeContents(doc.getElementById("p44")!);
                  range.collapse(true);
                  savedCfi = generateCfi(range, { spineIndex: 0 });
                  savedProgression = navigator.currentRelocation!.localProgression;
                }
                locked = true;
              }
              return false;
            },
          },
        },
      );
      await navigator.display({ spineIndex: 0 });
      const doc = navigator.contentDocument!;
      const hiddenBefore =
        doc.getElementById("b")!.getClientRects().length === 0 &&
        !doc.body.innerText.includes("FORBIDDEN");
      if (mode === "scrolled") {
        const scrolling = doc.scrollingElement ?? doc.documentElement;
        scrolling.scrollTop = scrolling.scrollHeight;
        doc.defaultView!.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        for (let i = 0; i < 100 && !locked; i++) await navigator.next();
      }
      const reached = locked;
      const before = navigator.currentRelocation!.localProgression;
      await navigator.display({ spineIndex: 0, fragment: "b" });
      const blocked =
        navigator.currentRelocation!.localProgression === before &&
        !navigator.contentDocument!.body.innerText.includes("FORBIDDEN");
      await navigator.previous();
      await navigator.display({ spineIndex: 0, cfi: savedCfi, localProgression: savedProgression });
      const restored =
        Math.abs(navigator.currentRelocation!.localProgression - savedProgression) < 0.001;
      const resolved = !!resolveCfi(savedCfi, navigator.contentDocument!, { spineIndex: 0 });
      await navigator.setPreferences({ fontSize: 125, spread: "single" });
      await navigator.display({ spineIndex: 0, cfi: savedCfi });
      const afterReflow =
        navigator.contentDocument!.getElementById("b")!.getClientRects().length === 0;
      // An interactive turn at the final endpoint reaches the same host policy.
      if (mode !== "scrolled") {
        navigator.restoreProgression(1);
        navigator.beginInteractivePageTurn("next");
        await navigator.endInteractivePageTurn(true);
      }
      locked = false;
      await navigator.display({ spineIndex: 0, fragment: "b" });
      const advanced =
        navigator.contentDocument!.body.innerText.includes("FORBIDDEN") &&
        !navigator.contentDocument!.body.innerText.includes("Allowed paragraph");
      navigator.destroy();
      container.remove();
      return {
        hiddenBefore,
        reached,
        blocked,
        restored,
        resolved,
        afterReflow,
        advanced,
        endpoints,
      };
    }, flow);
    expect(result).toMatchObject({
      hiddenBefore: true,
      reached: true,
      blocked: true,
      restored: true,
      resolved: true,
      afterReflow: true,
      advanced: true,
    });
    expect(result.endpoints).toBeGreaterThan(0);
  });
}
