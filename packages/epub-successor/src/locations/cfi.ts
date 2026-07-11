import { createCfi, type Cfi } from "../publication-model/publication-model";

export interface CfiStep {
  readonly number: number;
  readonly id?: string;
}

export interface CfiTextAssertion {
  readonly before?: string;
  readonly after?: string;
}

export interface CfiPath {
  readonly steps: readonly CfiStep[];
  readonly offset?: number;
  readonly textAssertion?: CfiTextAssertion;
}

export interface ParsedCfiPoint {
  readonly kind: "point";
  readonly packagePath?: CfiPath;
  readonly path: CfiPath;
}

export interface ParsedCfiRange {
  readonly kind: "range";
  readonly packagePath?: CfiPath;
  readonly base: CfiPath;
  readonly start: CfiPath;
  readonly end: CfiPath;
}

export type ParsedCfi = ParsedCfiPoint | ParsedCfiRange;

const RESERVED_ASSERTION = /[\^[\](),;=]/g;

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === "^") {
      escaped = true;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth < 0) throw new TypeError("Invalid EPUB CFI assertion");
    } else if (character === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (escaped || depth !== 0) throw new TypeError("Invalid EPUB CFI assertion");
  parts.push(value.slice(start));
  return parts;
}

function unescapeAssertion(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "^") {
      index += 1;
      if (index >= value.length) throw new TypeError("Invalid EPUB CFI escape");
    }
    result += value[index];
  }
  return result;
}

function escapeAssertion(value: string): string {
  return value.replace(RESERVED_ASSERTION, "^$&");
}

function extractAssertion(value: string): readonly [string, string | undefined] {
  if (!value.endsWith("]")) return [value, undefined];
  let escaped = false;
  for (let index = value.length - 2; index >= 0; index -= 1) {
    const character = value[index];
    if (character === "^") {
      escaped = !escaped;
      continue;
    }
    if (character === "[" && !escaped) {
      return [value.slice(0, index), value.slice(index + 1, -1)];
    }
    escaped = false;
  }
  throw new TypeError("Invalid EPUB CFI assertion");
}

function parsePath(value: string): CfiPath {
  const colonParts = splitTopLevel(value, ":");
  if (colonParts.length > 2) throw new TypeError("An EPUB CFI path has at most one offset");
  const [stepSource, terminalSource] = colonParts;
  if (stepSource !== "" && !stepSource.startsWith("/")) {
    throw new TypeError("An EPUB CFI path must begin with a slash");
  }

  const steps =
    stepSource === ""
      ? []
      : splitTopLevel(stepSource.slice(1), "/").map((part) => {
          const [numberSource, assertion] = extractAssertion(part);
          if (!/^[1-9]\d*$/.test(numberSource)) throw new TypeError("Invalid EPUB CFI step");
          return {
            number: Number(numberSource),
            ...(assertion === undefined ? {} : { id: unescapeAssertion(assertion) }),
          };
        });

  if (terminalSource === undefined) return { steps };
  const [offsetSource, assertion] = extractAssertion(terminalSource);
  if (!/^\d+$/.test(offsetSource)) throw new TypeError("Invalid EPUB CFI character offset");
  if (assertion === undefined) return { steps, offset: Number(offsetSource) };
  const assertionParts = splitTopLevel(assertion, ",");
  if (assertionParts.length > 2) throw new TypeError("Invalid EPUB CFI text assertion");
  return {
    steps,
    offset: Number(offsetSource),
    textAssertion: {
      ...(assertionParts[0] === "" ? {} : { before: unescapeAssertion(assertionParts[0]) }),
      ...(assertionParts[1] === undefined || assertionParts[1] === ""
        ? {}
        : { after: unescapeAssertion(assertionParts[1]) }),
    },
  };
}

function printPath(path: CfiPath): string {
  const steps = path.steps
    .map((step) => `/${step.number}${step.id === undefined ? "" : `[${escapeAssertion(step.id)}]`}`)
    .join("");
  if (path.offset === undefined) return steps;
  const assertion = path.textAssertion;
  if (assertion === undefined) return `${steps}:${path.offset}`;
  const before = assertion.before === undefined ? "" : escapeAssertion(assertion.before);
  const after = assertion.after === undefined ? "" : escapeAssertion(assertion.after);
  return `${steps}:${path.offset}[${before},${after}]`;
}

export function parseCfi(value: Cfi | string): ParsedCfi {
  const source = value.trim();
  if (!source.startsWith("epubcfi(") || !source.endsWith(")")) {
    throw new TypeError("An EPUB CFI must use the epubcfi(...) form");
  }
  const body = source.slice(8, -1);
  const indirections = splitTopLevel(body, "!");
  if (indirections.length > 2) throw new TypeError("Only one EPUB CFI indirection is supported");
  const packagePath = indirections.length === 2 ? parsePath(indirections[0]) : undefined;
  const local = indirections.at(-1) ?? "";
  const rangeParts = splitTopLevel(local, ",");
  if (rangeParts.length === 1) {
    return {
      kind: "point",
      ...(packagePath === undefined ? {} : { packagePath }),
      path: parsePath(local),
    };
  }
  if (rangeParts.length !== 3)
    throw new TypeError("An EPUB CFI range needs base, start, and end paths");
  return {
    kind: "range",
    ...(packagePath === undefined ? {} : { packagePath }),
    base: parsePath(rangeParts[0]),
    start: parsePath(rangeParts[1]),
    end: parsePath(rangeParts[2]),
  };
}

export function printCfi(parsed: ParsedCfi): Cfi {
  const packagePrefix = parsed.packagePath === undefined ? "" : `${printPath(parsed.packagePath)}!`;
  const local =
    parsed.kind === "point"
      ? printPath(parsed.path)
      : `${printPath(parsed.base)},${printPath(parsed.start)},${printPath(parsed.end)}`;
  return createCfi(`epubcfi(${packagePrefix}${local})`);
}

function childStep(node: Node): CfiStep {
  const parent = node.parentNode;
  if (parent === null) throw new TypeError("A CFI node must be attached to its document");
  if (node.nodeType === Node.ELEMENT_NODE) {
    const elements = Array.from(parent.childNodes).filter(
      (child) => child.nodeType === Node.ELEMENT_NODE,
    );
    const index = elements.indexOf(node as ChildNode);
    if (index < 0) throw new TypeError("Unable to locate CFI element");
    const id = (node as Element).id;
    return { number: (index + 1) * 2, ...(id === "" ? {} : { id }) };
  }
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    const texts = Array.from(parent.childNodes).filter(
      (child) => child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE,
    );
    const index = texts.indexOf(node as ChildNode);
    if (index < 0) throw new TypeError("Unable to locate CFI text node");
    return { number: index * 2 + 1 };
  }
  throw new TypeError("EPUB CFI generation supports element and text nodes");
}

function boundaryPath(document: Document, node: Node, offset: number): CfiPath {
  const isText = node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE;
  if (!isText && node.nodeType !== Node.ELEMENT_NODE) {
    throw new TypeError("EPUB CFI range boundaries must be element or text nodes");
  }
  const text = isText ? (node.nodeValue ?? "") : "";
  const maximumOffset = isText ? text.length : node.childNodes.length;
  if (offset < 0 || offset > maximumOffset) throw new TypeError("CFI offset is outside its node");
  const steps: CfiStep[] = [];
  let current: Node = node;
  while (current !== document.documentElement) {
    steps.unshift(childStep(current));
    const parent = current.parentNode;
    if (parent === null) throw new TypeError("A CFI node must belong to the supplied document");
    current = parent;
  }
  steps.unshift({
    number: 4,
    ...(document.documentElement.id === "" ? {} : { id: document.documentElement.id }),
  });
  return {
    steps,
    offset,
    ...(isText
      ? {
          textAssertion: {
            before: text.slice(Math.max(0, offset - 8), offset),
            after: text.slice(offset, offset + 8),
          },
        }
      : {}),
  };
}

function sameStep(left: CfiStep, right: CfiStep): boolean {
  return left.number === right.number && left.id === right.id;
}

export interface CfiSectionMetadata {
  readonly spineIndex: number;
  readonly spineId?: string;
}

export function generateCfi(range: Range, section: CfiSectionMetadata): Cfi {
  const document = range.startContainer.ownerDocument;
  if (document === null || range.endContainer.ownerDocument !== document) {
    throw new TypeError("A CFI range must belong to one document");
  }
  const start = boundaryPath(document, range.startContainer, range.startOffset);
  const end = boundaryPath(document, range.endContainer, range.endOffset);
  const packagePath: CfiPath = {
    steps: [
      { number: 6 },
      {
        number: (section.spineIndex + 1) * 2,
        ...(section.spineId === undefined ? {} : { id: section.spineId }),
      },
    ],
  };
  const collapsed =
    range.startContainer === range.endContainer && range.startOffset === range.endOffset;
  if (collapsed) return printCfi({ kind: "point", packagePath, path: start });

  let commonLength = 0;
  while (
    commonLength < start.steps.length &&
    commonLength < end.steps.length &&
    sameStep(start.steps[commonLength], end.steps[commonLength])
  ) {
    commonLength += 1;
  }
  return printCfi({
    kind: "range",
    packagePath,
    base: { steps: start.steps.slice(0, commonLength) },
    start: { ...start, steps: start.steps.slice(commonLength) },
    end: { ...end, steps: end.steps.slice(commonLength) },
  });
}

function resolveStep(parent: Node, step: CfiStep): Node | null {
  const wantsElement = step.number % 2 === 0;
  const candidates = Array.from(parent.childNodes).filter((child) =>
    wantsElement
      ? child.nodeType === Node.ELEMENT_NODE
      : child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE,
  );
  const index = wantsElement ? step.number / 2 - 1 : (step.number - 1) / 2;
  let candidate: ChildNode | null = candidates[index] ?? null;
  if (step.id !== undefined) {
    if (candidate?.nodeType !== Node.ELEMENT_NODE || (candidate as Element).id !== step.id) {
      candidate =
        candidates.find(
          (child) => child.nodeType === Node.ELEMENT_NODE && (child as Element).id === step.id,
        ) ?? null;
    }
  }
  return candidate;
}

function resolvePath(document: Document, path: CfiPath): readonly [Node, number] | null {
  const [rootStep, ...steps] = path.steps;
  if (rootStep?.number !== 4) return null;
  let current: Node = document.documentElement;
  if (rootStep.id !== undefined && document.documentElement.id !== rootStep.id) return null;
  for (const step of steps) {
    const next = resolveStep(current, step);
    if (next === null) return null;
    current = next;
  }
  const offset = path.offset ?? 0;
  const maximum =
    current.nodeType === Node.TEXT_NODE
      ? (current.nodeValue?.length ?? 0)
      : current.childNodes.length;
  if (offset > maximum) return null;
  if (path.textAssertion !== undefined && current.nodeType === Node.TEXT_NODE) {
    const text = current.nodeValue ?? "";
    const { before, after } = path.textAssertion;
    if (before !== undefined && !text.slice(0, offset).endsWith(before)) return null;
    if (after !== undefined && !text.slice(offset).startsWith(after)) return null;
  }
  return [current, offset];
}

function combinePaths(base: CfiPath, relative: CfiPath): CfiPath {
  return { ...relative, steps: [...base.steps, ...relative.steps] };
}

function cfiSpineIndex(parsed: ParsedCfi): number | undefined {
  const step = parsed.packagePath?.steps.at(-1);
  return step === undefined || step.number % 2 !== 0 ? undefined : step.number / 2 - 1;
}

export function resolveCfi(
  cfi: Cfi | string,
  document: Document,
  section?: CfiSectionMetadata,
): Range | null {
  let parsed: ParsedCfi;
  try {
    parsed = parseCfi(cfi);
  } catch {
    return null;
  }
  if (section !== undefined) {
    const encodedSpineIndex = cfiSpineIndex(parsed);
    if (encodedSpineIndex !== undefined && encodedSpineIndex !== section.spineIndex) return null;
  }
  const startPath = parsed.kind === "point" ? parsed.path : combinePaths(parsed.base, parsed.start);
  const endPath = parsed.kind === "point" ? parsed.path : combinePaths(parsed.base, parsed.end);
  const start = resolvePath(document, startPath);
  const end = resolvePath(document, endPath);
  if (start === null || end === null) return null;
  const range = document.createRange();
  try {
    range.setEnd(end[0], end[1]);
    range.setStart(start[0], start[1]);
  } catch {
    return null;
  }
  return range;
}
