import type { TocEntry } from "../publication-model/publication-model";
import {
  PublicationPathError,
  resolvePublicationPath,
  type PublicationPath,
} from "../publication-model/paths";
import {
  getAttributeNS,
  getChildElementsNS,
  getElementsNS,
  getTextContent,
  parseXml,
  type ParseDiagnostic,
  XML_NAMESPACES,
} from "./xml";

export interface NavigationDocumentParseResult {
  readonly toc: readonly TocEntry[];
  readonly landmarks: readonly TocEntry[];
  readonly pageList: readonly TocEntry[];
  readonly diagnostics: readonly ParseDiagnostic[];
}

type NavigationSection = "toc" | "landmarks" | "page-list";

function diagnostic(
  sourcePath: PublicationPath,
  severity: ParseDiagnostic["severity"],
  code: string,
  message: string,
): ParseDiagnostic {
  return { severity, code, message, sourcePath };
}

function tokens(value: string | undefined): readonly string[] {
  return value?.trim().split(/\s+/).filter(Boolean) ?? [];
}

function sectionType(element: Element): readonly string[] {
  return tokens(getAttributeNS(element, XML_NAMESPACES.epub, "type"));
}

function parseList(
  list: Element,
  sourcePath: PublicationPath,
  section: NavigationSection,
  diagnostics: ParseDiagnostic[],
): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const item of getChildElementsNS(list, XML_NAMESPACES.xhtml, "li")) {
    const nestedList = getChildElementsNS(item, XML_NAMESPACES.xhtml, "ol")[0];
    const children = nestedList ? parseList(nestedList, sourcePath, section, diagnostics) : [];
    const link = getChildElementsNS(item, XML_NAMESPACES.xhtml, "a")[0];
    const href = link ? getAttributeNS(link, null, "href")?.trim() : undefined;
    const title = getTextContent(link);
    if (!link || !href || !title) {
      diagnostics.push(
        diagnostic(
          sourcePath,
          "warning",
          "NAV_INVALID_ENTRY",
          `${section} entry needs a non-empty link and label`,
        ),
      );
      entries.push(...children);
      continue;
    }
    try {
      entries.push({ title, href: resolvePublicationPath(sourcePath, href), children });
    } catch (cause) {
      const detail = cause instanceof PublicationPathError ? `: ${cause.message}` : "";
      diagnostics.push(
        diagnostic(sourcePath, "warning", "NAV_INVALID_HREF", `Invalid ${section} href${detail}`),
      );
      entries.push(...children);
    }
  }
  return entries;
}

function parseSection(
  navigation: Element | undefined,
  sourcePath: PublicationPath,
  section: NavigationSection,
  diagnostics: ParseDiagnostic[],
): TocEntry[] {
  if (!navigation) return [];
  const list = getChildElementsNS(navigation, XML_NAMESPACES.xhtml, "ol")[0];
  if (!list) {
    diagnostics.push(
      diagnostic(
        sourcePath,
        section === "toc" ? "error" : "warning",
        "NAV_MISSING_LIST",
        `${section} navigation has no ordered list`,
      ),
    );
    return [];
  }
  return parseList(list, sourcePath, section, diagnostics);
}

export function parseNavigationDocument(
  source: string,
  sourcePath: PublicationPath,
): NavigationDocumentParseResult {
  const parsed = parseXml(source, sourcePath);
  if (!parsed.document) {
    return { toc: [], landmarks: [], pageList: [], diagnostics: parsed.diagnostics };
  }
  const root = parsed.document.documentElement;
  if (root.localName !== "html" || root.namespaceURI !== XML_NAMESPACES.xhtml) {
    return {
      toc: [],
      landmarks: [],
      pageList: [],
      diagnostics: [
        diagnostic(
          sourcePath,
          "error",
          "NAV_INVALID_ROOT",
          "Navigation document must use the XHTML html root",
        ),
      ],
    };
  }

  const diagnostics: ParseDiagnostic[] = [];
  const navigationElements = getElementsNS(parsed.document, XML_NAMESPACES.xhtml, "nav");
  const findSection = (section: NavigationSection): Element | undefined =>
    navigationElements.find((element) => sectionType(element).includes(section));
  const tocNavigation = findSection("toc");
  if (!tocNavigation) {
    diagnostics.push(
      diagnostic(sourcePath, "error", "NAV_MISSING_TOC", "Navigation document has no TOC"),
    );
  }

  return {
    toc: parseSection(tocNavigation, sourcePath, "toc", diagnostics),
    landmarks: parseSection(findSection("landmarks"), sourcePath, "landmarks", diagnostics),
    pageList: parseSection(findSection("page-list"), sourcePath, "page-list", diagnostics),
    diagnostics,
  };
}
