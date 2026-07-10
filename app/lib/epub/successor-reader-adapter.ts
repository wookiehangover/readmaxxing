import {
  generateCfi,
  generateEphemeralPositions,
  normalizePublicationPath,
  parseNavigationDocument,
  parseNcx,
  parseCfi,
  resolveCfi,
  type Navigator,
  type PersistentLocator,
  type Publication,
  type PublicationPath,
  type Relocation,
  type ResourceProvider,
  type SectionMetadata,
  type TocEntry,
} from "@readmaxxing/epub-successor";

const POSITION_CACHE_KIND = "epub-successor-positions";
const POSITION_CACHE_VERSION = 1;

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
  return generateEphemeralPositions(sections);
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

export function spineIndexFromCfi(cfi: string): number | null {
  try {
    const parsed = parseCfi(cfi);
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

function visibleRange(document: Document): Range {
  const extended = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = extended.caretRangeFromPoint?.(1, 1);
  if (caret) return caret;
  const root = document.body ?? document.documentElement;
  const text = firstTextNode(root);
  const range = document.createRange();
  range.setStart(text ?? root, 0);
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
  readonly annotations = {
    highlight: (..._arguments: unknown[]) => undefined,
    remove: (..._arguments: unknown[]) => undefined,
  };
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
  readonly #eventHandlers = new Map<string, Set<(...arguments_: any[]) => void>>();
  readonly #observedDocuments = new WeakSet<Document>();
  #location: CompatibilityLocation | undefined;

  constructor(
    readonly publication: Publication,
    readonly navigator: Navigator,
  ) {
    navigator.addEventListener("relocation", (event) => {
      const relocation = (event as CustomEvent<Relocation>).detail;
      this.#location = this.#compatibilityLocation(relocation);
      const content = this.#content();
      if (content) {
        for (const callback of this.#contentHooks) callback(content);
        this.#observeSelection(content);
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

  async display(target?: string | number): Promise<Relocation> {
    if (target === undefined) return this.navigator.display({ spineIndex: 0 });
    if (typeof target === "number") return this.navigator.display({ spineIndex: target });
    if (target.trim().startsWith("epubcfi(")) return this.#displayCfi(target);
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
    this.navigator.destroy();
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

  async #displayCfi(cfi: string): Promise<Relocation> {
    const spineIndex = spineIndexFromCfi(cfi);
    if (spineIndex === null || !this.publication.readingOrder[spineIndex]) {
      throw new RangeError("CFI does not identify a publication spine item");
    }
    const relocation = await this.navigator.display({ spineIndex });
    const document = this.navigator.contentDocument;
    if (!document) throw new Error("Publication section is not mounted");
    const range = resolveCfi(cfi, document, sectionMetadata(this.publication, spineIndex));
    if (!range) throw new RangeError("CFI could not be resolved in its publication section");
    const element =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    element?.scrollIntoView({ block: "start", inline: "start" });
    return relocation;
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

  #observeSelection(content: CompatibilityContent): void {
    if (this.#observedDocuments.has(content.document)) return;
    this.#observedDocuments.add(content.document);
    content.document.addEventListener("mouseup", () => {
      const selection = content.document.defaultView?.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const relocation = this.navigator.currentRelocation;
      if (!relocation) return;
      const cfi = generateCfi(range, sectionMetadata(this.publication, relocation.spineIndex));
      this.#emit("selected", cfi, content);
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
        const text = document.body?.textContent ?? document.documentElement.textContent ?? "";
        const offset = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
        if (offset < 0) return [];
        const node = firstTextNode(document.body ?? document.documentElement);
        if (!node) return [];
        const localOffset = Math.min(offset, node.length);
        const range = document.createRange();
        range.setStart(node, localOffset);
        range.collapse(true);
        return [
          {
            cfi: generateCfi(range, sectionMetadata(publication, index)),
            excerpt: text.slice(Math.max(0, offset - 40), offset + query.length + 40),
          },
        ];
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
