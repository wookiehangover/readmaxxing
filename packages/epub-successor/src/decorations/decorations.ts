import type { Locator } from "../publication-model/publication-model";
import {
  locatorFromRange,
  resolveLocator,
  type PersistentLocator,
  type SectionMetadata,
} from "../locations/locations";

const DEFAULT_HIGHLIGHT_COLOR = "rgba(255, 226, 74, 0.45)";
const OVERLAY_ATTRIBUTE = "data-epub-decoration-overlay";
let layerSequence = 0;

interface HighlightLike {}

interface HighlightRegistryLike {
  set(name: string, highlight: HighlightLike): unknown;
  delete(name: string): boolean;
}

interface HighlightEnvironment {
  readonly registry: HighlightRegistryLike;
  readonly Highlight: new (...ranges: Range[]) => HighlightLike;
}

interface HighlightCapableWindow {
  readonly CSS?: { readonly highlights?: HighlightRegistryLike };
  readonly Highlight?: new (...ranges: Range[]) => HighlightLike;
}

export interface HighlightDecorationStyle {
  readonly variant: "highlight";
  readonly color?: string;
}

export interface Decoration {
  readonly id: string;
  readonly locator: Locator | PersistentLocator;
  readonly style: HighlightDecorationStyle;
}

export interface DecorationClickDetail {
  readonly decoration: Decoration;
  readonly clientX: number;
  readonly clientY: number;
}

export interface SelectionChangedDetail {
  readonly locator: PersistentLocator | null;
  readonly text: string;
}

export interface DecorationLayerEventMap {
  readonly "decoration-click": DecorationClickDetail;
  readonly "selection-changed": SelectionChangedDetail;
}

export interface DecorationLayerOptions {
  readonly document: Document;
  readonly section: SectionMetadata;
  readonly rendering?: "auto" | "overlay";
}

interface DecorationEntry {
  decoration: Decoration;
  readonly highlightName: string;
  range: Range | null;
}

export type DecorationRenderingMode = "native" | "overlay";

function highlightEnvironment(document: Document): HighlightEnvironment | null {
  const view = document.defaultView as (Window & HighlightCapableWindow) | null;
  const registry = view?.CSS?.highlights;
  const Highlight = view?.Highlight;
  if (
    registry === undefined ||
    typeof registry.set !== "function" ||
    typeof registry.delete !== "function" ||
    typeof Highlight !== "function"
  ) {
    return null;
  }
  return { registry, Highlight };
}

export function supportsCssCustomHighlights(document: Document): boolean {
  return highlightEnvironment(document) !== null;
}

function normalizedColor(document: Document, color: string | undefined): string {
  if (color === undefined) return DEFAULT_HIGHLIGHT_COLOR;
  const probe = document.createElement("span");
  probe.style.backgroundColor = color;
  return probe.style.backgroundColor || DEFAULT_HIGHLIGHT_COLOR;
}

function containsPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export class DecorationLayer extends EventTarget {
  readonly #document: Document;
  readonly #section: SectionMetadata;
  readonly #entries = new Map<string, DecorationEntry>();
  readonly #environment: HighlightEnvironment | null;
  readonly #layerId = ++layerSequence;
  readonly #styleElement?: HTMLStyleElement;
  readonly #overlayElement?: HTMLDivElement;
  readonly #resizeObserver?: ResizeObserver;
  #entrySequence = 0;
  #frame?: number;
  #refreshQueued = false;
  #destroyed = false;

  constructor(options: DecorationLayerOptions) {
    super();
    this.#document = options.document;
    this.#section = options.section;
    this.#environment =
      options.rendering === "overlay" ? null : highlightEnvironment(options.document);

    if (this.#environment) {
      this.#styleElement = options.document.createElement("style");
      this.#styleElement.dataset.epubDecorationStyles = String(this.#layerId);
      (options.document.head ?? options.document.documentElement).append(this.#styleElement);
    } else {
      this.#overlayElement = options.document.createElement("div");
      this.#overlayElement.setAttribute(OVERLAY_ATTRIBUTE, String(this.#layerId));
      this.#overlayElement.setAttribute("aria-hidden", "true");
      Object.assign(this.#overlayElement.style, {
        inset: "0",
        overflow: "visible",
        pointerEvents: "none",
        position: "fixed",
        zIndex: "2147483646",
      });
      options.document.documentElement.append(this.#overlayElement);
    }

    const view = options.document.defaultView;
    view?.addEventListener("resize", this.#scheduleRefresh);
    view?.addEventListener("scroll", this.#scheduleRefresh, true);
    const ResizeObserverConstructor = view?.ResizeObserver;
    if (ResizeObserverConstructor) {
      this.#resizeObserver = new ResizeObserverConstructor(this.#scheduleRefresh);
      this.#resizeObserver.observe(options.document.documentElement);
    }
    options.document.addEventListener("click", this.#handleClick, true);
    options.document.addEventListener("selectionchange", this.#handleSelectionChange);
  }

  get renderingMode(): DecorationRenderingMode {
    return this.#environment ? "native" : "overlay";
  }

  get size(): number {
    return this.#entries.size;
  }

  get(id: string): Decoration | undefined {
    return this.#entries.get(id)?.decoration;
  }

  add(decoration: Decoration): boolean {
    this.#assertLive();
    this.#validate(decoration);
    if (this.#entries.has(decoration.id)) {
      throw new Error(`Decoration already exists: ${decoration.id}`);
    }
    const entry: DecorationEntry = {
      decoration,
      highlightName: `epub-decoration-${this.#layerId}-${++this.#entrySequence}`,
      range: this.#resolve(decoration.locator),
    };
    this.#entries.set(decoration.id, entry);
    this.#render();
    return entry.range !== null;
  }

  update(decoration: Decoration): boolean {
    this.#assertLive();
    this.#validate(decoration);
    const entry = this.#entries.get(decoration.id);
    if (!entry) return false;
    entry.decoration = decoration;
    entry.range = this.#resolve(decoration.locator);
    this.#render();
    return entry.range !== null;
  }

  remove(id: string): boolean {
    this.#assertLive();
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#environment?.registry.delete(entry.highlightName);
    this.#entries.delete(id);
    this.#render();
    return true;
  }

  clear(): void {
    this.#assertLive();
    for (const entry of this.#entries.values()) {
      this.#environment?.registry.delete(entry.highlightName);
    }
    this.#entries.clear();
    this.#render();
  }

  refresh(): void {
    this.#assertLive();
    for (const entry of this.#entries.values()) {
      entry.range = this.#resolve(entry.decoration.locator);
    }
    this.#render();
  }

  on<K extends keyof DecorationLayerEventMap>(
    type: K,
    listener: (detail: DecorationLayerEventMap[K]) => void,
  ): () => void {
    const receive = (event: Event) =>
      listener((event as CustomEvent<DecorationLayerEventMap[K]>).detail);
    this.addEventListener(type, receive);
    return () => this.removeEventListener(type, receive);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const view = this.#document.defaultView;
    view?.removeEventListener("resize", this.#scheduleRefresh);
    view?.removeEventListener("scroll", this.#scheduleRefresh, true);
    this.#document.removeEventListener("click", this.#handleClick, true);
    this.#document.removeEventListener("selectionchange", this.#handleSelectionChange);
    this.#resizeObserver?.disconnect();
    if (this.#frame !== undefined) view?.cancelAnimationFrame(this.#frame);
    for (const entry of this.#entries.values()) {
      this.#environment?.registry.delete(entry.highlightName);
    }
    this.#entries.clear();
    this.#styleElement?.remove();
    this.#overlayElement?.remove();
  }

  readonly #scheduleRefresh = (): void => {
    if (this.#refreshQueued || this.#destroyed) return;
    this.#refreshQueued = true;
    const view = this.#document.defaultView;
    if (!view) {
      queueMicrotask(() => {
        this.#refreshQueued = false;
        if (!this.#destroyed) this.refresh();
      });
      return;
    }
    this.#frame = view.requestAnimationFrame(() => {
      this.#frame = undefined;
      this.#refreshQueued = false;
      if (!this.#destroyed) this.refresh();
    });
  };

  readonly #handleClick = (event: MouseEvent): void => {
    const entries = Array.from(this.#entries.values()).reverse();
    const entry = entries.find(({ range }) =>
      range
        ? Array.from(range.getClientRects()).some((rect) =>
            containsPoint(rect, event.clientX, event.clientY),
          )
        : false,
    );
    if (!entry) return;
    event.preventDefault();
    event.stopPropagation();
    this.#emit("decoration-click", {
      decoration: entry.decoration,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  readonly #handleSelectionChange = (): void => {
    const selection = this.#document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.#emit("selection-changed", { locator: null, text: "" });
      return;
    }
    const range = selection.getRangeAt(0);
    const owner =
      range.commonAncestorContainer.nodeType === Node.DOCUMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.ownerDocument;
    if (owner !== this.#document) return;
    this.#emit("selection-changed", {
      locator: locatorFromRange(range, this.#section),
      text: range.toString(),
    });
  };

  #emit<K extends keyof DecorationLayerEventMap>(
    type: K,
    detail: DecorationLayerEventMap[K],
  ): void {
    queueMicrotask(() => {
      if (!this.#destroyed) this.dispatchEvent(new CustomEvent(type, { detail }));
    });
  }

  #resolve(locator: Locator | PersistentLocator): Range | null {
    if (locator.href !== this.#section.href) return null;
    return resolveLocator(locator, this.#document, this.#section);
  }

  #render(): void {
    if (this.#environment) this.#renderNative();
    else this.#renderOverlay();
  }

  #renderNative(): void {
    if (!this.#environment || !this.#styleElement) return;
    const rules: string[] = [];
    for (const entry of this.#entries.values()) {
      this.#environment.registry.delete(entry.highlightName);
      if (entry.range) {
        this.#environment.registry.set(
          entry.highlightName,
          new this.#environment.Highlight(entry.range),
        );
      }
      const color = normalizedColor(this.#document, entry.decoration.style.color);
      rules.push(`::highlight(${entry.highlightName}){background-color:${color};}`);
    }
    this.#styleElement.textContent = rules.join("\n");
  }

  #renderOverlay(): void {
    if (!this.#overlayElement) return;
    this.#overlayElement.replaceChildren();
    let stackingOrder = 0;
    for (const entry of this.#entries.values()) {
      const color = normalizedColor(this.#document, entry.decoration.style.color);
      for (const rect of entry.range ? Array.from(entry.range.getClientRects()) : []) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        const highlight = this.#document.createElement("span");
        highlight.dataset.decorationId = entry.decoration.id;
        Object.assign(highlight.style, {
          backgroundColor: color,
          height: `${rect.height}px`,
          left: `${rect.left}px`,
          pointerEvents: "none",
          position: "absolute",
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          zIndex: String(++stackingOrder),
        });
        this.#overlayElement.append(highlight);
      }
    }
  }

  #validate(decoration: Decoration): void {
    if (decoration.id.trim() === "") throw new TypeError("Decoration id must not be empty");
    if (decoration.style.variant !== "highlight") {
      throw new TypeError(`Unsupported decoration style: ${decoration.style.variant}`);
    }
  }

  #assertLive(): void {
    if (this.#destroyed) throw new Error("DecorationLayer is destroyed");
  }
}

export function createDecorationLayer(options: DecorationLayerOptions): DecorationLayer {
  return new DecorationLayer(options);
}
