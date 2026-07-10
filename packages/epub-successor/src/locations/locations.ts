import type { Locator, LocatorText, MediaType } from "../publication-model/publication-model";
import type { PublicationPath } from "../publication-model/paths";
import { generateCfi, resolveCfi, type CfiSectionMetadata } from "./cfi";

export interface TextQuoteSelector {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface TextPositionSelector {
  readonly start: number;
  readonly end: number;
}

export interface LocatorSelectors {
  readonly textQuote: TextQuoteSelector;
  readonly textPosition: TextPositionSelector;
}

export interface PersistentLocator extends Locator {
  readonly selectors: LocatorSelectors;
}

export interface SectionMetadata extends CfiSectionMetadata {
  readonly href: PublicationPath;
  readonly spineLength: number;
  readonly mediaType?: MediaType;
  readonly title?: string;
}

interface TextNodeRecord {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

function contentRoot(document: Document): Element {
  return document.body ?? document.documentElement;
}

function textRecords(document: Document): readonly TextNodeRecord[] {
  const records: TextNodeRecord[] = [];
  const walker = document.createTreeWalker(contentRoot(document), 4);
  let position = 0;
  let current = walker.nextNode();
  while (current !== null) {
    const text = current.nodeValue ?? "";
    records.push({ node: current as Text, start: position, end: position + text.length });
    position += text.length;
    current = walker.nextNode();
  }
  return records;
}

function fullText(records: readonly TextNodeRecord[]): string {
  return records.map(({ node }) => node.data).join("");
}

function boundaryPosition(document: Document, container: Node, offset: number): number {
  const records = textRecords(document);
  if (container.nodeType === Node.TEXT_NODE) {
    const record = records.find(({ node }) => node === container);
    if (record === undefined || offset < 0 || offset > record.node.length) {
      throw new RangeError("Range boundary is outside the section content");
    }
    return record.start + offset;
  }
  if (offset < 0 || offset > container.childNodes.length) {
    throw new RangeError("Range boundary offset is outside its container");
  }
  const nextNode = container.childNodes[offset] ?? null;
  if (nextNode !== null) {
    const nextRecord = records.find(({ node }) => nextNode === node || nextNode.contains(node));
    if (nextRecord !== undefined) return nextRecord.start;
  }
  const previousNode = container.childNodes[offset - 1] ?? null;
  if (previousNode !== null) {
    const previousRecords = records.filter(
      ({ node }) => previousNode === node || previousNode.contains(node),
    );
    const previousRecord = previousRecords.at(-1);
    if (previousRecord !== undefined) return previousRecord.end;
  }
  if (container === contentRoot(document)) return 0;
  throw new RangeError("Range boundary is outside the section content");
}

function boundaryAt(
  records: readonly TextNodeRecord[],
  root: Element,
  position: number,
): readonly [Node, number] {
  if (records.length === 0) return [root, 0];
  const total = records.at(-1)?.end ?? 0;
  const clamped = Math.max(0, Math.min(position, total));
  const record = records.find(({ end }) => clamped <= end) ?? records.at(-1);
  if (record === undefined) return [root, 0];
  return [record.node, clamped - record.start];
}

function rangeAt(document: Document, start: number, end: number): Range | null {
  const records = textRecords(document);
  const total = records.at(-1)?.end ?? 0;
  if (start < 0 || end < start || end > total) return null;
  const root = contentRoot(document);
  const startBoundary = boundaryAt(records, root, start);
  const endBoundary = boundaryAt(records, root, end);
  const range = document.createRange();
  range.setEnd(endBoundary[0], endBoundary[1]);
  range.setStart(startBoundary[0], startBoundary[1]);
  return range;
}

function quoteSelector(text: string, start: number, end: number): TextQuoteSelector {
  return {
    exact: text.slice(start, end),
    ...(start === 0 ? {} : { prefix: text.slice(Math.max(0, start - 32), start) }),
    ...(end === text.length ? {} : { suffix: text.slice(end, end + 32) }),
  };
}

function quoteText(selector: TextQuoteSelector): LocatorText {
  return {
    ...(selector.prefix === undefined ? {} : { before: selector.prefix }),
    ...(selector.exact === "" ? {} : { highlight: selector.exact }),
    ...(selector.suffix === undefined ? {} : { after: selector.suffix }),
  };
}

function resolveQuote(document: Document, selector: TextQuoteSelector): Range | null {
  if (selector.exact === "") return null;
  const records = textRecords(document);
  const text = fullText(records);
  let fallback = -1;
  let start = text.indexOf(selector.exact);
  while (start >= 0) {
    if (fallback < 0) fallback = start;
    const prefixMatches =
      selector.prefix === undefined || text.slice(0, start).endsWith(selector.prefix);
    const end = start + selector.exact.length;
    const suffixMatches =
      selector.suffix === undefined || text.slice(end).startsWith(selector.suffix);
    if (prefixMatches && suffixMatches) return rangeAt(document, start, end);
    start = text.indexOf(selector.exact, start + 1);
  }
  return fallback < 0 ? null : rangeAt(document, fallback, fallback + selector.exact.length);
}

function selectorsFrom(locator: Locator | PersistentLocator): LocatorSelectors | undefined {
  if ("selectors" in locator) return locator.selectors;
  const exact = locator.text.highlight ?? "";
  const start = locator.locations.position;
  if (start === undefined) return undefined;
  return {
    textQuote: {
      exact,
      ...(locator.text.before === undefined ? {} : { prefix: locator.text.before }),
      ...(locator.text.after === undefined ? {} : { suffix: locator.text.after }),
    },
    textPosition: { start, end: start + exact.length },
  };
}

export function calculateProgression(
  spineIndex: number,
  spineLength: number,
  intraSectionProgression: number,
): { readonly progression: number; readonly totalProgression: number } {
  if (!Number.isInteger(spineIndex) || spineIndex < 0)
    throw new RangeError("spineIndex must be non-negative");
  if (!Number.isInteger(spineLength) || spineLength <= 0 || spineIndex >= spineLength) {
    throw new RangeError("spineLength must include spineIndex");
  }
  const progression = Math.max(0, Math.min(1, intraSectionProgression));
  return { progression, totalProgression: (spineIndex + progression) / spineLength };
}

interface LocatorCreationOptions {
  readonly position?: number;
}

export function locatorFromRange(
  range: Range,
  section: SectionMetadata,
  options: LocatorCreationOptions = {},
): PersistentLocator {
  const document = range.startContainer.ownerDocument;
  if (document === null || range.endContainer.ownerDocument !== document) {
    throw new TypeError("A locator range must belong to one document");
  }
  const records = textRecords(document);
  const text = fullText(records);
  const start = boundaryPosition(document, range.startContainer, range.startOffset);
  const end = boundaryPosition(document, range.endContainer, range.endOffset);
  const selector = quoteSelector(text, start, end);
  const localProgression = text.length === 0 ? 0 : start / text.length;
  const progression = calculateProgression(
    section.spineIndex,
    section.spineLength,
    localProgression,
  );
  return {
    href: section.href,
    ...(section.mediaType === undefined ? {} : { mediaType: section.mediaType }),
    ...(section.title === undefined ? {} : { title: section.title }),
    locations: {
      ...progression,
      cfi: generateCfi(range, section),
      ...(options.position === undefined ? {} : { position: options.position }),
    },
    text: quoteText(selector),
    selectors: {
      textQuote: selector,
      textPosition: { start, end },
    },
  };
}

export function resolveLocator(
  locator: Locator | PersistentLocator,
  document: Document,
  section: SectionMetadata,
): Range | null {
  const selectors = selectorsFrom(locator);
  if (locator.locations.cfi !== undefined) {
    const cfiRange = resolveCfi(locator.locations.cfi, document, section);
    if (
      cfiRange !== null &&
      (selectors?.textQuote.exact === "" ||
        selectors?.textQuote.exact === undefined ||
        cfiRange.toString() === selectors.textQuote.exact)
    ) {
      return cfiRange;
    }
  }
  if (selectors !== undefined) {
    const quoteRange = resolveQuote(document, selectors.textQuote);
    if (quoteRange !== null) return quoteRange;
    return rangeAt(document, selectors.textPosition.start, selectors.textPosition.end);
  }
  return null;
}

export interface MountedSection {
  readonly document: Document;
  readonly metadata: SectionMetadata;
}

/**
 * Generates a cacheable list of character-sampled positions. Its one-based `position` values are
 * ephemeral page-number analogues: they may change with content and are not persistent locators.
 */
export function generateEphemeralPositions(
  sections: readonly MountedSection[],
  charactersPerPosition = 1_500,
): readonly PersistentLocator[] {
  if (!Number.isInteger(charactersPerPosition) || charactersPerPosition <= 0) {
    throw new RangeError("charactersPerPosition must be a positive integer");
  }
  const positions: PersistentLocator[] = [];
  for (const section of sections) {
    const records = textRecords(section.document);
    const total = records.at(-1)?.end ?? 0;
    for (let offset = 0; offset < Math.max(1, total); offset += charactersPerPosition) {
      const boundary = boundaryAt(records, contentRoot(section.document), offset);
      const range = section.document.createRange();
      range.setStart(boundary[0], boundary[1]);
      range.collapse(true);
      positions.push(locatorFromRange(range, section.metadata, { position: positions.length + 1 }));
    }
  }
  return positions;
}
