import {
  createCfi,
  createDecorationLayer,
  generateCfi,
  generateEphemeralPositions,
  normalizePublicationPath,
  parseNavigationDocument,
  parseNcx,
  parseCfi,
  resolveCfi,
  type Navigator,
  type Decoration,
  type DecorationClickDetail,
  type DecorationLayer,
  type Locator,
  type PersistentLocator,
  type Publication,
  type PublicationPath,
  type Relocation,
  type ResourceProvider,
  type SectionMetadata,
  type SelectionChangedDetail,
  type TocEntry,
} from "@readmaxxing/epub-successor";

const POSITION_CACHE_KIND = "epub-successor-positions";
/** Bumped when position sampling semantics change (empty-section skip, chars/page). */
const POSITION_CACHE_VERSION = 3;
/** Character samples used as page analogues when no publisher page-list exists. */
const HEURISTIC_CHARS_PER_PAGE = 2_500;

export interface SuccessorPositionCache {
  readonly kind: typeof POSITION_CACHE_KIND;
  readonly version: typeof POSITION_CACHE_VERSION;
  readonly positions: readonly PersistentLocator[];
}

export function parseSuccessorPositionCache(value: string | null): SuccessorPositionCache | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("kind" in parsed) ||
      parsed.kind !== POSITION_CACHE_KIND ||
      !("version" in parsed) ||
      parsed.version !== POSITION_CACHE_VERSION ||
      !("positions" in parsed) ||
      !Array.isArray(parsed.positions)
    ) {
      return null;
    }
    return parsed as unknown as SuccessorPositionCache;
  } catch {
    return null;
  }
}

export function serializeSuccessorPositionCache(positions: readonly PersistentLocator[]): string {
  return JSON.stringify({ kind: POSITION_CACHE_KIND, version: POSITION_CACHE_VERSION, positions });
}

function bareHref(value: string): string {
  return value.split("#")[0]?.replace(/^\/+/, "") ?? "";
}

function positionHrefsMatch(left: string, right: string): boolean {
  const normalizedLeft = bareHref(left);
  const normalizedRight = bareHref(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function positionSpineIndex(position: PersistentLocator): number | null {
  const cfi = position.locations.cfi;
  return cfi !== undefined ? spineIndexFromCfi(cfi) : null;
}

/**
 * Maps a reading location onto character-sampled positions (1-based page index).
 *
 * Totals come from character-sampled positions (stable across layout). The current page
 * advances with `localProgression` inside the active spine section so page-turns update
 * the displayed number.
 */
export function pageIndexFromPositions(
  positions: readonly PersistentLocator[],
  options: {
    readonly href: string;
    readonly cfi?: string;
    readonly spineIndex?: number;
    readonly textOffset?: number | null;
    readonly localProgression?: number;
  },
): number | null {
  if (positions.length === 0) return null;

  const sectionIndexes: number[] = [];
  for (let index = 0; index < positions.length; index += 1) {
    if (positionHrefsMatch(positions[index]!.href, options.href)) {
      sectionIndexes.push(index);
    }
  }

  // Fall back to spine index when href matching fails (path normalization drift).
  if (sectionIndexes.length === 0) {
    const spineIndex = options.spineIndex ?? (options.cfi ? spineIndexFromCfi(options.cfi) : null);
    if (spineIndex !== null) {
      for (let index = 0; index < positions.length; index += 1) {
        if (positionSpineIndex(positions[index]!) === spineIndex) sectionIndexes.push(index);
      }
    }
    if (sectionIndexes.length === 0) {
      if (spineIndex === null) return 1;
      let best = 0;
      for (let index = 0; index < positions.length; index += 1) {
        const positionSpine = positionSpineIndex(positions[index]!);
        if (positionSpine !== null && positionSpine <= spineIndex) best = index;
        if (positionSpine !== null && positionSpine > spineIndex) break;
      }
      return best + 1;
    }
  }

  const first = sectionIndexes[0]!;
  const last = sectionIndexes[sectionIndexes.length - 1]!;
  // Single-sample sections still need room to advance toward the next sample while paging.
  const high = last > first ? last : Math.min(positions.length - 1, first + 1);

  if (options.localProgression !== undefined) {
    const local = Math.max(0, Math.min(1, options.localProgression));
    // At section start keep the first sample; only move once progression advances.
    if (local <= 0) return first + 1;
    return Math.min(positions.length, Math.round(first + local * (high - first)) + 1);
  }

  if (options.textOffset !== null && options.textOffset !== undefined) {
    const offset = Math.max(0, options.textOffset);
    let best = first;
    for (const index of sectionIndexes) {
      if (positions[index]!.selectors.textPosition.start <= offset) best = index;
      else break;
    }
    return best + 1;
  }

  return first + 1;
}

function sectionMetadata(publication: Publication, spineIndex: number): SectionMetadata {
  const link = publication.readingOrder[spineIndex]!;
  return {
    href: link.href,
    spineIndex,
    spineLength: publication.readingOrder.length,
    ...(link.mediaType ? { mediaType: link.mediaType } : {}),
    ...(link.title ? { title: link.title } : {}),
  };
}

export async function generateSuccessorPositions(
  publication: Publication,
  provider: ResourceProvider,
): Promise<readonly PersistentLocator[]> {
  const sections = [];
  for (let spineIndex = 0; spineIndex < publication.readingOrder.length; spineIndex += 1) {
    const metadata = sectionMetadata(publication, spineIndex);
    const source = await provider.readText(metadata.href);
    const document = new DOMParser().parseFromString(source, "application/xhtml+xml");
    if (document.getElementsByTagName("parsererror").length === 0) {
      sections.push({ document, metadata });
    }
  }
  return generateEphemeralPositions(sections, HEURISTIC_CHARS_PER_PAGE);
}

function withoutDocumentType(source: string): string {
  return source.replace(/<!DOCTYPE[^>]*>/i, "");
}

export async function extractCompatibleToc(
  publication: Publication,
  provider: ResourceProvider,
): Promise<readonly TocEntry[]> {
  if (publication.toc.length > 0) return publication.toc;
  const navigation = publication.resources.find((link) => link.properties.includes("nav"));
  if (navigation) {
    const source = withoutDocumentType(await provider.readText(navigation.href));
    const parsed = parseNavigationDocument(source, navigation.href);
    if (parsed.toc.length > 0) return parsed.toc;
  }
  const ncx = publication.resources.find(
    (link) => link.mediaType === "application/x-dtbncx+xml" || link.href.endsWith(".ncx"),
  );
  if (!ncx) return [];
  return parseNcx(withoutDocumentType(await provider.readText(ncx.href)), ncx.href).toc;
}

function spineQualifiedPrefix(cfi: string): string | null {
  const source = cfi.trim();
  if (!source.startsWith("epubcfi(") || !source.endsWith(")")) return null;
  let assertionDepth = 0;
  let escaped = false;
  for (let index = 8; index < source.length - 1; index += 1) {
    const character = source[index];
    if (escaped) escaped = false;
    else if (character === "^") escaped = true;
    else if (character === "[") assertionDepth += 1;
    else if (character === "]") {
      if (assertionDepth === 0) return null;
      assertionDepth -= 1;
    } else if (character === "!" && assertionDepth === 0) {
      return `${source.slice(0, index + 1)}/4)`;
    }
  }
  return null;
}

export function spineIndexFromCfi(cfi: string): number | null {
  try {
    let parsed;
    try {
      parsed = parseCfi(cfi);
    } catch {
      const prefix = spineQualifiedPrefix(cfi);
      if (!prefix) return null;
      parsed = parseCfi(prefix);
    }
    const step = parsed.packagePath?.steps.at(-1);
    if (!step || step.number % 2 !== 0) return null;
    const index = step.number / 2 - 1;
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
}

function firstTextNode(root: Node): Text | null {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, 4);
  return walker.nextNode() as Text | null;
}

/**
 * Resolves ascending, non-overlapping text spans to range boundaries in
 * one tree walk. Spans outside the text content resolve to null. Returns
 * static boundary objects rather than live Ranges because generateCfi
 * only reads the boundary points, and Range.setEnd on DOMParser-parsed
 * documents collapses the range in happy-dom.
 */
function rangesAtTextSpans(
  document: Document,
  root: Node,
  spans: ReadonlyArray<readonly [number, number]>,
): Array<Range | null> {
  const ranges: Array<Range | null> = spans.map(() => null);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let position = 0;
  let spanIndex = 0;
  let pendingStart: { node: Text; offset: number } | null = null;
  let node = walker.nextNode() as Text | null;
  while (node && spanIndex < spans.length) {
    const nodeEnd = position + node.length;
    while (spanIndex < spans.length) {
      const [start, end] = spans[spanIndex];
      if (pendingStart === null) {
        if (start > nodeEnd) break;
        pendingStart = { node, offset: start - position };
      }
      if (end > nodeEnd) break;
      ranges[spanIndex] = {
        startContainer: pendingStart.node,
        startOffset: pendingStart.offset,
        endContainer: node,
        endOffset: end - position,
      } as unknown as Range;
      pendingStart = null;
      spanIndex += 1;
    }
    position = nodeEnd;
    node = walker.nextNode() as Text | null;
  }
  return ranges;
}

function rangeAtCaret(document: Document, x: number, y: number): Range | null {
  const extended = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const caret = extended.caretRangeFromPoint?.(x, y);
  if (caret?.startContainer && document.contains(caret.startContainer)) return caret;
  const position = extended.caretPositionFromPoint?.(x, y);
  if (!position?.offsetNode || !document.contains(position.offsetNode)) return null;
  try {
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  } catch {
    return null;
  }
}

function firstVisibleElement(document: Document): Element | undefined {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  return Array.from(document.body?.querySelectorAll("*") ?? []).find((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < width &&
      rect.top < height
    );
  });
}

/**
 * Range at the start of the currently visible page/viewport. Samples several
 * content-area points (not just 1,1 which often hits page chrome/padding) and
 * falls back to the first visible element — never the first text of the whole
 * section, which would pin every save to chapter start.
 */
function visibleRange(document: Document): Range {
  const root = document.documentElement;
  const width = Math.max(1, root.clientWidth);
  const height = Math.max(1, root.clientHeight);
  // Prefer near top-left of the visible page, but past typical body chrome so
  // caretRangeFromPoint does not miss into empty padding and fall back wrongly.
  const points: ReadonlyArray<readonly [number, number]> = [
    [Math.min(20, width * 0.06), Math.min(28, height * 0.08)],
    [Math.min(36, width * 0.1), Math.min(40, height * 0.1)],
    [Math.min(48, width * 0.12), Math.min(48, height * 0.12)],
  ];
  for (const [x, y] of points) {
    const range = rangeAtCaret(document, x, y);
    if (!range) continue;
    // Reject carets that land outside the viewport (some engines snap to
    // document-start text when the probe hits chrome/padding).
    try {
      const rect = range.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.right >= 0 && rect.top <= height && rect.left <= width) {
        return range;
      }
    } catch {
      return range;
    }
  }

  const visible = firstVisibleElement(document);
  const text = visible ? firstTextNode(visible) : null;
  const fallbackRoot = document.body ?? document.documentElement;
  const range = document.createRange();
  if (text) {
    range.setStart(text, 0);
  } else if (visible) {
    range.setStart(visible, 0);
  } else {
    range.setStart(firstTextNode(fallbackRoot) ?? fallbackRoot, 0);
  }
  range.collapse(true);
  return range;
}

function cfiForRelocation(
  publication: Publication,
  navigator: Navigator,
  relocation: Relocation,
): string {
  const document = navigator.contentDocument;
  if (!document) return `epubcfi(/6/${(relocation.spineIndex + 1) * 2}!/4)`;
  try {
    return generateCfi(visibleRange(document), sectionMetadata(publication, relocation.spineIndex));
  } catch {
    return `epubcfi(/6/${(relocation.spineIndex + 1) * 2}!/4)`;
  }
}

function hrefsMatch(left: string, right: string): boolean {
  const bare = (value: string) => value.split("#")[0]?.replace(/^\/+/, "") ?? "";
  const normalizedLeft = bare(left);
  const normalizedRight = bare(right);
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

interface CompatibilityContent {
  readonly document: Document;
  range(cfi: string): Range | null;
}

interface CompatibilityLocation {
  readonly start: {
    readonly cfi: string;
    readonly percentage: number;
    readonly displayed: { readonly page: number; readonly total: number };
    readonly index: number;
    readonly href: string;
  };
}

export class SuccessorRenditionAdapter {
  readonly themes = {
    register: (..._arguments: unknown[]) => undefined,
    select: (theme: string) => {
      if (theme === "light" || theme === "dark" || theme === "sepia") {
        void this.navigator.setPreferences({ theme }).catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.error("Failed to update reader theme", error);
          }
        });
      }
    },
  };
  readonly hooks = {
    content: {
      register: (callback: (content: CompatibilityContent) => void) => {
        this.#contentHooks.add(callback);
        const content = this.#content();
        if (content) callback(content);
      },
    },
  };
  readonly #contentHooks = new Set<(content: CompatibilityContent) => void>();
  readonly #decorations = new Map<string, Decoration>();
  readonly #eventHandlers = new Map<string, Set<(...arguments_: any[]) => void>>();
  #decorationDocument: Document | null = null;
  #decorationLayer: DecorationLayer | null = null;
  #decorationSpineIndex: number | null = null;
  #location: CompatibilityLocation | undefined;

  constructor(
    readonly publication: Publication,
    readonly navigator: Navigator,
  ) {
    navigator.addEventListener("relocation", (event) => {
      const relocation = (event as CustomEvent<Relocation>).detail;
      this.#location = this.#compatibilityLocation(relocation);
      const mountedNewDocument = this.#mountDecorationLayer(relocation);
      const content = this.#content();
      if (content && mountedNewDocument) {
        for (const callback of this.#contentHooks) callback(content);
      }
      this.#emit("relocated", this.#location);
    });
  }

  get location() {
    return this.#location;
  }

  get contentDocument(): Document | null {
    return this.navigator.contentDocument;
  }

  currentLocation() {
    return this.#location;
  }

  async display(
    target?: string | number,
    options?: { readonly localProgression?: number },
  ): Promise<Relocation> {
    if (target === undefined) return this.navigator.display({ spineIndex: 0 });
    if (typeof target === "number") return this.navigator.display({ spineIndex: target });
    if (target.trim().startsWith("epubcfi(")) return this.#displayCfi(target, options);
    const link = this.publication.readingOrder.find((candidate) =>
      hrefsMatch(candidate.href, target),
    );
    if (!link) throw new RangeError(`Publication spine does not contain ${target}`);
    const fragment = target.includes("#") ? target.slice(target.indexOf("#") + 1) : undefined;
    return this.navigator.display({ href: link.href, ...(fragment ? { fragment } : {}) });
  }

  next() {
    return this.navigator.next();
  }

  prev() {
    return this.navigator.previous();
  }

  resize() {
    void this.navigator.setPreferences({}).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Failed to resize reader", error);
      }
    });
  }

  destroy() {
    this.#decorationLayer?.destroy();
    this.#decorationDocument = null;
    this.#decorationLayer = null;
    this.#decorationSpineIndex = null;
    this.#decorations.clear();
    this.navigator.destroy();
  }

  locatorFromCfi(cfi: string, text?: string): Locator | null {
    const spineIndex = spineIndexFromCfi(cfi);
    if (spineIndex === null) return null;
    const link = this.publication.readingOrder[spineIndex];
    if (!link) return null;
    try {
      return {
        href: link.href,
        ...(link.mediaType ? { mediaType: link.mediaType } : {}),
        ...(link.title ? { title: link.title } : {}),
        locations: {
          progression: 0,
          totalProgression: spineIndex / this.publication.readingOrder.length,
          cfi: createCfi(cfi),
        },
        text: text ? { highlight: text } : {},
      };
    } catch {
      return null;
    }
  }

  upsertDecoration(decoration: Decoration): void {
    const existed = this.#decorations.has(decoration.id);
    this.#decorations.set(decoration.id, decoration);
    const relocation = this.navigator.currentRelocation;
    if (!relocation || decoration.locator.href !== relocation.href || !this.#decorationLayer)
      return;
    const resolved = existed
      ? this.#decorationLayer.update(decoration)
      : this.#decorationLayer.add(decoration);
    if (!resolved) this.#warnUnresolvable(decoration);
  }

  removeDecoration(id: string): boolean {
    const removed = this.#decorations.delete(id);
    this.#decorationLayer?.remove(id);
    return removed;
  }

  getContents(): CompatibilityContent[] {
    const content = this.#content();
    return content ? [content] : [];
  }

  on(event: string, callback: (...arguments_: any[]) => void): void {
    const handlers = this.#eventHandlers.get(event) ?? new Set();
    handlers.add(callback);
    this.#eventHandlers.set(event, handlers);
  }

  async #displayCfi(
    cfi: string,
    options?: { readonly localProgression?: number },
  ): Promise<Relocation> {
    const spineIndex = spineIndexFromCfi(cfi);
    if (spineIndex === null || !this.publication.readingOrder[spineIndex]) {
      throw new RangeError("CFI does not identify a publication spine item");
    }
    // Mount the spine item (settles at section start).
    await this.navigator.display({ spineIndex });
    // Prefer stored section-local progression when available — it round-trips
    // exactly with paginated page turns and avoids CFI geometry off-by-ones.
    if (options?.localProgression !== undefined && Number.isFinite(options.localProgression)) {
      return this.navigator.restoreProgression(options.localProgression);
    }
    // Fallback: map the resolved CFI range onto a column with floor-based math.
    const document = this.navigator.contentDocument;
    if (!document) throw new Error("Publication section is not mounted");
    const range = resolveCfi(cfi, document, sectionMetadata(this.publication, spineIndex));
    if (!range) throw new RangeError("CFI could not be resolved in its publication section");
    return this.navigator.restoreRange(range);
  }

  #compatibilityLocation(relocation: Relocation): CompatibilityLocation {
    return {
      start: {
        cfi: cfiForRelocation(this.publication, this.navigator, relocation),
        percentage: relocation.totalProgression,
        displayed: { page: 1, total: 1 },
        index: relocation.spineIndex,
        href: relocation.href,
      },
    };
  }

  #content(): CompatibilityContent | null {
    const document = this.navigator.contentDocument;
    const relocation = this.navigator.currentRelocation;
    if (!document || !relocation) return null;
    return {
      document,
      range: (cfi) =>
        resolveCfi(cfi, document, sectionMetadata(this.publication, relocation.spineIndex)),
    };
  }

  #mountDecorationLayer(relocation: Relocation): boolean {
    const document = this.navigator.contentDocument;
    if (!document) {
      this.#decorationLayer?.destroy();
      this.#decorationDocument = null;
      this.#decorationLayer = null;
      this.#decorationSpineIndex = null;
      return false;
    }
    if (
      this.#decorationLayer &&
      this.#decorationDocument === document &&
      this.#decorationSpineIndex === relocation.spineIndex
    ) {
      this.#decorationLayer.refresh();
      return false;
    }
    this.#decorationLayer?.destroy();
    const layer = createDecorationLayer({
      document,
      section: sectionMetadata(this.publication, relocation.spineIndex),
    });
    layer.on("selection-changed", (detail: SelectionChangedDetail) =>
      this.#emit("selection-changed", detail),
    );
    layer.on("decoration-click", (detail: DecorationClickDetail) =>
      this.#emit("decoration-click", detail),
    );
    this.#decorationDocument = document;
    this.#decorationLayer = layer;
    this.#decorationSpineIndex = relocation.spineIndex;
    for (const decoration of this.#decorations.values()) {
      if (decoration.locator.href !== relocation.href) continue;
      if (!layer.add(decoration)) this.#warnUnresolvable(decoration);
    }
    return true;
  }

  #warnUnresolvable(decoration: Decoration): void {
    console.warn("Skipping unresolvable EPUB decoration; stored highlight was preserved", {
      decorationId: decoration.id,
      cfi: decoration.locator.locations.cfi,
    });
  }

  #emit(event: string, ...arguments_: any[]): void {
    for (const callback of this.#eventHandlers.get(event) ?? []) callback(...arguments_);
  }
}

interface CompatibilitySection {
  readonly href: string;
  readonly index: number;
  readonly label: string;
  load(): Promise<void>;
  find(query: string): Promise<Array<{ cfi: string; excerpt: string }>>;
  unload(): void;
}

export function createSuccessorBookAdapter(
  publication: Publication,
  provider: ResourceProvider,
): Record<string, any> {
  const sections: CompatibilitySection[] = publication.readingOrder.map((link, index) => {
    let document: Document | null = null;
    return {
      href: link.href,
      index,
      label: link.title ?? "",
      async load() {
        const source = await provider.readText(link.href);
        document = new DOMParser().parseFromString(source, "application/xhtml+xml");
      },
      async find(query) {
        if (!document) await this.load();
        if (!document) return [];
        const root = document.body ?? document.documentElement;
        const text = root.textContent ?? "";
        // Case-insensitive matching runs on locale-lowercased copies, but
        // only when folding preserves lengths — otherwise the offsets found
        // in the haystack would not map back to `text` (e.g. "İ" folds to
        // two code units). Fall back to exact matching in that case.
        let haystack = text.toLocaleLowerCase();
        let needle = query.toLocaleLowerCase();
        if (haystack.length !== text.length || needle.length !== query.length) {
          haystack = text;
          needle = query;
        }
        if (needle.length === 0) return [];
        const offsets: number[] = [];
        for (
          let offset = haystack.indexOf(needle);
          offset >= 0;
          offset = haystack.indexOf(needle, offset + needle.length)
        ) {
          offsets.push(offset);
        }
        // Full-span ranges (not collapsed points) so result CFIs can be
        // rendered as highlight decorations over the matched text.
        const ranges = rangesAtTextSpans(
          document,
          root,
          offsets.map((offset) => [offset, offset + needle.length] as const),
        );
        const results: Array<{ cfi: string; excerpt: string }> = [];
        for (const [position, offset] of offsets.entries()) {
          const range = ranges[position];
          if (!range) continue;
          results.push({
            cfi: generateCfi(range, sectionMetadata(publication, index)),
            excerpt: text.slice(Math.max(0, offset - 40), offset + needle.length + 40),
          });
        }
        return results;
      },
      unload() {
        document = null;
      },
    };
  });
  return {
    ready: Promise.resolve(),
    navigation: { toc: publication.toc },
    spine: {
      get: (target?: string | number) =>
        typeof target === "number"
          ? (sections[target] ?? null)
          : (sections.find((section) => hrefsMatch(section.href, target ?? "")) ?? null),
      each: (callback: (section: CompatibilitySection) => void) => sections.forEach(callback),
    },
    load: (href: string) => provider.readText(normalizePublicationPath(href) as PublicationPath),
    destroy: () => undefined,
  };
}

export type SuccessorBookAdapter = ReturnType<typeof createSuccessorBookAdapter>;
