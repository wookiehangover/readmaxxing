import type { TocEntry } from "../publication-model/publication-model";
import {
  PublicationPathError,
  resolvePublicationPath,
  type PublicationPath,
} from "../publication-model/paths";
import {
  getAttributeNS,
  getChildElementsNS,
  getTextContent,
  parseXml,
  type ParseDiagnostic,
  XML_NAMESPACES,
} from "./xml";

export interface NcxParseResult {
  readonly toc: readonly TocEntry[];
  readonly pageList: readonly TocEntry[];
  readonly diagnostics: readonly ParseDiagnostic[];
}

function diagnostic(
  sourcePath: PublicationPath,
  severity: ParseDiagnostic["severity"],
  code: string,
  message: string,
): ParseDiagnostic {
  return { severity, code, message, sourcePath };
}

function parseNavPoint(
  navPoint: Element,
  sourcePath: PublicationPath,
  diagnostics: ParseDiagnostic[],
): TocEntry[] {
  const children = getChildElementsNS(navPoint, XML_NAMESPACES.ncx, "navPoint").flatMap((child) =>
    parseNavPoint(child, sourcePath, diagnostics),
  );
  const playOrder = getAttributeNS(navPoint, null, "playOrder")?.trim();
  if (playOrder && (!/^\d+$/.test(playOrder) || Number(playOrder) < 1)) {
    diagnostics.push(
      diagnostic(
        sourcePath,
        "warning",
        "NCX_INVALID_PLAY_ORDER",
        `Ignoring invalid NCX playOrder: ${playOrder}`,
      ),
    );
  }
  const label = getChildElementsNS(navPoint, XML_NAMESPACES.ncx, "navLabel")[0];
  const text = label
    ? getTextContent(getChildElementsNS(label, XML_NAMESPACES.ncx, "text")[0])
    : undefined;
  const content = getChildElementsNS(navPoint, XML_NAMESPACES.ncx, "content")[0];
  const source = content ? getAttributeNS(content, null, "src")?.trim() : undefined;
  if (!source) {
    diagnostics.push(
      diagnostic(sourcePath, "warning", "NCX_MISSING_CONTENT", "NCX navPoint has no content src"),
    );
    return children;
  }
  try {
    return [
      {
        title: text ?? "Untitled",
        href: resolvePublicationPath(sourcePath, source),
        children,
      },
    ];
  } catch (cause) {
    const detail = cause instanceof PublicationPathError ? `: ${cause.message}` : "";
    diagnostics.push(
      diagnostic(sourcePath, "warning", "NCX_INVALID_HREF", `Invalid NCX content src${detail}`),
    );
    return children;
  }
}

function parsePageTarget(
  pageTarget: Element,
  sourcePath: PublicationPath,
  diagnostics: ParseDiagnostic[],
): TocEntry | null {
  const label = getChildElementsNS(pageTarget, XML_NAMESPACES.ncx, "navLabel")[0];
  const text = label
    ? getTextContent(getChildElementsNS(label, XML_NAMESPACES.ncx, "text")[0])
    : undefined;
  const value = getAttributeNS(pageTarget, null, "value")?.trim();
  const title = text?.trim() || value || undefined;
  const content = getChildElementsNS(pageTarget, XML_NAMESPACES.ncx, "content")[0];
  const source = content ? getAttributeNS(content, null, "src")?.trim() : undefined;
  if (!source || !title) {
    diagnostics.push(
      diagnostic(
        sourcePath,
        "warning",
        "NCX_INVALID_PAGE_TARGET",
        "NCX pageTarget needs content src and a label or value",
      ),
    );
    return null;
  }
  try {
    return { title, href: resolvePublicationPath(sourcePath, source), children: [] };
  } catch (cause) {
    const detail = cause instanceof PublicationPathError ? `: ${cause.message}` : "";
    diagnostics.push(
      diagnostic(
        sourcePath,
        "warning",
        "NCX_INVALID_PAGE_HREF",
        `Invalid NCX pageTarget src${detail}`,
      ),
    );
    return null;
  }
}

export function parseNcx(source: string, sourcePath: PublicationPath): NcxParseResult {
  const parsed = parseXml(source, sourcePath);
  if (!parsed.document) return { toc: [], pageList: [], diagnostics: parsed.diagnostics };
  const root = parsed.document.documentElement;
  if (root.localName !== "ncx" || root.namespaceURI !== XML_NAMESPACES.ncx) {
    return {
      toc: [],
      pageList: [],
      diagnostics: [
        diagnostic(sourcePath, "error", "NCX_INVALID_ROOT", "NCX root or namespace is invalid"),
      ],
    };
  }
  const navMap = getChildElementsNS(root, XML_NAMESPACES.ncx, "navMap")[0];
  if (!navMap) {
    return {
      toc: [],
      pageList: [],
      diagnostics: [diagnostic(sourcePath, "error", "NCX_MISSING_NAV_MAP", "NCX has no navMap")],
    };
  }
  const diagnostics: ParseDiagnostic[] = [];
  const toc = getChildElementsNS(navMap, XML_NAMESPACES.ncx, "navPoint").flatMap((navPoint) =>
    parseNavPoint(navPoint, sourcePath, diagnostics),
  );
  const pageListElement = getChildElementsNS(root, XML_NAMESPACES.ncx, "pageList")[0];
  const pageList = pageListElement
    ? getChildElementsNS(pageListElement, XML_NAMESPACES.ncx, "pageTarget").flatMap((target) => {
        const entry = parsePageTarget(target, sourcePath, diagnostics);
        return entry ? [entry] : [];
      })
    : [];
  return { toc, pageList, diagnostics };
}
