import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Publication } from "../publication-model/publication-model";
import { normalizePublicationPath, type PublicationPath } from "../publication-model/paths";
import type { ResourceProvider } from "../resource-loader/resource-loader";
import { INTERNAL_LINK_ATTRIBUTE } from "../resource-loader/urls";
import { PREFERENCE_STYLE_ID } from "../content-pipeline/content-pipeline";
import {
  createNavigator,
  type Navigator,
  type NavigatorPreferences,
  type NavigatorState,
  type Relocation,
} from "./navigator";

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(
  provider = new MemoryProvider({
    "OPS/one.xhtml": SECTION("one"),
    "OPS/two.xhtml": SECTION("two"),
  }),
  preferences: NavigatorPreferences = {},
  direction?: "ltr" | "rtl",
) {
  const container = document.createElement("div");
  document.body.append(container);
  const fixture = publication();
  const navigator = createNavigator(
    {
      ...fixture,
      metadata: { ...fixture.metadata, pageProgressionDirection: direction },
    },
    {
      container,
      flow: "scrolled",
      preferences,
      security: { resourceProvider: provider },
      settleTimeoutMs: 100,
    },
  );
  return { container, navigator, provider };
}

async function waitForFrameCount(container: HTMLElement, count: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (container.querySelectorAll("iframe").length === count) return;
    await Promise.resolve();
  }
  expect(container.querySelectorAll("iframe")).toHaveLength(count);
}

async function finishDisplay<T>(container: HTMLElement, display: Promise<T>): Promise<T> {
  const existing = container.querySelector("iframe");
  if (existing) await waitForFrameCount(container, 2);
  else await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  const frame = Array.from(container.querySelectorAll("iframe")).at(-1)!;
  frame.dispatchEvent(new Event("load"));
  return display;
}

async function finishPaginatedDisplay<T>(
  container: HTMLElement,
  display: Promise<T>,
  navigator?: Navigator,
): Promise<T> {
  await vi.waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
  const frame = container.querySelector("iframe")!;
  configurePaginatedFrame(frame);
  frame.dispatchEvent(new Event("load"));
  const result = await display;
  if (navigator) await navigator.setPreferences({});
  return result;
}

function configurePaginatedFrame(frame: HTMLIFrameElement): void {
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
}

async function displayAt(navigator: Navigator, container: HTMLElement, spineIndex: number) {
  return finishDisplay(container, navigator.display({ spineIndex }));
}

function setupPaginated(preferences: NavigatorPreferences = {}, direction?: "ltr" | "rtl") {
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
  const fixture = publication();
  const navigator = createNavigator(
    {
      ...fixture,
      metadata: { ...fixture.metadata, pageProgressionDirection: direction },
    },
    {
      container,
      flow: "paginated",
      preferences: { spread: "single", ...preferences },
      security: { resourceProvider: provider },
      settleTimeoutMs: 100,
    },
  );
  return { container, navigator, provider };
}

function mockFrameAnimationFrames(frame: HTMLIFrameElement) {
  const scrolling =
    frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
  const views = new Set([
    frame.contentWindow!,
    scrolling.ownerDocument.defaultView!,
    frame.ownerDocument.defaultView!,
  ]);
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const cancel = vi.fn((id: number) => void callbacks.delete(id));
  for (const view of views) {
    vi.spyOn(view, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.spyOn(view, "cancelAnimationFrame").mockImplementation(cancel);
  }
  return {
    cancel,
    async waitForPending() {
      await vi.waitFor(() => expect(callbacks.size).toBeGreaterThan(0));
    },
    runNext(timestamp: number) {
      const entry = callbacks.entries().next();
      if (entry.done) throw new Error("No animation frame is pending");
      const [id, callback] = entry.value;
      callbacks.delete(id);
      callback(timestamp);
    },
  };
}

function suppressAutomaticFrameLoads(): (frame: HTMLIFrameElement) => void {
  const dispatchEvent = HTMLIFrameElement.prototype.dispatchEvent;
  let manual = false;
  vi.spyOn(HTMLIFrameElement.prototype, "dispatchEvent").mockImplementation(
    function (this: HTMLIFrameElement, event) {
      if (event.type === "load" && !manual) return true;
      return dispatchEvent.call(this, event);
    },
  );
  return (frame) => {
    manual = true;
    frame.dispatchEvent(new Event("load"));
    manual = false;
  };
}

async function startPartialTurn(
  navigator: Navigator,
  frames: ReturnType<typeof mockFrameAnimationFrames>,
) {
  const turn = navigator.next();
  await frames.waitForPending();
  frames.runNext(0);
  frames.runNext(100);
  return { turn };
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

    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts");
    expect(serialized).toContain("Content-Security-Policy");
    expect(serialized).not.toContain("<script");
    expect(scrollIntoView).toHaveBeenCalledOnce();
    navigator.destroy();
  });

  it("routes same-section and cross-spine internal link clicks through display", async () => {
    const { container, navigator } = setup();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    await displayAt(navigator, container, 0);
    const firstFrame = container.querySelector("iframe")!;
    const firstDocument = firstFrame.contentDocument!;
    const link = firstDocument.createElement("a");
    firstDocument.body.append(link);

    link.setAttribute(INTERNAL_LINK_ATTRIBUTE, "OPS/one.xhtml#target");
    const sameSectionClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(sameSectionClick);
    expect(sameSectionClick.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(navigator.state).toBe("settled"));
    expect(container.querySelector("iframe")).toBe(firstFrame);
    expect(scrollIntoView).toHaveBeenCalledOnce();

    link.setAttribute(INTERNAL_LINK_ATTRIBUTE, "OPS/two.xhtml#target");
    const crossSpineClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(crossSpineClick);
    expect(crossSpineClick.defaultPrevented).toBe(true);
    await waitForFrameCount(container, 2);
    container.querySelectorAll("iframe")[1]!.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(navigator.currentRelocation?.spineIndex).toBe(1));
    expect(navigator.contentDocument?.getElementById("target")).not.toBeNull();
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

  it("retains the outgoing frame and its viewport width until the incoming section settles", async () => {
    const { container, navigator } = setup(undefined, { pageTurnAnimation: "slide" });
    await displayAt(navigator, container, 0);
    const outgoing = container.querySelector("iframe")!;
    Object.defineProperties(outgoing, {
      clientWidth: { configurable: true, value: 483 },
      clientHeight: { configurable: true, value: 493 },
    });
    const oldDocument = navigator.contentDocument;
    const load = suppressAutomaticFrameLoads();
    const turn = navigator.next();
    await waitForFrameCount(container, 2);
    const incoming = container.querySelectorAll("iframe")[1]!;
    await vi.waitFor(() => expect(incoming.contentDocument?.querySelector("h1")).not.toBeNull());

    expect(navigator.contentDocument).toBe(oldDocument);
    expect(incoming.style.minWidth).toBe("483px");
    expect(incoming.style.maxWidth).toBe("483px");
    load(incoming);
    await expect(turn).resolves.toBe(true);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")).toBe(incoming);
    expect(incoming.style.transform).toBe("");
    expect(incoming.style.transition).toBe("");
    expect(incoming.style.minWidth).toBe("");
    expect(incoming.style.maxWidth).toBe("");
    navigator.destroy();
  });

  it("keeps the settled frame and disposes the incoming frame after load failure", async () => {
    const { container, navigator } = setup();
    await displayAt(navigator, container, 0);
    const outgoing = container.querySelector("iframe")!;
    const oldDocument = navigator.contentDocument;
    const display = navigator.display({ spineIndex: 1 });
    await waitForFrameCount(container, 2);
    container.querySelectorAll("iframe")[1]!.dispatchEvent(new Event("error"));

    await expect(display).rejects.toThrow("iframe failed to load");
    await Promise.resolve();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")).toBe(outgoing);
    expect(navigator.contentDocument).toBe(oldDocument);
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    navigator.destroy();
  });

  it("disposes both frames and leases when an incoming display is aborted by destroy", async () => {
    const { container, navigator } = setup();
    await displayAt(navigator, container, 0);
    const display = navigator.display({ spineIndex: 1 });
    await waitForFrameCount(container, 2);

    navigator.destroy();

    await expect(display).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(container.querySelectorAll("iframe")).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
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

    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const doubleCss =
      frame.contentDocument!.getElementById("epub-successor-pagination-style")?.textContent ?? "";
    // Full-width columns, 64px spread gap, vertical body padding only.
    expect(doubleCss).toContain("column-width:368px");
    expect(doubleCss).toContain("column-gap:64px");
    expect(doubleCss).toContain("padding:24px 0");
    expect(doubleCss).toContain("blockquote:has(img)");
    expect(doubleCss).toContain("inline-size:auto");
    expect(doubleCss).toContain("blockquote:has(> img:only-child){text-indent:0");
    expect(doubleCss).toContain("max-width:min(100%,368px)");
    expect(doubleCss).toContain("max-height:552px");
    expect(doubleCss).toContain("object-position:left center");

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
    // Pagination chrome keeps horizontal padding at 0 (margins preference ignored for sides).
    const singleCss =
      frame.contentDocument!.getElementById("epub-successor-pagination-style")?.textContent ?? "";
    expect(singleCss).toContain("column-width:800px");
    expect(singleCss).toContain("padding:24px 0");
    expect(singleCss).toContain("max-width:min(100%,800px)");
    navigator.destroy();
  });

  it("positions a previous section at its last spread before revealing it", async () => {
    const { container, navigator } = setupPaginated({
      pageTurnAnimation: "slide",
      pageTurnDurationMs: 250,
    });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 1 }), navigator);
    const load = suppressAutomaticFrameLoads();
    const previous = navigator.previous();
    await waitForFrameCount(container, 2);
    const incoming = container.querySelectorAll("iframe")[1]!;
    await vi.waitFor(() => expect(incoming.contentDocument?.querySelector("h1")).not.toBeNull());
    load(incoming);
    Object.defineProperties(incoming, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    for (const element of [
      incoming.contentDocument!.documentElement,
      incoming.contentDocument!.body,
    ]) {
      Object.defineProperties(element, {
        scrollWidth: { configurable: true, value: 2_048 },
        clientWidth: { configurable: true, value: 800 },
        scrollHeight: { configurable: true, value: 600 },
        clientHeight: { configurable: true, value: 600 },
      });
    }
    await expect(previous).resolves.toBe(true);
    const scrolling =
      incoming.contentDocument!.scrollingElement ?? incoming.contentDocument!.documentElement;

    expect(scrolling.scrollLeft).toBe(1_248);
    navigator.destroy();
  });

  it("emits one relocation after an animated page turn", async () => {
    const { container, navigator } = setupPaginated({
      pageTurnAnimation: "slide",
      pageTurnDurationMs: 250,
    });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const frames = mockFrameAnimationFrames(frame);
    const relocations: Relocation[] = [];
    navigator.addEventListener("relocation", (event) => {
      relocations.push((event as CustomEvent<Relocation>).detail);
    });

    const turn = navigator.next();
    await frames.waitForPending();
    frames.runNext(0);
    frame.contentWindow!.dispatchEvent(new Event("scroll"));
    frames.runNext(125);
    frame.contentWindow!.dispatchEvent(new Event("scroll"));
    frames.runNext(250);
    await frames.waitForPending();
    frames.runNext(266);

    await expect(turn).resolves.toBe(true);
    expect(relocations).toHaveLength(1);
    expect(relocations[0]?.localProgression).toBe(0.5);
    navigator.destroy();
  });

  it("tracks an interactive turn and emits one relocation after committing", async () => {
    const { container, navigator } = setupPaginated({
      pageTurnAnimation: "slide",
      pageTurnDurationMs: 250,
    });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);
    const relocations: Relocation[] = [];
    navigator.addEventListener("relocation", (event) => {
      relocations.push((event as CustomEvent<Relocation>).detail);
    });

    expect(navigator.beginInteractivePageTurn("next")).toBe(true);
    expect(navigator.updateInteractivePageTurn(-300)).toBe(true);
    expect(scrolling.scrollLeft).toBe(300);
    expect(relocations).toHaveLength(0);

    const release = navigator.endInteractivePageTurn(true);
    await frames.waitForPending();
    frames.runNext(0);
    frames.runNext(200);
    await frames.waitForPending();
    frames.runNext(216);

    await expect(release).resolves.toBe(true);
    expect(scrolling.scrollLeft).toBe(864);
    expect(relocations).toHaveLength(1);
    expect(relocations[0]?.localProgression).toBe(0.5);
    navigator.destroy();
  });

  it("settles an interactive cancellation back without emitting a relocation", async () => {
    const { container, navigator } = setupPaginated({
      pageTurnAnimation: "slide",
      pageTurnDurationMs: 250,
    });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);
    const relocation = vi.fn();
    navigator.addEventListener("relocation", relocation);

    expect(navigator.beginInteractivePageTurn("next")).toBe(true);
    navigator.updateInteractivePageTurn(-300);
    expect(scrolling.scrollLeft).toBe(300);

    const cancellation = navigator.cancelInteractivePageTurn();
    await frames.waitForPending();
    frames.runNext(0);
    frames.runNext(100);
    frame.contentWindow!.dispatchEvent(new Event("scroll"));
    await frames.waitForPending();
    frames.runNext(116);

    await expect(cancellation).resolves.toBe(false);
    expect(scrolling.scrollLeft).toBe(0);
    expect(relocation).not.toHaveBeenCalled();
    navigator.destroy();
  });

  it("keeps direct tracking but skips interactive settling with reduced motion", async () => {
    const { container, navigator } = setupPaginated({
      pageTurnAnimation: "slide",
      pageTurnDurationMs: 250,
    });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    vi.spyOn(container.ownerDocument.defaultView!, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);

    expect(navigator.beginInteractivePageTurn("next")).toBe(true);
    navigator.updateInteractivePageTurn(-300);
    expect(scrolling.scrollLeft).toBe(300);

    const release = navigator.endInteractivePageTurn(true);
    expect(scrolling.scrollLeft).toBe(864);
    await frames.waitForPending();
    frames.runNext(0);

    await expect(release).resolves.toBe(true);
    navigator.destroy();
  });

  it("does not prepare or move an adjacent spine before a committed release", async () => {
    const { container, navigator, provider } = setupPaginated();
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    navigator.restoreProgression(1);
    const outgoing = container.querySelector("iframe")!;
    const relocation = vi.fn();
    navigator.addEventListener("relocation", relocation);
    provider.reads.length = 0;

    expect(navigator.beginInteractivePageTurn("next")).toBe(true);
    expect(navigator.updateInteractivePageTurn(-300)).toBe(true);
    expect(provider.reads).toEqual([]);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(outgoing.style.transform).toBe("");
    expect(outgoing.style.transition).toBe("");

    await expect(navigator.cancelInteractivePageTurn()).resolves.toBe(false);
    expect(provider.reads).toEqual([]);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(navigator.currentRelocation?.spineIndex).toBe(0);
    expect(relocation).not.toHaveBeenCalled();
    navigator.destroy();
  });

  it("atomically displays a committed next spine at rest in RTL progression", async () => {
    const { container, navigator, provider } = setupPaginated(
      { pageTurnAnimation: "slide", pageTurnDurationMs: 250 },
      "rtl",
    );
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    navigator.restoreProgression(1);
    const outgoing = container.querySelector("iframe")!;
    const relocation = vi.fn();
    navigator.addEventListener("relocation", relocation);
    provider.reads.length = 0;

    const load = suppressAutomaticFrameLoads();
    expect(navigator.beginInteractivePageTurn("next")).toBe(true);
    navigator.updateInteractivePageTurn(-300);
    expect(provider.reads).toEqual([]);
    expect(outgoing.style.transform).toBe("");

    const release = navigator.endInteractivePageTurn(true);
    await vi.waitFor(() => expect(provider.reads).toEqual(["OPS/two.xhtml"]));
    await waitForFrameCount(container, 2);
    const incoming = Array.from(container.querySelectorAll("iframe")).at(-1)!;
    await vi.waitFor(() => expect(incoming.contentDocument?.querySelector("h1")).not.toBeNull());
    configurePaginatedFrame(incoming);

    expect(incoming.style.visibility).toBe("hidden");
    expect(incoming.style.transform).toBe("");
    expect(incoming.style.transition).toBe("");
    expect(outgoing.style.transform).toBe("");

    load(incoming);
    await expect(release).resolves.toBe(true);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")).toBe(incoming);
    expect(incoming.style.visibility).toBe("");
    expect(incoming.style.transform).toBe("");
    expect(incoming.style.transition).toBe("");
    expect(navigator.currentRelocation?.spineIndex).toBe(1);
    expect(relocation).toHaveBeenCalledOnce();
    expect(outgoing.isConnected).toBe(false);
    navigator.destroy();
  });

  it("uses the atomic display path and last spread for a committed previous spine", async () => {
    const { container, navigator, provider } = setupPaginated();
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 1 }), navigator);
    const outgoing = container.querySelector("iframe")!;
    const relocation = vi.fn();
    navigator.addEventListener("relocation", relocation);
    provider.reads.length = 0;

    const load = suppressAutomaticFrameLoads();
    expect(navigator.beginInteractivePageTurn("previous")).toBe(true);
    navigator.updateInteractivePageTurn(300);
    expect(provider.reads).toEqual([]);
    expect(outgoing.style.transform).toBe("");

    const release = navigator.endInteractivePageTurn(true);
    await waitForFrameCount(container, 2);
    const incoming = Array.from(container.querySelectorAll("iframe")).at(-1)!;
    await vi.waitFor(() => expect(incoming.contentDocument?.querySelector("h1")).not.toBeNull());
    configurePaginatedFrame(incoming);
    load(incoming);

    await expect(release).resolves.toBe(true);
    const incomingScrolling =
      incoming.contentDocument!.scrollingElement ?? incoming.contentDocument!.documentElement;
    expect(provider.reads).toEqual(["OPS/one.xhtml"]);
    expect(incomingScrolling.scrollLeft).toBe(1_248);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(incoming.style.transform).toBe("");
    expect(navigator.currentRelocation?.spineIndex).toBe(0);
    expect(relocation).toHaveBeenCalledOnce();
    navigator.destroy();
  });

  it("applies resistance at a publication edge and cannot commit it", async () => {
    const { container, navigator } = setupPaginated();
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;

    expect(navigator.beginInteractivePageTurn("previous")).toBe(true);
    expect(navigator.updateInteractivePageTurn(200)).toBe(true);
    expect(frame.style.transform).toBe("translate3d(40px, 0, 0)");
    await expect(navigator.endInteractivePageTurn(true)).resolves.toBe(false);
    expect(scrolling.scrollLeft).toBe(0);
    expect(frame.style.transform).toBe("");
    expect(navigator.currentRelocation?.spineIndex).toBe(0);
    navigator.destroy();
  });

  it("snaps an interrupted turn before calculating the next target", async () => {
    const { container, navigator } = setupPaginated({
      pageTurnAnimation: "slide",
      pageTurnDurationMs: 250,
    });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);

    const first = navigator.next();
    await frames.waitForPending();
    frames.runNext(0);
    frames.runNext(100);
    expect(scrolling.scrollLeft).toBeGreaterThan(0);
    expect(scrolling.scrollLeft).toBeLessThan(864);

    const second = navigator.next();
    await frames.waitForPending();
    expect(scrolling.scrollLeft).toBe(864);
    frames.runNext(100);
    frames.runNext(350);
    await frames.waitForPending();
    frames.runNext(366);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(scrolling.scrollLeft).toBe(1_248);
    navigator.destroy();
  });

  it.each([
    { name: "the animation preference is unset", preferences: {}, reducedMotion: false },
    {
      name: "reduced motion is requested",
      preferences: { pageTurnAnimation: "slide" as const, pageTurnDurationMs: 250 },
      reducedMotion: true,
    },
  ])("turns instantly when $name", async ({ preferences, reducedMotion }) => {
    const { container, navigator } = setupPaginated(preferences);
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    if (reducedMotion) {
      vi.spyOn(container.ownerDocument.defaultView!, "matchMedia").mockReturnValue({
        matches: true,
      } as MediaQueryList);
    }
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);

    const turn = navigator.next();

    await frames.waitForPending();
    expect(scrolling.scrollLeft).toBe(864);
    frames.runNext(0);
    await expect(turn).resolves.toBe(true);
    navigator.destroy();
  });

  it.each([
    ["display", (navigator: Navigator) => navigator.display({ spineIndex: 1 })],
    ["setPreferences", (navigator: Navigator) => navigator.setPreferences({ fontSize: 110 })],
  ] as const)("snaps an active turn before %s", async (_name, interrupt) => {
    const { container, navigator } = setupPaginated({ pageTurnAnimation: "slide" });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);
    const { turn } = await startPartialTurn(navigator, frames);

    const interrupted = interrupt(navigator).catch((cause: unknown) => cause);
    await vi.waitFor(() => expect(scrolling.scrollLeft).toBe(864));
    navigator.destroy();

    await expect(turn).resolves.toBe(true);
    await interrupted;
  });

  it("snaps an active turn before resize settle", async () => {
    let resizeCallback!: ResizeObserverCallback;
    function MockResizeObserver(callback: ResizeObserverCallback): ResizeObserver {
      resizeCallback = callback;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    }
    vi.spyOn(document.defaultView!, "ResizeObserver").mockImplementation(MockResizeObserver);
    const { container, navigator } = setupPaginated({ pageTurnAnimation: "slide" });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);
    const { turn } = await startPartialTurn(navigator, frames);

    resizeCallback([], {} as ResizeObserver);
    expect(scrolling.scrollLeft).toBe(864);
    navigator.destroy();

    await expect(turn).resolves.toBe(true);
  });

  it("ignores a zero-size resize and settles a later real size from the last page", async () => {
    let resizeCallback!: ResizeObserverCallback;
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as ResizeObserver;
    function MockResizeObserver(callback: ResizeObserverCallback): ResizeObserver {
      resizeCallback = callback;
      return observer;
    }
    vi.spyOn(document.defaultView!, "ResizeObserver").mockImplementation(MockResizeObserver);
    const { container, navigator } = setupPaginated();
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    navigator.restoreProgression(0.5);
    const previousScroll = scrolling.scrollLeft;
    const previousWidth = frame.style.width;
    const previousRelocation = navigator.currentRelocation;

    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 0 },
    });
    Object.defineProperties(frame, {
      clientWidth: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 0 },
    });
    resizeCallback(
      [
        {
          target: container,
          contentRect: { width: 0, height: 0 },
        } as unknown as ResizeObserverEntry,
      ],
      observer,
    );
    await Promise.resolve();

    expect(frame.style.width).toBe(previousWidth);
    expect(scrolling.scrollLeft).toBe(previousScroll);
    expect(navigator.currentRelocation).toBe(previousRelocation);

    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 600 },
    });
    Object.defineProperties(frame, {
      clientWidth: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 600 },
    });
    resizeCallback(
      [
        {
          target: container,
          contentRect: { width: 600, height: 600 },
        } as unknown as ResizeObserverEntry,
      ],
      observer,
    );

    await vi.waitFor(() => expect(frame.style.width).toBe("600px"));
    await vi.waitFor(() => expect(navigator.state).toBe("settled"));
    expect(scrolling.scrollLeft).toBeGreaterThan(0);
    expect(navigator.currentRelocation?.localProgression).toBeGreaterThan(0);
    navigator.destroy();
  });

  it("cancels an active turn without snapping when destroyed", async () => {
    const { container, navigator } = setupPaginated({ pageTurnAnimation: "slide" });
    await finishPaginatedDisplay(container, navigator.display({ spineIndex: 0 }), navigator);
    const frame = container.querySelector("iframe")!;
    const scrolling =
      frame.contentDocument!.scrollingElement ?? frame.contentDocument!.documentElement;
    const frames = mockFrameAnimationFrames(frame);
    const { turn } = await startPartialTurn(navigator, frames);
    const partialOffset = scrolling.scrollLeft;

    navigator.destroy();

    await expect(turn).resolves.toBe(true);
    expect(scrolling.scrollLeft).toBe(partialOffset);
    expect(frames.cancel).toHaveBeenCalledOnce();
  });
});
