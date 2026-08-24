import type { PublicationPath } from "../publication-model/paths";
import { ResourceReadAbortedError } from "./resource-provider-errors";
import type { ResourceUrlScope } from "./urls";

interface CssReference {
  readonly start: number;
  readonly end: number;
  readonly scanEnd: number;
  readonly value: string;
  readonly import: boolean;
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-z\d_-]/i.test(value);
}

function skipComment(css: string, index: number): number {
  const end = css.indexOf("*/", index + 2);
  return end < 0 ? css.length : end + 2;
}

function skipWhitespaceAndComments(css: string, start: number): number {
  let index = start;
  while (index < css.length) {
    if (/\s/.test(css[index]!)) index += 1;
    else if (css.startsWith("/*", index)) index = skipComment(css, index);
    else break;
  }
  return index;
}

function stringEnd(css: string, start: number): number {
  const quote = css[start]!;
  let index = start + 1;
  while (index < css.length) {
    if (css[index] === "\\") index += css[index + 1] === "\r" && css[index + 2] === "\n" ? 3 : 2;
    else if (css[index++] === quote) return index;
  }
  return css.length;
}

function decodeCss(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.startsWith("/*", index)) {
      index = skipComment(value, index) - 1;
      continue;
    }
    if (value[index] !== "\\") {
      decoded += value[index];
      continue;
    }
    index += 1;
    const hex = value.slice(index).match(/^[a-f\d]{1,6}/i)?.[0];
    if (hex) {
      decoded += String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd);
      index += hex.length - 1;
      if (/\s/.test(value[index + 1] ?? "")) index += 1;
    } else if (value[index] !== "\n" && value[index] !== "\r" && value[index] !== "\f") {
      decoded += value[index] ?? "";
    }
  }
  return decoded;
}

function parseUrl(css: string, start: number, imported: boolean): CssReference | undefined {
  let open = start + 3;
  open = skipWhitespaceAndComments(css, open);
  if (css[open] !== "(") return undefined;
  let valueStart = skipWhitespaceAndComments(css, open + 1);
  if (css[valueStart] === '"' || css[valueStart] === "'") {
    const end = stringEnd(css, valueStart);
    return {
      start: valueStart + 1,
      end: Math.max(valueStart + 1, end - 1),
      scanEnd: end,
      value: decodeCss(css.slice(valueStart + 1, end - 1)),
      import: imported,
    };
  }
  let index = valueStart;
  while (index < css.length && css[index] !== ")") {
    if (css[index] === "\\") index += 2;
    else index += 1;
  }
  let valueEnd = index;
  while (valueEnd > valueStart && /\s/.test(css[valueEnd - 1]!)) valueEnd -= 1;
  return {
    start: valueStart,
    end: valueEnd,
    scanEnd: Math.min(index + 1, css.length),
    value: decodeCss(css.slice(valueStart, valueEnd)),
    import: imported,
  };
}

function parseImport(css: string, start: number): CssReference | undefined {
  const afterName = start + 7;
  if (isIdentifierCharacter(css[afterName])) return undefined;
  const valueStart = skipWhitespaceAndComments(css, afterName);
  if (css[valueStart] === '"' || css[valueStart] === "'") {
    const end = stringEnd(css, valueStart);
    return {
      start: valueStart + 1,
      end: Math.max(valueStart + 1, end - 1),
      scanEnd: end,
      value: decodeCss(css.slice(valueStart + 1, end - 1)),
      import: true,
    };
  }
  if (css.slice(valueStart, valueStart + 3).toLowerCase() === "url")
    return parseUrl(css, valueStart, true);
  return undefined;
}

function findReferences(css: string): CssReference[] {
  const references: CssReference[] = [];
  let index = 0;
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      index = skipComment(css, index);
      continue;
    }
    if (css[index] === '"' || css[index] === "'") {
      index = stringEnd(css, index);
      continue;
    }
    if (css[index] === "@" && css.slice(index, index + 7).toLowerCase() === "@import") {
      const reference = parseImport(css, index);
      if (reference) {
        references.push(reference);
        index = reference.scanEnd;
        continue;
      }
    }
    if (
      css.slice(index, index + 3).toLowerCase() === "url" &&
      !isIdentifierCharacter(css[index - 1])
    ) {
      const reference = parseUrl(css, index, false);
      if (reference) {
        references.push(reference);
        index = reference.scanEnd;
        continue;
      }
    }
    index += 1;
  }
  return references;
}

export async function rewriteCss(
  css: string,
  base: PublicationPath,
  scope: ResourceUrlScope,
  signal?: AbortSignal,
  ancestors: ReadonlySet<PublicationPath> = new Set([base]),
): Promise<string> {
  if (signal?.aborted) throw new ResourceReadAbortedError();
  const references = findReferences(css);
  const replacements = await Promise.all(
    references.map((reference) =>
      reference.import
        ? scope.stylesheetUrl(reference.value, base, signal, ancestors)
        : scope.resourceUrl(reference.value, base, signal),
    ),
  );
  let rewritten = "";
  let offset = 0;
  references.forEach((reference, index) => {
    rewritten += css.slice(offset, reference.start) + replacements[index];
    offset = reference.end;
  });
  rewritten += css.slice(offset);
  if (signal?.aborted) throw new ResourceReadAbortedError();
  return rewritten;
}
