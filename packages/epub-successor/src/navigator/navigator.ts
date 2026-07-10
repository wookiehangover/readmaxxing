import {
  assembleSectionDocument,
  CONTENT_IFRAME_SANDBOX,
  type ContentTransform,
} from "../content-pipeline/content-pipeline";
import type { Publication } from "../publication-model/publication-model";
import { normalizePublicationPath, type PublicationPath } from "../publication-model/paths";
import type { ResourceProvider } from "../resource-loader/resource-loader";
import {
  ResourceUrlManager,
  type ResourceUrlLease,
  type ResourceUrlScope,
  rewriteXhtml,
} from "../resource-loader/urls";

const DEFAULT_READER_CSS =
  "html,body{box-sizing:border-box;margin:0;min-height:100%;}body{overflow-wrap:anywhere;}";
const DEFAULT_SETTLE_TIMEOUT_MS = 3_000;

export type NavigatorState = "idle" | "loading" | "settling" | "settled";
export type NavigatorFlow = "scrolled";

export interface NavigatorPreferences {
  readonly readerBaseCss?: string;
  readonly preferenceCss?: string;
}

export interface NavigatorSecurityOptions {
  readonly resourceProvider: ResourceProvider;
  readonly resourceUrlManager?: ResourceUrlManager;
  readonly transforms?: readonly ContentTransform[];
}

export interface CreateNavigatorOptions {
  readonly container: HTMLElement;
  readonly flow?: NavigatorFlow;
  readonly preferences?: NavigatorPreferences;
  readonly security: NavigatorSecurityOptions;
  readonly settleTimeoutMs?: number;
}

export interface DisplayTarget {
  readonly href?: PublicationPath;
  readonly spineIndex?: number;
  readonly fragment?: string;
}

export interface Relocation {
  readonly href: PublicationPath;
  readonly spineIndex: number;
  readonly localProgression: number;
  readonly totalProgression: number;
}

interface SectionMount {
  readonly operationId: number;
  readonly href: PublicationPath;
  readonly spineIndex: number;
  readonly frame: HTMLIFrameElement;
  readonly scope: ResourceUrlScope;
  readonly documentLease: ResourceUrlLease;
  removeScrollListener?: () => void;
  scrollFrame?: number;
}

interface PreparedSection {
  readonly href: PublicationPath;
  readonly spineIndex: number;
  readonly scope: ResourceUrlScope;
  readonly documentLease: ResourceUrlLease;
}

function abortError(): DOMException {
  return new DOMException("Navigation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function bounded(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function withoutFragment(href: string): string {
  const index = href.indexOf("#");
  return index < 0 ? href : href.slice(0, index);
}

function hrefFragment(href: string): string | undefined {
  const index = href.indexOf("#");
  return index < 0 ? undefined : href.slice(index + 1);
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function nextAnimationFrame(view: Window, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const frame = view.requestAnimationFrame(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
    const abort = () => {
      view.cancelAnimationFrame(frame);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class Navigator extends EventTarget {
  readonly publication: Publication;
  readonly #container: HTMLElement;
  readonly #preferences: NavigatorPreferences;
  readonly #security: NavigatorSecurityOptions;
  readonly #urlManager: ResourceUrlManager;
  readonly #ownsUrlManager: boolean;
  readonly #settleTimeoutMs: number;
  readonly #resizeObserver?: ResizeObserver;
  #state: NavigatorState = "idle";
  #operationId = 0;
  #operation?: AbortController;
  #active?: SectionMount;
  #relocation?: Relocation;
  #destroyed = false;
  #resizeQueued = false;

  constructor(publication: Publication, options: CreateNavigatorOptions) {
    super();
    this.publication = publication;
    this.#container = options.container;
    this.#preferences = options.preferences ?? {};
    this.#security = options.security;
    this.#settleTimeoutMs = Math.max(0, options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS);
    this.#ownsUrlManager = options.security.resourceUrlManager === undefined;
    this.#urlManager =
      options.security.resourceUrlManager ??
      new ResourceUrlManager(options.security.resourceProvider);
    if (this.#urlManager.provider !== options.security.resourceProvider) {
      throw new TypeError("resourceUrlManager must use the configured resourceProvider");
    }

    const ResizeObserverConstructor = options.container.ownerDocument.defaultView?.ResizeObserver;
    if (ResizeObserverConstructor) {
      this.#resizeObserver = new ResizeObserverConstructor(() => this.#scheduleResizeSettle());
      this.#resizeObserver.observe(options.container);
    }
  }

  get state(): NavigatorState {
    return this.#state;
  }

  get currentRelocation(): Relocation | undefined {
    return this.#relocation;
  }

  get contentDocument(): Document | null {
    return this.#active?.frame.contentDocument ?? null;
  }

  async display(target: DisplayTarget): Promise<Relocation> {
    this.#assertLive();
    const resolved = this.#resolveTarget(target);
    const operationId = ++this.#operationId;
    this.#operation?.abort();
    const controller = new AbortController();
    this.#operation = controller;
    this.#setState("loading");

    let prepared: PreparedSection | undefined;
    try {
      prepared = await this.#prepareSection(
        resolved.href,
        resolved.spineIndex,
        operationId,
        controller.signal,
      );
      this.#assertCurrent(operationId, controller.signal);
      const mount = this.#mount(prepared, operationId);
      prepared = undefined;
      await this.#waitForLoad(mount.frame, controller.signal);
      this.#assertCurrent(operationId, controller.signal);
      this.#setState("settling");
      await this.#settle(mount, resolved.fragment, controller.signal);
      this.#assertCurrent(operationId, controller.signal);
      this.#setState("settled");
      return this.#emitRelocation(mount);
    } catch (cause) {
      prepared?.documentLease.dispose();
      prepared?.scope.dispose();
      if (this.#active?.operationId === operationId) this.#unmount(this.#active);
      if (this.#operationId === operationId && !this.#destroyed) {
        this.#setState(this.#active ? "settled" : "idle");
      }
      if (controller.signal.aborted) throw abortError();
      throw cause;
    }
  }

  async next(): Promise<boolean> {
    this.#assertLive();
    const index = this.#active?.spineIndex;
    if (index === undefined || index + 1 >= this.publication.readingOrder.length) return false;
    await this.display({ spineIndex: index + 1 });
    return true;
  }

  async previous(): Promise<boolean> {
    this.#assertLive();
    const index = this.#active?.spineIndex;
    if (index === undefined || index === 0) return false;
    await this.display({ spineIndex: index - 1 });
    return true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#operationId += 1;
    this.#operation?.abort();
    this.#operation = undefined;
    this.#resizeObserver?.disconnect();
    if (this.#active) this.#unmount(this.#active);
    if (this.#ownsUrlManager) this.#urlManager.dispose();
    this.#relocation = undefined;
    this.#setState("idle");
  }

  async #prepareSection(
    href: PublicationPath,
    spineIndex: number,
    operationId: number,
    signal: AbortSignal,
  ): Promise<PreparedSection> {
    const scope = this.#urlManager.createScope();
    let documentLease: ResourceUrlLease | undefined;
    try {
      const source = await this.#security.resourceProvider.readText(href, signal);
      const rewritten = await rewriteXhtml(source, href, scope, signal);
      throwIfAborted(signal);
      const document = new DOMParser().parseFromString(rewritten, "application/xhtml+xml");
      if (document.getElementsByTagName("parsererror").length > 0) {
        throw new Error(`Cannot render malformed publication section: ${href}`);
      }
      const assembled = assembleSectionDocument(document, {
        context: { sectionHref: href, spineIndex },
        transforms: this.#security.transforms,
        readerBaseCss: this.#preferences.readerBaseCss ?? DEFAULT_READER_CSS,
        preferenceCss: this.#preferences.preferenceCss,
      });
      documentLease = await this.#urlManager.acquireGenerated(
        `section:${operationId}:${href}`,
        href,
        assembled.html,
        "application/xhtml+xml",
        signal,
      );
      return { href, spineIndex, scope, documentLease };
    } catch (cause) {
      documentLease?.dispose();
      scope.dispose();
      if (signal.aborted) throw abortError();
      throw cause;
    }
  }

  #mount(prepared: PreparedSection, operationId: number): SectionMount {
    if (this.#active) this.#unmount(this.#active);
    const frame = this.#container.ownerDocument.createElement("iframe");
    frame.setAttribute("sandbox", CONTENT_IFRAME_SANDBOX);
    frame.setAttribute("title", `Publication section ${prepared.spineIndex + 1}`);
    frame.style.border = "0";
    frame.style.display = "block";
    frame.style.height = "100%";
    frame.style.width = "100%";
    frame.src = prepared.documentLease.url;
    const mount: SectionMount = { ...prepared, operationId, frame };
    this.#active = mount;
    return mount;
  }

  #waitForLoad(frame: HTMLIFrameElement, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        frame.removeEventListener("load", loaded);
        frame.removeEventListener("error", failed);
        signal.removeEventListener("abort", aborted);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Publication section iframe failed to load"));
      };
      const aborted = () => {
        cleanup();
        reject(abortError());
      };
      frame.addEventListener("load", loaded, { once: true });
      frame.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      else this.#container.append(frame);
    });
  }

  async #settle(
    mount: SectionMount,
    fragment: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const document = mount.frame.contentDocument;
    const view = mount.frame.contentWindow;
    if (!document || !view) throw new Error("Publication section document is inaccessible");
    this.#scrollToFragment(document, fragment);
    const fonts = document.fonts?.ready;
    if (fonts) await this.#boundedSettle(waitWithAbort(fonts, signal), signal);
    await this.#boundedSettle(this.#decodeVisibleImages(document, signal), signal);
    await nextAnimationFrame(view, signal);
    await nextAnimationFrame(view, signal);
    this.#installScrollListener(mount, view);
  }

  async #boundedSettle(work: Promise<unknown>, signal: AbortSignal): Promise<void> {
    if (this.#settleTimeoutMs === 0) {
      await work;
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, this.#settleTimeoutMs);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    throwIfAborted(signal);
  }

  async #decodeVisibleImages(document: Document, signal: AbortSignal): Promise<void> {
    const root = document.documentElement;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const images = Array.from(document.querySelectorAll("img")).filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom >= 0 && rect.right >= 0 && rect.top <= height && rect.left <= width;
    });
    await Promise.all(
      images.map((image) =>
        typeof image.decode === "function"
          ? waitWithAbort(
              image.decode().catch(() => undefined),
              signal,
            )
          : Promise.resolve(),
      ),
    );
  }

  #scrollToFragment(document: Document, fragment: string | undefined): void {
    if (!fragment) return;
    let decoded = fragment.replace(/^#/, "");
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Invalid author encoding is treated as a literal fragment.
    }
    const target = document.getElementById(decoded) ?? document.getElementsByName(decoded)[0];
    target?.scrollIntoView();
  }

  #installScrollListener(mount: SectionMount, view: Window): void {
    mount.removeScrollListener?.();
    const scroll = () => {
      if (mount.scrollFrame !== undefined) return;
      mount.scrollFrame = view.requestAnimationFrame(() => {
        mount.scrollFrame = undefined;
        if (this.#active === mount && this.#state === "settled") this.#emitRelocation(mount);
      });
    };
    view.addEventListener("scroll", scroll, true);
    mount.removeScrollListener = () => view.removeEventListener("scroll", scroll, true);
  }

  #emitRelocation(mount: SectionMount): Relocation {
    const document = mount.frame.contentDocument;
    if (!document) throw new Error("Publication section document is inaccessible");
    const scrolling = document.scrollingElement ?? document.documentElement;
    const extent = Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
    const localProgression = bounded(extent === 0 ? 0 : scrolling.scrollTop / extent);
    const count = this.publication.readingOrder.length;
    const relocation: Relocation = {
      href: mount.href,
      spineIndex: mount.spineIndex,
      localProgression,
      totalProgression: count === 0 ? 0 : bounded((mount.spineIndex + localProgression) / count),
    };
    this.#relocation = relocation;
    this.dispatchEvent(new CustomEvent<Relocation>("relocation", { detail: relocation }));
    return relocation;
  }

  #scheduleResizeSettle(): void {
    if (this.#resizeQueued || this.#destroyed || !this.#active || this.#state !== "settled") return;
    this.#resizeQueued = true;
    queueMicrotask(() => {
      this.#resizeQueued = false;
      const mount = this.#active;
      const signal = this.#operation?.signal;
      if (!mount || !signal || signal.aborted || this.#destroyed) return;
      this.#setState("settling");
      void this.#settle(mount, undefined, signal)
        .then(() => {
          if (this.#active !== mount || signal.aborted || this.#destroyed) return;
          this.#setState("settled");
          this.#emitRelocation(mount);
        })
        .catch(() => {
          if (this.#active === mount && !signal.aborted && !this.#destroyed)
            this.#setState("settled");
        });
    });
  }

  #resolveTarget(target: DisplayTarget): {
    href: PublicationPath;
    spineIndex: number;
    fragment?: string;
  } {
    if ((target.href === undefined) === (target.spineIndex === undefined)) {
      throw new TypeError("display() requires exactly one of href or spineIndex");
    }
    if (target.spineIndex !== undefined) {
      if (!Number.isInteger(target.spineIndex) || target.spineIndex < 0) {
        throw new RangeError("spineIndex must be a non-negative integer");
      }
      const link = this.publication.readingOrder[target.spineIndex];
      if (!link) throw new RangeError(`No spine item exists at index ${target.spineIndex}`);
      return {
        href: normalizePublicationPath(withoutFragment(link.href)),
        spineIndex: target.spineIndex,
        fragment: target.fragment ?? hrefFragment(link.href),
      };
    }
    const requested = target.href!;
    const bare = normalizePublicationPath(withoutFragment(requested));
    const spineIndex = this.publication.readingOrder.findIndex(
      (link) => withoutFragment(link.href) === bare,
    );
    if (spineIndex < 0) throw new RangeError(`Publication spine does not contain ${bare}`);
    return { href: bare, spineIndex, fragment: target.fragment ?? hrefFragment(requested) };
  }

  #unmount(mount: SectionMount): void {
    mount.removeScrollListener?.();
    if (mount.scrollFrame !== undefined)
      mount.frame.contentWindow?.cancelAnimationFrame(mount.scrollFrame);
    mount.frame.remove();
    if (this.#active === mount) this.#active = undefined;
    queueMicrotask(() => {
      mount.documentLease.dispose();
      mount.scope.dispose();
    });
  }

  #assertCurrent(operationId: number, signal: AbortSignal): void {
    throwIfAborted(signal);
    if (this.#operationId !== operationId || this.#destroyed) throw abortError();
  }

  #assertLive(): void {
    if (this.#destroyed) throw new Error("Navigator is destroyed");
  }

  #setState(state: NavigatorState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.dispatchEvent(new CustomEvent<NavigatorState>("statechange", { detail: state }));
  }
}

export function createNavigator(
  publication: Publication,
  options: CreateNavigatorOptions,
): Navigator {
  return new Navigator(publication, options);
}
