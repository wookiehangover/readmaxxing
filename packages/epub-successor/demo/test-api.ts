import type { DecorationLayer } from "../src/decorations/decorations";
import type { Navigator, NavigatorPreferences, Relocation } from "../src/navigator/navigator";

export interface DemoSnapshot {
  readonly state: string;
  readonly relocation?: Relocation;
  readonly visibleAnchors: readonly string[];
  readonly text: string;
  readonly iframeSrc?: string;
  readonly sandbox?: string | null;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly pageCount: number;
  readonly pageStyle: string;
  readonly direction: string;
  readonly decorationMode?: string;
  readonly overlayRects: readonly { left: number; top: number; width: number; height: number }[];
  readonly nativeHighlightRules: number;
  readonly decorationClicks: number;
  readonly relocationCount: number;
  readonly settleRafCycles: number;
  readonly stateEvents: readonly string[];
  readonly fontsStatus?: string;
  readonly images: readonly { complete: boolean; naturalWidth: number; src: string }[];
}

export interface DemoTestApi {
  load(name: string): Promise<void>;
  unload(): Promise<void>;
  snapshot(): DemoSnapshot;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  displayFragment(fragment: string): Promise<void>;
  setPreferences(update: NavigatorPreferences): Promise<void>;
  setReaderWidth(width: number): void;
  selectText(text: string): Promise<boolean>;
  addHighlight(): boolean;
  clickHighlight(): boolean;
  scrollBurst(progressions: readonly number[]): Promise<number>;
  cancelDuringSettle(): Promise<{ first: string; second: Relocation; frames: number }>;
  exerciseSecurity(): Promise<void>;
  securitySnapshot(): SecuritySnapshot;
  lifecycle(): { readonly created: readonly string[]; readonly revoked: readonly string[] };
}

interface TestApiContext {
  readonly reader: HTMLElement;
  readonly lifecycle: { readonly created: string[]; readonly revoked: string[] };
  navigator(): Navigator | undefined;
  decorations(): DecorationLayer | undefined;
  relocation(): Relocation | undefined;
  selectedText(): string;
  decorationClicks(): number;
  relocationCount(): number;
  settleRafCycles(): number;
  stateEvents(): readonly string[];
  load(name: string): Promise<void>;
  unload(): Promise<void>;
  move(direction: "next" | "previous"): Promise<boolean>;
  displayHref(href: string): Promise<void>;
  setPreferences(update: NavigatorPreferences): Promise<void>;
  addHighlight(): boolean;
  configureDecorations(): void;
}

interface SecuritySnapshot {
  readonly scripts: number;
  readonly handlers: number;
  readonly dangerousUrls: number;
  readonly refreshes: number;
  readonly foreignObjects: number;
  readonly formAction?: string | null;
  readonly submitFormAction?: string | null;
  readonly topTarget?: string | null;
  readonly scriptRan: boolean;
  readonly handlerRan: boolean;
  readonly javascriptRan: boolean;
  readonly svgRan: boolean;
  readonly topHref: string;
  readonly csp?: string | null;
}

function visibleAnchors(doc: Document): string[] {
  const { clientWidth: width, clientHeight: height } = doc.documentElement;
  return Array.from(doc.querySelectorAll<HTMLElement>("h1,p,[data-anchor]"))
    .filter((node) =>
      Array.from(node.getClientRects()).some(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < width &&
          rect.top < height,
      ),
    )
    .map((node) => node.dataset.anchor ?? node.textContent?.trim().slice(0, 80) ?? "");
}

function snapshot(context: TestApiContext): DemoSnapshot {
  const navigator = context.navigator();
  const doc = navigator?.contentDocument;
  const scrolling = doc?.scrollingElement ?? doc?.documentElement;
  const view = doc?.defaultView;
  const bodyStyle = doc?.body && view?.getComputedStyle(doc.body);
  const columnWidth = Number.parseFloat(bodyStyle?.columnWidth ?? "0");
  const columnGap = Number.parseFloat(bodyStyle?.columnGap ?? "0");
  const stride = columnWidth + columnGap;
  const scrollWidth = scrolling?.scrollWidth ?? 0;
  const highlightStyles = doc?.querySelector("[data-epub-decoration-styles]")?.textContent ?? "";
  const relocation = context.relocation();
  return {
    state: navigator?.state ?? "idle",
    ...(relocation ? { relocation } : {}),
    visibleAnchors: doc ? visibleAnchors(doc) : [],
    text: doc?.body?.textContent?.trim() ?? "",
    iframeSrc: context.reader.querySelector("iframe")?.src,
    sandbox: context.reader.querySelector("iframe")?.getAttribute("sandbox"),
    scrollTop: scrolling?.scrollTop ?? 0,
    scrollHeight: scrolling?.scrollHeight ?? 0,
    clientHeight: scrolling?.clientHeight ?? 0,
    scrollLeft: scrolling?.scrollLeft ?? 0,
    scrollWidth,
    clientWidth: scrolling?.clientWidth ?? 0,
    pageCount: stride > 0 ? Math.max(1, Math.ceil((scrollWidth + columnGap) / stride)) : 1,
    pageStyle: doc?.getElementById("epub-successor-pagination-style")?.textContent ?? "",
    direction: doc?.documentElement.dir || bodyStyle?.direction || "ltr",
    decorationMode: context.decorations()?.renderingMode,
    overlayRects: Array.from(
      doc?.querySelectorAll<HTMLElement>("[data-epub-decoration-overlay] span") ?? [],
    ).map((node) => ({
      left: Number.parseFloat(node.style.left),
      top: Number.parseFloat(node.style.top),
      width: Number.parseFloat(node.style.width),
      height: Number.parseFloat(node.style.height),
    })),
    nativeHighlightRules: highlightStyles.split("::highlight(").length - 1,
    decorationClicks: context.decorationClicks(),
    relocationCount: context.relocationCount(),
    settleRafCycles: context.settleRafCycles(),
    stateEvents: [...context.stateEvents()],
    fontsStatus: doc?.fonts?.status,
    images: Array.from(doc?.images ?? []).map((image) => ({
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      src: image.src,
    })),
  };
}

async function selectText(context: TestApiContext, text: string): Promise<boolean> {
  const doc = context.navigator()?.contentDocument;
  if (!doc) return false;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const start = node.nodeValue?.indexOf(text) ?? -1;
    if (start >= 0) {
      const range = doc.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      doc.dispatchEvent(new Event("selectionchange"));
      await Promise.resolve();
      await Promise.resolve();
      return context.selectedText() === text;
    }
    node = walker.nextNode();
  }
  return false;
}

async function scrollBurst(context: TestApiContext, progressions: readonly number[]) {
  const doc = context.navigator()?.contentDocument;
  const view = doc?.defaultView;
  const scrolling = doc?.scrollingElement ?? doc?.documentElement;
  if (!view || !scrolling) return 0;
  const before = context.relocationCount();
  const extent = Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
  for (const progression of progressions) {
    scrolling.scrollTop = extent * progression;
    view.dispatchEvent(new Event("scroll"));
  }
  await new Promise<void>((resolve) =>
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())),
  );
  return context.relocationCount() - before;
}

async function cancelDuringSettle(context: TestApiContext) {
  const navigator = context.navigator();
  if (!navigator) throw new Error("No publication is open");
  let startSecond: (() => void) | undefined;
  const trigger = new Promise<void>((resolve) => {
    startSecond = resolve;
  });
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail !== "settling") return;
    navigator.removeEventListener("statechange", listener);
    navigator.contentDocument?.defaultView?.requestAnimationFrame(() => startSecond?.());
  };
  navigator.addEventListener("statechange", listener);
  const first = navigator.display({ spineIndex: 0 }).then(
    () => "resolved",
    (cause: unknown) => (cause instanceof DOMException ? cause.name : String(cause)),
  );
  await trigger;
  const second = await navigator.display({ spineIndex: 1 });
  context.configureDecorations();
  return { first: await first, second, frames: context.reader.querySelectorAll("iframe").length };
}

async function exerciseSecurity(context: TestApiContext): Promise<void> {
  const doc = context.navigator()?.contentDocument;
  for (const id of ["probe-handler", "probe-javascript", "probe-data", "probe-top"]) {
    doc?.getElementById(id)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  (doc?.getElementById("probe-form") as HTMLFormElement | null)?.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 100));
}

function securitySnapshot(context: TestApiContext): SecuritySnapshot {
  const doc = context.navigator()?.contentDocument;
  const frameWindow = doc?.defaultView as (Window & Record<string, unknown>) | null | undefined;
  const elements = Array.from(doc?.querySelectorAll("*") ?? []);
  return {
    scripts: doc?.querySelectorAll("script").length ?? 0,
    handlers: elements.flatMap((node) =>
      Array.from(node.attributes).filter(({ name }) => name.toLowerCase().startsWith("on")),
    ).length,
    dangerousUrls: elements.flatMap((node) =>
      Array.from(node.attributes).filter(({ value }) =>
        /^\s*(?:javascript:|data:text\/html)/i.test(value),
      ),
    ).length,
    refreshes: doc?.querySelectorAll('meta[http-equiv="refresh" i]').length ?? 0,
    foreignObjects: doc?.querySelectorAll("foreignObject").length ?? 0,
    formAction: doc?.getElementById("probe-form")?.getAttribute("action"),
    submitFormAction: doc?.querySelector("#probe-form button")?.getAttribute("formaction"),
    topTarget: doc?.getElementById("probe-top")?.getAttribute("target"),
    scriptRan: Boolean(frameWindow?.__epubProbeScript),
    handlerRan: Boolean(frameWindow?.__epubProbeHandler),
    javascriptRan: Boolean(frameWindow?.__epubProbeJavascript),
    svgRan: Boolean(frameWindow?.__epubProbeSvg),
    topHref: location.href,
    csp: doc
      ?.querySelector('meta[http-equiv="Content-Security-Policy" i]')
      ?.getAttribute("content"),
  };
}

export function createDemoTestApi(context: TestApiContext): DemoTestApi {
  return {
    load: context.load,
    unload: context.unload,
    snapshot: () => snapshot(context),
    next: () => context.move("next"),
    previous: () => context.move("previous"),
    displayFragment: async (fragment) => {
      const navigator = context.navigator();
      const href = navigator?.publication.readingOrder[context.relocation()?.spineIndex ?? 0]?.href;
      if (href) await context.displayHref(`${href.split("#")[0]}#${fragment}`);
    },
    setPreferences: context.setPreferences,
    setReaderWidth: (width) => {
      context.reader.style.width = `${width}px`;
    },
    selectText: (text) => selectText(context, text),
    addHighlight: context.addHighlight,
    clickHighlight: () => {
      const doc = context.navigator()?.contentDocument;
      const selection = doc?.getSelection();
      if (!doc || !selection || selection.rangeCount === 0) return false;
      const rect = selection.getRangeAt(0).getClientRects()[0];
      if (!rect) return false;
      doc.dispatchEvent(
        new MouseEvent("click", {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
      return true;
    },
    scrollBurst: (progressions) => scrollBurst(context, progressions),
    cancelDuringSettle: () => cancelDuringSettle(context),
    exerciseSecurity: () => exerciseSecurity(context),
    securitySnapshot: () => securitySnapshot(context),
    lifecycle: () => ({
      created: [...context.lifecycle.created],
      revoked: [...context.lifecycle.revoked],
    }),
  };
}

declare global {
  interface Window {
    __epubDemo: DemoTestApi;
  }
}
