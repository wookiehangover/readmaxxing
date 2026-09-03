import {
  assembleSectionDocument,
  CONTENT_IFRAME_SANDBOX,
  type ContentTransform,
} from "../content-pipeline/content-pipeline";
import type { Publication } from "../publication-model/publication-model";
import { normalizePublicationPath, type PublicationPath } from "../publication-model/paths";
import type { ResourceProvider } from "../resource-loader/resource-loader";
import {
  INTERNAL_LINK_ATTRIBUTE,
  ResourceUrlManager,
  type ResourceUrlLease,
  type ResourceUrlScope,
  rewriteXhtml,
} from "../resource-loader/urls";
import {
  alignPaginationToRange,
  animateScrollToPage,
  captureFirstVisibleElement,
  currentLogicalOffset,
  currentSpreadIndex,
  paginatedProgression,
  scrollToPage,
  scrollLeftFromLogicalOffset,
  type PageScrollAnimation,
  type PaginatedLayoutState,
} from "./paginated";
import {
  buildPreferenceCss,
  mergePreferences,
  type NavigatorFlow,
  type NavigatorPreferences,
} from "./preferences";
import { nextAnimationFrame, settleSection } from "./section-layout";
import { resolveCfi } from "../locations/cfi";
import {
  applyContentRange,
  contentRange,
  rangeContainsRange,
  type NavigatorContentRange,
} from "./content-range";
import type { NavigatorNavigationPolicy } from "./navigation-policy";
import { lastRenderedRange } from "./visible-text";

export type {
  NavigatorFlow,
  NavigatorPreferences,
  NavigatorSpread,
  NavigatorTheme,
} from "./preferences";

const DEFAULT_READER_CSS =
  "html,body{box-sizing:border-box;margin:0;min-height:100%;}body{overflow-wrap:anywhere;}";
const DEFAULT_SETTLE_TIMEOUT_MS = 3_000;
const DEFAULT_PAGE_TURN_DURATION_MS = 250;

export type NavigatorState = "idle" | "loading" | "settling" | "settled";
export type InteractivePageTurnDirection = "previous" | "next";

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
  readonly navigationPolicy?: NavigatorNavigationPolicy;
}

export interface DisplayTarget {
  readonly href?: PublicationPath;
  readonly spineIndex?: number;
  readonly fragment?: string;
  readonly cfi?: string;
  readonly localProgression?: number;
  readonly position?: "start" | "end";
  readonly contentRange?: NavigatorContentRange;
}

export interface Relocation {
  readonly href: PublicationPath;
  readonly spineIndex: number;
  readonly localProgression: number;
  readonly totalProgression: number;
}

interface SectionMount {
  /** Bumped when an in-place redisplay reuses this mount without remounting. */
  operationId: number;
  readonly href: PublicationPath;
  readonly spineIndex: number;
  readonly frame: HTMLIFrameElement;
  readonly scope: ResourceUrlScope;
  readonly documentLease: ResourceUrlLease;
  removeInternalLinkListener?: () => void;
  removeScrollListener?: () => void;
  scrollFrame?: number;
  scrollScheduler?: Window;
  pagination?: PaginatedLayoutState;
  visibleAnchor?: Element;
  settledWidth?: number;
  settledHeight?: number;
  overlaid?: boolean;
  contentRange?: NavigatorContentRange;
  restoreContent?: () => void;
  scrollTop?: number;
}

interface PreparedSection {
  readonly href: PublicationPath;
  readonly spineIndex: number;
  readonly scope: ResourceUrlScope;
  readonly documentLease: ResourceUrlLease;
}

interface SameSectionInteractiveTurn {
  readonly kind: "same-section";
  readonly direction: InteractivePageTurnDirection;
  readonly originPageIndex: number;
  readonly originLogicalOffset: number;
  readonly targetPageIndex: number;
  readonly targetLogicalOffset: number;
}

interface SpineInteractiveTurn {
  readonly kind: "spine";
  readonly direction: InteractivePageTurnDirection;
  readonly targetSpineIndex: number;
}

interface EdgeInteractiveTurn {
  readonly kind: "edge";
  readonly direction: InteractivePageTurnDirection;
  readonly originPageIndex: number;
  displacement: number;
}

type InteractivePageTurn = SameSectionInteractiveTurn | SpineInteractiveTurn | EdgeInteractiveTurn;

interface ActivePageMove {
  readonly mount: SectionMount;
  snapPageIndex: number;
  interactive?: InteractivePageTurn;
  animation?: PageScrollAnimation;
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

function hasLayoutSize(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (rect.width || element.clientWidth) > 0 && (rect.height || element.clientHeight) > 0;
}

function withoutFragment(href: string): string {
  const index = href.indexOf("#");
  return index < 0 ? href : href.slice(0, index);
}

function hrefFragment(href: string): string | undefined {
  const index = href.indexOf("#");
  return index < 0 ? undefined : href.slice(index + 1);
}

export class Navigator extends EventTarget {
  readonly publication: Publication;
  readonly #container: HTMLElement;
  #preferences: NavigatorPreferences;
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
  #pageMove?: ActivePageMove;
  #overlayCount = 0;
  #containerPosition?: string;
  readonly #navigationPolicy?: NavigatorNavigationPolicy;

  constructor(publication: Publication, options: CreateNavigatorOptions) {
    super();
    this.publication = publication;
    this.#navigationPolicy = options.navigationPolicy;
    this.#container = options.container;
    this.#preferences = {
      ...options.preferences,
      flow: options.flow ?? options.preferences?.flow ?? "scrolled",
      spread: options.preferences?.spread ?? "single",
      pageTurnAnimation: options.preferences?.pageTurnAnimation ?? "none",
      pageTurnDurationMs: options.preferences?.pageTurnDurationMs ?? DEFAULT_PAGE_TURN_DURATION_MS,
    };
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
      this.#resizeObserver = new ResizeObserverConstructor((entries) => {
        const size = entries.find((entry) => entry.target === this.#container)?.contentRect;
        this.#scheduleResizeSettle(size);
      });
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

  get currentContentRange(): NavigatorContentRange | undefined {
    return this.#active?.contentRange;
  }

  allowsMovement(direction: "next" | "previous" | "restore" | "speedread"): boolean {
    return this.#navigationPolicy?.allowMovement(direction) ?? true;
  }

  async display(target: DisplayTarget): Promise<Relocation> {
    return this.#display(target, false);
  }

  async #display(target: DisplayTarget, positionAtEnd: boolean): Promise<Relocation> {
    this.#assertLive();
    const admitted = this.#navigationPolicy?.resolve(target) ?? target;
    if (admitted === false) {
      if (this.#relocation) return this.#relocation;
      throw abortError();
    }
    target = admitted;
    this.#cancelPageMove(true);
    const resolved = this.#resolveTarget(target);

    // Same-section short-circuit: re-settle in the existing iframe instead of
    // unmounting/remounting (which flashes text and rebuilds layout).
    const existing = this.#active;
    if (
      existing &&
      existing.spineIndex === resolved.spineIndex &&
      existing.href === resolved.href &&
      existing.contentRange?.key === target.contentRange?.key &&
      existing.frame.contentDocument &&
      (this.#state === "settled" || this.#state === "settling")
    ) {
      return this.#redisplayMounted(existing, resolved.fragment, target);
    }

    const operationId = ++this.#operationId;
    this.#operation?.abort();
    const controller = new AbortController();
    this.#operation = controller;
    this.#setState("loading");

    const outgoing = this.#active;
    let prepared: PreparedSection | undefined;
    let mount: SectionMount | undefined;
    try {
      prepared = await this.#prepareSection(
        resolved.href,
        resolved.spineIndex,
        operationId,
        controller.signal,
      );
      this.#assertCurrent(operationId, controller.signal);
      mount = this.#mount(prepared, operationId, outgoing);
      prepared = undefined;
      await this.#waitForLoad(mount.frame, controller.signal);
      mount.contentRange = target.contentRange;
      mount.restoreContent = applyContentRange(mount.frame.contentDocument!, target.contentRange);
      this.#installInternalLinkListener(mount);
      this.#assertCurrent(operationId, controller.signal);
      this.#setState("settling");
      await this.#settle(mount, resolved.fragment, controller.signal);
      this.#assertCurrent(operationId, controller.signal);
      this.#positionMount(mount, { ...target, position: positionAtEnd ? "end" : target.position });
      if (this.#navigationPolicy && !this.#navigationPolicy.allowCommit(target)) throw abortError();
      this.#revealMount(mount);
      this.#assertCurrent(operationId, controller.signal);
      this.#active = mount;
      if (outgoing) this.#unmount(outgoing);
      this.#setState("settled");
      return this.#emitRelocation(mount);
    } catch (cause) {
      prepared?.documentLease.dispose();
      prepared?.scope.dispose();
      if (mount) this.#unmount(mount);
      if (this.#operationId === operationId && !this.#destroyed) {
        this.#setState(this.#active ? "settled" : "idle");
      }
      if (controller.signal.aborted) throw abortError();
      throw cause;
    }
  }

  async next(): Promise<boolean> {
    this.#assertLive();
    if (!this.allowsMovement("next")) return false;
    this.#cancelPageMove(true);
    const mount = this.#active;
    const index = mount?.spineIndex;
    if (mount?.pagination) {
      const spread = currentSpreadIndex(mount.pagination);
      const targetSpread = spread + 1;
      if (targetSpread * mount.pagination.pagesPerSpread < mount.pagination.pageCount) {
        await this.#moveToPage(mount, targetSpread * mount.pagination.pagesPerSpread);
        return true;
      }
    }
    const boundary = this.#boundaryTarget("next");
    if (boundary === false) return false;
    if (boundary) {
      await this.display(boundary);
      return true;
    }
    if (index === undefined || index + 1 >= this.publication.readingOrder.length) return false;
    await this.display({ spineIndex: index + 1 });
    return true;
  }

  async previous(): Promise<boolean> {
    this.#assertLive();
    if (!this.allowsMovement("previous")) return false;
    this.#cancelPageMove(true);
    const mount = this.#active;
    const index = mount?.spineIndex;
    if (mount?.pagination) {
      const spread = currentSpreadIndex(mount.pagination);
      if (spread > 0) {
        await this.#moveToPage(mount, (spread - 1) * mount.pagination.pagesPerSpread);
        return true;
      }
    }
    const boundary = this.#boundaryTarget("previous");
    if (boundary === false) return false;
    if (boundary) {
      await this.display(boundary);
      return true;
    }
    if (index === undefined || index === 0) return false;
    await this.#display({ spineIndex: index - 1 }, true);
    return true;
  }

  beginInteractivePageTurn(direction: InteractivePageTurnDirection): boolean {
    this.#assertLive();
    if (!this.allowsMovement(direction)) return false;
    this.#cancelPageMove(true);
    const mount = this.#active;
    const pagination = mount?.pagination;
    if (!mount || !pagination || this.#state !== "settled") return false;

    const spread = currentSpreadIndex(pagination);
    const targetSpread = direction === "next" ? spread + 1 : spread - 1;
    const targetPageIndex = targetSpread * pagination.pagesPerSpread;
    const originPageIndex = spread * pagination.pagesPerSpread;
    if (targetSpread < 0 || targetPageIndex >= pagination.pageCount) {
      const targetSpineIndex = mount.spineIndex + (direction === "next" ? 1 : -1);
      if (targetSpineIndex < 0 || targetSpineIndex >= this.publication.readingOrder.length) {
        this.#pageMove = {
          mount,
          snapPageIndex: originPageIndex,
          interactive: {
            kind: "edge",
            direction,
            originPageIndex,
            displacement: 0,
          },
        };
        mount.frame.style.willChange = "transform";
        return true;
      }

      const turn: SpineInteractiveTurn = {
        kind: "spine",
        direction,
        targetSpineIndex,
      };
      const move: ActivePageMove = { mount, snapPageIndex: originPageIndex, interactive: turn };
      this.#pageMove = move;
      return true;
    }

    this.#pageMove = {
      mount,
      snapPageIndex: originPageIndex,
      interactive: {
        kind: "same-section",
        direction,
        originPageIndex,
        originLogicalOffset: currentLogicalOffset(pagination),
        targetPageIndex,
        targetLogicalOffset: Math.min(
          pagination.maxOffset,
          targetPageIndex * pagination.columnStride,
        ),
      },
    };
    return true;
  }

  updateInteractivePageTurn(displacement: number): boolean {
    const move = this.#pageMove;
    const turn = move?.interactive;
    const pagination = move?.mount.pagination;
    if (!move || !turn || !pagination) return false;

    if (turn.kind === "spine") return true;

    if (turn.kind === "edge") {
      const finiteDisplacement = Number.isFinite(displacement) ? displacement : 0;
      const width = pagination.viewportWidth;
      const directional =
        turn.direction === "next"
          ? Math.max(-width, Math.min(0, finiteDisplacement))
          : Math.min(width, Math.max(0, finiteDisplacement));
      turn.displacement =
        Math.sign(directional) * Math.min(width * 0.12, Math.abs(directional) * 0.2);
      this.#applyEdgeTransform(move, turn.displacement);
      return true;
    }

    const requested = turn.originLogicalOffset - (Number.isFinite(displacement) ? displacement : 0);
    const minimum = Math.min(turn.originLogicalOffset, turn.targetLogicalOffset);
    const maximum = Math.max(turn.originLogicalOffset, turn.targetLogicalOffset);
    const logicalOffset = Math.min(maximum, Math.max(minimum, requested));
    pagination.scrolling.scrollLeft = scrollLeftFromLogicalOffset(
      logicalOffset,
      pagination.maxOffset,
      pagination.direction,
      pagination.rtlScrollType,
    );
    return true;
  }

  async endInteractivePageTurn(commit: boolean): Promise<boolean> {
    const move = this.#pageMove;
    const turn = move?.interactive;
    const pagination = move?.mount.pagination;
    if (!move || !turn || !pagination) return false;
    if (commit && !this.allowsMovement(turn.direction)) {
      this.#cancelPageMove(true);
      return false;
    }

    if (turn.kind === "edge") {
      await this.#settleEdgeTurn(move, 0);
      if (this.#pageMove !== move) return false;
      this.#clearInteractiveFrameStyles(move.mount.frame);
      this.#pageMove = undefined;
      if (commit) {
        const target = this.#boundaryTarget(turn.direction);
        if (target) {
          await this.display(target);
          return true;
        }
      }
      return false;
    }

    if (turn.kind === "spine") return this.#endSpineInteractiveTurn(move, turn, commit);

    const targetPageIndex = commit ? turn.targetPageIndex : turn.originPageIndex;
    move.snapPageIndex = targetPageIndex;
    if (this.#shouldAnimatePageTurn()) {
      const span = Math.abs(turn.targetLogicalOffset - turn.originLogicalOffset);
      const targetLogicalOffset = commit ? turn.targetLogicalOffset : turn.originLogicalOffset;
      const remaining = Math.abs(targetLogicalOffset - currentLogicalOffset(pagination));
      const duration = span > 0 ? this.#pageTurnDurationMs() * Math.min(1, remaining / span) : 0;
      move.animation = animateScrollToPage(
        pagination,
        targetPageIndex,
        duration,
        this.#container.ownerDocument.defaultView ?? undefined,
      );
      await move.animation.finished;
    } else scrollToPage(pagination, targetPageIndex);

    if (this.#pageMove !== move) return false;
    try {
      await this.#finishPageMove(move.mount, move, commit);
    } catch (cause) {
      if (this.#pageMove === move) throw cause;
    } finally {
      if (this.#pageMove === move) this.#pageMove = undefined;
    }
    return commit;
  }

  cancelInteractivePageTurn(): Promise<boolean> {
    return this.endInteractivePageTurn(false);
  }

  async setPreferences(update: NavigatorPreferences): Promise<Relocation | undefined> {
    this.#assertLive();
    this.#cancelPageMove(true);
    this.#preferences = mergePreferences(this.#preferences, update);
    const mount = this.#active;
    const signal = this.#operation?.signal;
    const document = mount?.frame.contentDocument;
    if (!mount || !signal || signal.aborted || !document || this.#state !== "settled") {
      return this.#relocation;
    }
    const anchor = mount.visibleAnchor ?? captureFirstVisibleElement(document);
    this.#setState("settling");
    try {
      await this.#settle(mount, undefined, signal, anchor);
    } catch (cause) {
      if (this.#active === mount && !signal.aborted && !this.#destroyed) this.#setState("settled");
      throw cause;
    }
    if (this.#active !== mount || signal.aborted || this.#destroyed) return this.#relocation;
    this.#setState("settled");
    return this.#emitRelocation(mount, anchor);
  }

  /**
   * Restore a DOM Range within the already-mounted section.
   * Paginated mode maps the range's layout box to a column index with floor()
   * (no scrollIntoView, no temporary markers) so restore is not off-by-one.
   */
  async restoreRange(range: Range): Promise<Relocation> {
    this.#assertLive();
    const mount = this.#active;
    const document = mount?.frame.contentDocument;
    if (!mount || !document || this.#state !== "settled") {
      throw new Error("No settled publication section is mounted");
    }
    if (range.startContainer.ownerDocument !== document) {
      throw new TypeError("Range must belong to the mounted section document");
    }
    if (
      !this.allowsMovement("restore") ||
      (mount.contentRange && !rangeContainsRange(contentRange(document, mount.contentRange), range))
    )
      return this.#relocation!;

    const anchor =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : (range.startContainer.parentElement ?? undefined);

    if (mount.pagination) {
      // Measure the range in the current layout (typically scroll=0 after display)
      // and jump to that column. floor(x/stride) is the column that contains x.
      alignPaginationToRange(mount.pagination, range);
      return this.#emitRelocation(mount, anchor);
    }

    // Scrolled mode: bring the range's container into view.
    anchor?.scrollIntoView({ block: "start", inline: "nearest" });
    return this.#emitRelocation(mount, anchor);
  }

  /**
   * Jump to the paginated column that matches a stored section-local progression.
   * Inverse of paginatedProgression: pageIndex = round(local * (pageCount - 1)).
   * Prefer this over CFI geometry when both were saved together.
   */
  restoreProgression(localProgression: number): Relocation {
    this.#assertLive();
    const mount = this.#active;
    if (!mount || this.#state !== "settled") {
      throw new Error("No settled publication section is mounted");
    }
    if (!this.allowsMovement("restore")) return this.#relocation!;
    if (!mount.pagination) {
      const scrolling =
        mount.frame.contentDocument!.scrollingElement ??
        mount.frame.contentDocument!.documentElement;
      scrolling.scrollTop =
        bounded(localProgression) * Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
      return this.#emitRelocation(mount, captureFirstVisibleElement(mount.frame.contentDocument!));
    }
    const state = mount.pagination;
    const local = Math.min(
      1,
      Math.max(0, Number.isFinite(localProgression) ? localProgression : 0),
    );
    const page = state.pageCount <= 1 ? 0 : Math.round(local * (state.pageCount - 1));
    scrollToPage(state, Math.floor(page / state.pagesPerSpread) * state.pagesPerSpread);
    return this.#emitRelocation(mount, captureFirstVisibleElement(mount.frame.contentDocument!));
  }

  /**
   * Emit a relocation for the current scroll position without changing it.
   */
  reportRelocation(): Relocation {
    this.#assertLive();
    const mount = this.#active;
    const document = mount?.frame.contentDocument;
    if (!mount || !document || this.#state !== "settled") {
      throw new Error("No settled publication section is mounted");
    }
    return this.#emitRelocation(mount, captureFirstVisibleElement(document));
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#cancelPageMove(false);
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
    documentKey: number | string,
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
        preferenceCss: buildPreferenceCss(this.#preferences),
      });
      documentLease = await this.#urlManager.acquireGenerated(
        `section:${documentKey}:${href}`,
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

  #mount(
    prepared: PreparedSection,
    operationId: number,
    outgoing: SectionMount | undefined,
  ): SectionMount {
    const overlay = outgoing !== undefined;
    const frame = this.#container.ownerDocument.createElement("iframe");
    frame.setAttribute("sandbox", CONTENT_IFRAME_SANDBOX);
    frame.setAttribute("title", `Publication section ${prepared.spineIndex + 1}`);
    frame.style.border = "0";
    frame.style.display = "block";
    frame.style.height = "100%";
    frame.style.width = "100%";
    if (outgoing) {
      const outgoingRect = outgoing.frame.getBoundingClientRect();
      const width = outgoingRect.width || outgoing.frame.clientWidth;
      const height = outgoingRect.height || outgoing.frame.clientHeight;
      frame.style.inset = "0";
      frame.style.position = "absolute";
      frame.style.visibility = "hidden";
      frame.style.zIndex = "1";
      if (width > 0) {
        frame.style.maxWidth = `${width}px`;
        frame.style.minWidth = `${width}px`;
      }
      if (height > 0) {
        frame.style.maxHeight = `${height}px`;
        frame.style.minHeight = `${height}px`;
      }
    }
    // Even the first mount must be clipped and positioned before it can paint.
    frame.style.visibility = "hidden";
    frame.src = prepared.documentLease.url;
    const mount: SectionMount = { ...prepared, operationId, frame, overlaid: overlay };
    if (overlay) this.#beginOverlay();
    return mount;
  }

  #beginOverlay(): void {
    this.#overlayCount += 1;
    if (
      this.#overlayCount === 1 &&
      this.#container.ownerDocument.defaultView?.getComputedStyle(this.#container).position ===
        "static"
    ) {
      this.#containerPosition = this.#container.style.position;
      this.#container.style.position = "relative";
    }
  }

  #revealMount(mount: SectionMount): void {
    mount.frame.style.visibility = "visible";
    if (!mount.overlaid) return;
    this.#releaseOverlay(mount);
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
    anchor?: Element,
  ): Promise<void> {
    const view = mount.frame.contentWindow;
    if (!view) throw new Error("Publication section document is inaccessible");
    mount.pagination = await settleSection({
      frame: mount.frame,
      container: this.#container,
      preferences: this.#preferences,
      direction:
        this.publication.metadata.pageProgressionDirection === "rtl" ||
        (this.publication.metadata.pageProgressionDirection !== "ltr" &&
          this.publication.metadata.direction === "rtl")
          ? "rtl"
          : "ltr",
      fragment,
      anchor,
      signal,
      timeoutMs: this.#settleTimeoutMs,
    });
    mount.settledWidth = mount.frame.clientWidth;
    mount.settledHeight = mount.frame.clientHeight;
    this.#installScrollListener(mount, view);
  }

  #installScrollListener(mount: SectionMount, view: Window): void {
    mount.removeScrollListener?.();
    const document = mount.frame.contentDocument!;
    const scrolling = document.scrollingElement ?? document.documentElement;
    mount.scrollTop = scrolling.scrollTop;
    // WebKit may block callbacks scheduled in a sandboxed publication frame. The
    // listener still observes the publication window, but its coalescing frame
    // belongs to the trusted host document.
    const scheduler = this.#container.ownerDocument.defaultView ?? view;
    mount.scrollScheduler = scheduler;
    const scroll = () => {
      if (
        this.#active !== mount ||
        this.#state !== "settled" ||
        this.#pageMove?.mount === mount ||
        mount.scrollFrame !== undefined
      )
        return;
      mount.scrollFrame = scheduler.requestAnimationFrame(() => {
        mount.scrollFrame = undefined;
        if (
          this.#active === mount &&
          this.#state === "settled" &&
          this.#pageMove?.mount !== mount
        ) {
          this.#emitRelocation(mount);
          const previousScrollTop = mount.scrollTop ?? 0;
          mount.scrollTop = scrolling.scrollTop;
          if (
            !mount.pagination &&
            scrolling.scrollTop > previousScrollTop &&
            scrolling.scrollTop + scrolling.clientHeight >= scrolling.scrollHeight - 1
          )
            this.#scrollBoundary(mount, "next");
        }
      });
    };
    const wheel = (event: WheelEvent) => {
      if (!mount.pagination && event.deltaY !== 0)
        this.#scrollBoundary(mount, event.deltaY > 0 ? "next" : "previous");
    };
    let touchY: number | undefined;
    const touchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY;
    };
    const touchEnd = (event: TouchEvent) => {
      const end = event.changedTouches[0]?.clientY;
      if (
        !mount.pagination &&
        touchY !== undefined &&
        end !== undefined &&
        Math.abs(end - touchY) > 20
      )
        this.#scrollBoundary(mount, end < touchY ? "next" : "previous");
      touchY = undefined;
    };
    view.addEventListener("scroll", scroll, true);
    view.addEventListener("wheel", wheel, { passive: true });
    view.addEventListener("touchstart", touchStart, { passive: true });
    view.addEventListener("touchend", touchEnd, { passive: true });
    mount.removeScrollListener = () => {
      view.removeEventListener("scroll", scroll, true);
      view.removeEventListener("wheel", wheel);
      view.removeEventListener("touchstart", touchStart);
      view.removeEventListener("touchend", touchEnd);
    };
  }

  #installInternalLinkListener(mount: SectionMount): void {
    const document = mount.frame.contentDocument;
    if (!document) return;
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const target = event.target as Node | null;
      const element = target?.nodeType === 1 ? (target as Element) : target?.parentElement;
      const href = element
        ?.closest(`a[${INTERNAL_LINK_ATTRIBUTE}]`)
        ?.getAttribute(INTERNAL_LINK_ATTRIBUTE);
      if (href === null || href === undefined) return;
      event.preventDefault();
      try {
        void this.display({ href: normalizePublicationPath(href) }).catch(() => {});
      } catch {}
    };
    document.addEventListener("click", click, true);
    mount.removeInternalLinkListener = () => document.removeEventListener("click", click, true);
  }

  #emitRelocation(mount: SectionMount, visibleAnchor?: Element): Relocation {
    const document = mount.frame.contentDocument;
    if (!document) throw new Error("Publication section document is inaccessible");
    const scrolling = document.scrollingElement ?? document.documentElement;
    const extent = Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
    const localProgression = mount.pagination
      ? paginatedProgression(mount.pagination)
      : bounded(extent === 0 ? 0 : scrolling.scrollTop / extent);
    const count = this.publication.readingOrder.length;
    const relocation: Relocation = {
      href: mount.href,
      spineIndex: mount.spineIndex,
      localProgression,
      totalProgression: count === 0 ? 0 : bounded((mount.spineIndex + localProgression) / count),
    };
    this.#relocation = relocation;
    if (
      visibleAnchor ||
      (mount.frame.clientWidth === mount.settledWidth &&
        mount.frame.clientHeight === mount.settledHeight)
    ) {
      mount.visibleAnchor = visibleAnchor ?? captureFirstVisibleElement(document);
    }
    this.dispatchEvent(new CustomEvent<Relocation>("relocation", { detail: relocation }));
    return relocation;
  }

  async #redisplayMounted(
    mount: SectionMount,
    fragment: string | undefined,
    target: DisplayTarget,
  ): Promise<Relocation> {
    const operationId = ++this.#operationId;
    this.#operation?.abort();
    const controller = new AbortController();
    this.#operation = controller;
    // Keep the same mount object but bind it to this operation for abort checks.
    mount.operationId = operationId;
    this.#setState("settling");
    try {
      const document = mount.frame.contentDocument;
      if (!document) throw new Error("Publication section document is inaccessible");
      // Preserve position when redisplaying the same section without a fragment
      // (e.g. CFI restore after layout). Fragments still scroll via settleSection.
      const anchor = fragment
        ? undefined
        : (mount.visibleAnchor ?? captureFirstVisibleElement(document));
      await this.#settle(mount, fragment, controller.signal, anchor);
      this.#assertCurrent(operationId, controller.signal);
      if (this.#navigationPolicy && !this.#navigationPolicy.allowCommit(target)) throw abortError();
      this.#positionMount(mount, target);
      this.#setState("settled");
      return this.#emitRelocation(mount, anchor);
    } catch (cause) {
      if (this.#operationId === operationId && !this.#destroyed && this.#active === mount) {
        this.#setState("settled");
      }
      if (controller.signal.aborted) throw abortError();
      throw cause;
    }
  }

  #scheduleResizeSettle(size?: Pick<DOMRectReadOnly, "width" | "height">): void {
    if ((size && (size.width <= 0 || size.height <= 0)) || !hasLayoutSize(this.#container)) return;
    this.#cancelPageMove(true);
    if (this.#resizeQueued || this.#destroyed || !this.#active || this.#state !== "settled") return;
    this.#resizeQueued = true;
    queueMicrotask(() => {
      this.#resizeQueued = false;
      const mount = this.#active;
      const signal = this.#operation?.signal;
      if (!mount || !signal || signal.aborted || this.#destroyed || !hasLayoutSize(this.#container))
        return;
      const anchor =
        mount.visibleAnchor ??
        (mount.frame.contentDocument
          ? captureFirstVisibleElement(mount.frame.contentDocument)
          : undefined);
      this.#setState("settling");
      void this.#settle(mount, undefined, signal, anchor)
        .then(() => {
          if (this.#active !== mount || signal.aborted || this.#destroyed) return;
          this.#setState("settled");
          this.#emitRelocation(mount, anchor);
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
    mount.removeInternalLinkListener?.();
    mount.removeScrollListener?.();
    if (mount.scrollFrame !== undefined)
      mount.scrollScheduler?.cancelAnimationFrame(mount.scrollFrame);
    this.#releaseOverlay(mount);
    mount.frame.remove();
    if (this.#active === mount) this.#active = undefined;
    queueMicrotask(() => {
      mount.documentLease.dispose();
      mount.scope.dispose();
    });
  }

  #releaseOverlay(mount: SectionMount): void {
    if (!mount.overlaid) return;
    mount.overlaid = false;
    mount.frame.style.inset = "";
    mount.frame.style.maxHeight = "";
    mount.frame.style.maxWidth = "";
    mount.frame.style.minHeight = "";
    mount.frame.style.minWidth = "";
    mount.frame.style.opacity = "";
    mount.frame.style.pointerEvents = "";
    mount.frame.style.position = "";
    mount.frame.style.transform = "";
    mount.frame.style.transition = "";
    mount.frame.style.visibility = "";
    mount.frame.style.willChange = "";
    mount.frame.style.zIndex = "";
    this.#overlayCount -= 1;
    if (this.#overlayCount === 0 && this.#containerPosition !== undefined) {
      this.#container.style.position = this.#containerPosition;
      this.#containerPosition = undefined;
    }
  }

  async #moveToPage(mount: SectionMount, pageIndex: number): Promise<void> {
    if (mount.scrollFrame !== undefined) {
      mount.scrollScheduler?.cancelAnimationFrame(mount.scrollFrame);
      mount.scrollFrame = undefined;
    }
    const move: ActivePageMove = { mount, snapPageIndex: pageIndex };
    this.#pageMove = move;
    if (this.#shouldAnimatePageTurn()) {
      move.animation = animateScrollToPage(
        mount.pagination!,
        pageIndex,
        this.#pageTurnDurationMs(),
        this.#container.ownerDocument.defaultView ?? undefined,
      );
      await move.animation.finished;
    } else scrollToPage(mount.pagination!, pageIndex);
    if (this.#pageMove !== move) return;
    try {
      await this.#finishPageMove(mount, move);
    } catch (cause) {
      if (this.#pageMove === move) throw cause;
    } finally {
      if (this.#pageMove === move) this.#pageMove = undefined;
    }
  }

  #cancelPageMove(snapToTarget: boolean): void {
    const move = this.#pageMove;
    if (!move) return;
    this.#pageMove = undefined;
    const interactive = move.interactive;
    if (interactive?.kind === "spine") return;
    if (interactive?.kind === "edge") {
      this.#clearInteractiveFrameStyles(move.mount.frame);
      move.animation?.cancel(false);
      return;
    }
    if (move.animation) move.animation.cancel(snapToTarget);
    else if (snapToTarget && move.mount.pagination)
      scrollToPage(move.mount.pagination, move.snapPageIndex);
  }

  async #endSpineInteractiveTurn(
    move: ActivePageMove,
    turn: SpineInteractiveTurn,
    commit: boolean,
  ): Promise<boolean> {
    if (this.#pageMove !== move || this.#active !== move.mount) return false;
    this.#pageMove = undefined;
    if (!commit) return false;
    const target = this.#boundaryTarget(turn.direction);
    if (target === false) return false;
    if (target) {
      await this.display(target);
      return true;
    }
    await this.#display({ spineIndex: turn.targetSpineIndex }, turn.direction === "previous");
    return true;
  }

  #boundaryTarget(direction: "next" | "previous") {
    if (!this.#navigationPolicy) return undefined;
    // A rapid turn may have snapped a pending animation to its destination.
    // Capture that actual page before the host records its return locator.
    if (this.#active && this.#state === "settled") this.#emitRelocation(this.#active);
    return this.#relocation
      ? this.#navigationPolicy?.boundary(direction, this.#relocation)
      : undefined;
  }

  #scrollBoundary(mount: SectionMount, direction: "next" | "previous"): void {
    if (
      !this.#navigationPolicy ||
      this.#active !== mount ||
      this.#state !== "settled" ||
      !this.allowsMovement(direction)
    )
      return;
    const document = mount.frame.contentDocument!;
    const scrolling = document.scrollingElement ?? document.documentElement;
    if (
      direction === "next"
        ? scrolling.scrollTop + scrolling.clientHeight < scrolling.scrollHeight - 1
        : scrolling.scrollTop > 1
    )
      return;
    const target = this.#boundaryTarget(direction);
    if (target === false) return;
    const spineIndex = mount.spineIndex + (direction === "next" ? 1 : -1);
    if (!target && !this.publication.readingOrder[spineIndex]) return;
    void this.display(
      target ?? { spineIndex, position: direction === "next" ? "start" : "end" },
    ).catch(() => {});
  }

  #positionMount(mount: SectionMount, target: DisplayTarget): void {
    const document = mount.frame.contentDocument!;
    const scrolling = document.scrollingElement ?? document.documentElement;
    if (target.localProgression !== undefined || target.position) {
      const local =
        target.position === "end"
          ? 1
          : target.position === "start"
            ? 0
            : bounded(target.localProgression!);
      if (mount.pagination) {
        const state = mount.pagination;
        // Measure the endpoint from the origin: the root's client rect itself
        // shifts with horizontal scroll in some browsers.
        const page = target.position === "end" ? 0 : Math.round(local * (state.pageCount - 1));
        scrollToPage(state, Math.floor(page / state.pagesPerSpread) * state.pagesPerSpread);
        // Browser column overflow can include an empty terminal column. An
        // explicit end target restores the last rendered source box instead.
        const end = target.position === "end" ? lastRenderedRange(document) : undefined;
        if (end) alignPaginationToRange(state, end);
        else if (target.position === "end")
          scrollToPage(
            state,
            Math.floor((state.pageCount - 1) / state.pagesPerSpread) * state.pagesPerSpread,
          );
      } else
        scrolling.scrollTop = local * Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
    } else if (target.cfi) {
      const range = resolveCfi(target.cfi, document, { spineIndex: mount.spineIndex });
      if (
        !range ||
        (mount.contentRange &&
          !rangeContainsRange(contentRange(document, mount.contentRange), range))
      )
        throw new RangeError("CFI could not be resolved inside its content range");
      if (mount.pagination) alignPaginationToRange(mount.pagination, range);
      else {
        const rect = range.getBoundingClientRect();
        scrolling.scrollTop += rect.top;
      }
    }
    // A programmatic arrival at a prior chapter/spine end is a restore, not
    // forward scrolling. Its queued native scroll event must not advance again.
    mount.scrollTop = scrolling.scrollTop;
  }

  #applyEdgeTransform(move: ActivePageMove, displacement: number): void {
    const turn = move.interactive;
    if (!turn || turn.kind !== "edge") return;
    move.mount.frame.style.transform = `translate3d(${displacement}px, 0, 0)`;
  }

  async #settleEdgeTurn(move: ActivePageMove, displacement: number): Promise<void> {
    const turn = move.interactive;
    if (!turn || turn.kind !== "edge") return;
    const width = move.mount.pagination?.viewportWidth ?? move.mount.frame.clientWidth;
    const remaining = Math.abs(displacement - turn.displacement);
    const duration =
      this.#shouldAnimatePageTurn() && width > 0
        ? this.#pageTurnDurationMs() * Math.min(1, remaining / width)
        : 0;
    if (duration > 0) {
      const transition = `transform ${duration}ms ease-out`;
      move.mount.frame.style.transition = transition;
    }
    turn.displacement = displacement;
    this.#applyEdgeTransform(move, displacement);
    if (duration === 0) return;
    await new Promise<void>((resolve) => {
      const view = this.#container.ownerDocument.defaultView;
      if (!view) {
        resolve();
        return;
      }
      view.setTimeout(resolve, duration);
    });
  }

  #clearInteractiveFrameStyles(frame: HTMLIFrameElement): void {
    frame.style.transform = "";
    frame.style.transition = "";
    frame.style.willChange = "";
  }

  #shouldAnimatePageTurn(): boolean {
    if (this.#preferences.pageTurnAnimation !== "slide" || this.#pageTurnDurationMs() === 0)
      return false;
    return !this.#container.ownerDocument.defaultView?.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
  }

  #pageTurnDurationMs(): number {
    const duration = this.#preferences.pageTurnDurationMs ?? DEFAULT_PAGE_TURN_DURATION_MS;
    return Number.isFinite(duration) ? Math.max(0, duration) : DEFAULT_PAGE_TURN_DURATION_MS;
  }

  async #finishPageMove(
    mount: SectionMount,
    move?: ActivePageMove,
    emitRelocation = true,
  ): Promise<void> {
    const view = this.#container.ownerDocument.defaultView;
    const signal = this.#operation?.signal;
    if (!view || !signal) return;
    await nextAnimationFrame(view, signal);
    if (
      emitRelocation &&
      this.#active === mount &&
      !signal.aborted &&
      !this.#destroyed &&
      (!move || this.#pageMove === move)
    )
      this.#emitRelocation(mount);
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
