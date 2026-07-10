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

export function parseNcx(source: string, sourcePath: PublicationPath): NcxParseResult {
  const parsed = parseXml(source, sourcePath);
  if (!parsed.document) return { toc: [], diagnostics: parsed.diagnostics };
  const root = parsed.document.documentElement;
  if (root.localName !== "ncx" || root.namespaceURI !== XML_NAMESPACES.ncx) {
    return {
      toc: [],
      diagnostics: [
        diagnostic(sourcePath, "error", "NCX_INVALID_ROOT", "NCX root or namespace is invalid"),
      ],
    };
  }
  const navMap = getChildElementsNS(root, XML_NAMESPACES.ncx, "navMap")[0];
  if (!navMap) {
    return {
      toc: [],
      diagnostics: [diagnostic(sourcePath, "error", "NCX_MISSING_NAV_MAP", "NCX has no navMap")],
    };
  }
  const diagnostics: ParseDiagnostic[] = [];
  const toc = getChildElementsNS(navMap, XML_NAMESPACES.ncx, "navPoint").flatMap((navPoint) =>
    parseNavPoint(navPoint, sourcePath, diagnostics),
  );
  return { toc, diagnostics };
}
