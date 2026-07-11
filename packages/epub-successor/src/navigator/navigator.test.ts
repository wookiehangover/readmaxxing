import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Publication } from "../publication-model/publication-model";
import { normalizePublicationPath, type PublicationPath } from "../publication-model/paths";
import type { ResourceProvider } from "../resource-loader/resource-loader";
import { PREFERENCE_STYLE_ID } from "../content-pipeline/content-pipeline";
import { createNavigator, type Navigator, type NavigatorState, type Relocation } from "./navigator";

const SECTION = (id: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><h1 id="${id}">${id}</h1><script>bad()</script></body></html>`;

class MemoryProvider implements ResourceProvider {
  closeCalls = 0;
  readonly reads: string[] = [];
  delayedPath?: string;

  constructor(readonly resources: Readonly<Record<string, string>>) {}

  has(path: string): boolean {
    return path in this.resources;
  }

  async read(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    this.reads.push(path);
    if (path === this.delayedPath) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        void resolve;
      });
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const resource = this.resources[path];
    if (resource === undefined) throw new Error(`Missing resource: ${path}`);
    return new TextEncoder().encode(resource);
  }

  async readText(path: string, signal?: AbortSignal): Promise<string> {
    return new TextDecoder().decode(await this.read(path, signal));
  }

  entries(): readonly PublicationPath[] {
    return Object.keys(this.resources).map(normalizePublicationPath);
  }

  close(): void {
    this.closeCalls += 1;
  }
}

function publication(): Publication {
  return {
    metadata: { title: "Navigator fixture", languages: ["en"], authors: [] },
    readingOrder: [
      { href: normalizePublicationPath("OPS/one.xhtml"), rel: [], properties: [] },
      { href: normalizePublicationPath("OPS/two.xhtml"), rel: [], properties: [] },
    ],
    resources: [],
    toc: [],
    landmarks: [],
    diagnostics: [],
  };
}

let blobs: Blob[];

beforeEach(() => {
  blobs = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (!(blob instanceof Blob)) throw new TypeError("Expected a Blob");
    blobs.push(blob);
    return `data:application/xhtml+xml,${encodeURIComponent(SECTION("target"))}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(
  provider = new MemoryProvider({
    "OPS/one.xhtml": SECTION("one"),
    "OPS/two.xhtml": SECTION("two"),
  }),
) {
  const container = document.createElement("div");
  document.body.append(container);
  const navigator = createNavigator(publication(), {
    container,
    flow: "scrolled",
    security: { resourceProvider: provider },
    settleTimeoutMs: 100,
  });
  return { container, navigator, provider };
}

async function finishDisplay<T>(container: HTMLElement, display: Promise<T>): Promise<T> {
  await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  const frame = container.querySelector("iframe")!;
  frame.dispatchEvent(new Event("load"));
  return display;
}

async function finishPaginatedDisplay<T>(container: HTMLElement, display: Promise<T>): Promise<T> {
  await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  const frame = container.querySelector("iframe")!;
  Object.defineProperties(frame, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  });
  const content = frame.contentDocument!;
  for (const scrolling of [content.documentElement, content.body]) {
    Object.defineProperties(scrolling, {
      scrollWidth: { configurable: true, value: 2_048 },
      clientWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 600 },
    });
  }
  frame.dispatchEvent(new Event("load"));
  return display;
}

async function displayAt(navigator: Navigator, container: HTMLElement, spineIndex: number) {
  return finishDisplay(container, navigator.display({ spineIndex }));
}

describe("scrolling Navigator", () => {
  it("transitions through loading and settling before emitting a settled relocation", async () => {
    const { container, navigator } = setup();
    const states: NavigatorState[] = [];
    const relocations: Relocation[] = [];
    navigator.addEventListener("statechange", (event) => {
      states.push((event as CustomEvent<NavigatorState>).detail);
    });
    navigator.addEventListener("relocation", (event) => {
      relocations.push((event as CustomEvent<Relocation>).detail);
    });

    const result = await displayAt(navigator, container, 1);

    expect(states).toEqual(["loading", "settling", "settled"]);
    expect(result).toEqual({
      href: normalizePublicationPath("OPS/two.xhtml"),
      spineIndex: 1,
      localProgression: 0,
      totalProgression: 0.5,
    });
    expect(relocations).toEqual([result]);
    navigator.destroy();
  });

  it("cancels an older display deterministically when a newer display starts", async () => {
    const { container, navigator, provider } = setup();
    provider.delayedPath = "OPS/one.xhtml";
    const firstResult = navigator.display({ spineIndex: 0 }).catch((cause: unknown) => cause);
    await vi.waitFor(() => expect(provider.reads).toContain("OPS/one.xhtml"));

    const second = navigator.display({ spineIndex: 1 });
    const relocation = await finishDisplay(container, second);
    const firstCause = await firstResult;

    expect(firstCause).toBeInstanceOf(DOMException);
    expect((firstCause as DOMException).name).toBe("AbortError");
    expect(relocation.spineIndex).toBe(1);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    navigator.destroy();
  });

  it("mounts pipeline output in the scriptless sandbox and scrolls to a fragment", async () => {
    const { container, navigator } = setup();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const display = navigator.display({
      href: normalizePublicationPath("OPS/one.xhtml#target"),
    });
    await finishDisplay(container, display);
    const frame = container.querySelector("iframe")!;
    const serialized = await blobs.at(-1)!.text();

    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(serialized).toContain("Content-Security-Policy");
    expect(serialized).not.toContain("<script");
    expect(scrollIntoView).toHaveBeenCalledOnce();
    navigator.destroy();
  });

  it("moves to adjacent spine sections and reports boundaries", async () => {
    const { container, navigator } = setup();
    await displayAt(navigator, container, 0);

    const next = navigator.next();
    expect(await finishDisplay(container, next)).toBe(true);
    expect(await navigator.next()).toBe(false);
    const previous = navigator.previous();
    expect(await finishDisplay(container, previous)).toBe(true);
    expect(await navigator.previous()).toBe(false);
    navigator.destroy();
  });

  it("destroys frames and URL ownership idempotently without closing the provider", async () => {
    const { container, navigator, provider } = setup();
    await displayAt(navigator, container, 0);

    navigator.destroy();
    navigator.destroy();
    await Promise.resolve();

    expect(container.querySelector("iframe")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    expect(provider.closeCalls).toBe(0);
    await expect(navigator.display({ spineIndex: 0 })).rejects.toThrow("Navigator is destroyed");
  });

  it("redisplays the same spine in place without remounting the iframe", async () => {
    const { container, navigator, provider } = setup();
    await displayAt(navigator, container, 0);
    const frame = container.querySelector("iframe");
    const readsBefore = provider.reads.length;

    const relocation = await navigator.display({ spineIndex: 0 });

    expect(relocation.spineIndex).toBe(0);
    expect(container.querySelector("iframe")).toBe(frame);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    // No new section resource read / blob for an in-place redisplay.
    expect(provider.reads.length).toBe(readsBefore);
    expect(blobs).toHaveLength(1);
    navigator.destroy();
  });
});

describe("paginated Navigator", () => {
  it("applies spread layout and preferences without replacing the section", async () => {
    const provider = new MemoryProvider({
      "OPS/one.xhtml": SECTION("one"),
      "OPS/two.xhtml": SECTION("two"),
    });
    const container = document.createElement("div");
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    document.body.append(container);
    const navigator = createNavigator(publication(), {
      container,
      flow: "paginated",
      preferences: { spread: "double" },
      security: { resourceProvider: provider },
      settleTimeoutMs: 100,
    });

    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }));
    const frame = container.querySelector("iframe")!;
    expect(
      frame.contentDocument!.getElementById("epub-successor-pagination-style")?.textContent,
    ).toContain("column-width:384px");

    await navigator.setPreferences({
      fontFamily: "Literata",
      fontSize: 110,
      lineHeight: 1.7,
      margins: 24,
      theme: "sepia",
      spread: "single",
    });

    expect(container.querySelector("iframe")).toBe(frame);
    const preferenceCss = frame.contentDocument!.getElementById(PREFERENCE_STYLE_ID)?.textContent;
    expect(preferenceCss).toContain('font-family:"Literata"');
    expect(preferenceCss).toContain("font-size:110%");
    expect(preferenceCss).toContain("background:#f4ecd8");
    expect(
      frame.contentDocument!.getElementById("epub-successor-pagination-style")?.textContent,
    ).toContain("column-width:800px");
    navigator.destroy();
  });
});
