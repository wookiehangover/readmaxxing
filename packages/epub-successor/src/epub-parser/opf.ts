import {
  createMediaType,
  type Contributor,
  type Link,
  type Metadata,
  type PageProgressionDirection,
  type Presentation,
  type Publication,
} from "../publication-model/publication-model";
import {
  normalizePublicationPath,
  PublicationPathError,
  resolvePublicationPath,
  type PublicationPath,
} from "../publication-model/paths";
import {
  getAttributeNS,
  getChildElementsNS,
  getElementsNS,
  getFirstElementNS,
  getTextContent,
  parseXml,
  type ParseDiagnostic,
  XML_NAMESPACES,
} from "./xml";

export interface OpfParseResult {
  readonly publication: Publication | null;
  readonly manifest: ReadonlyMap<string, Link>;
  readonly fallbackChains: ReadonlyMap<string, readonly Link[]>;
  readonly diagnostics: readonly ParseDiagnostic[];
}

export type EncryptionKind = "adobe-font-obfuscation" | "idpf-font-obfuscation" | "unsupported";

export interface EncryptionEntry {
  readonly href: PublicationPath;
  readonly algorithm: string;
  readonly kind: EncryptionKind;
}

export interface EncryptionParseResult {
  readonly entries: readonly EncryptionEntry[];
  readonly diagnostics: readonly ParseDiagnostic[];
}

interface ManifestRecord {
  link: Link;
  readonly fallbackId?: string;
}

interface ParsedMetadata {
  readonly metadata: Metadata;
  readonly coverId?: string;
}

const XML_ENCRYPTION_NAMESPACE = "http://www.w3.org/2001/04/xmlenc#";
const IDPF_OBFUSCATION = "http://www.idpf.org/2008/embedding";
const ADOBE_OBFUSCATION = "http://ns.adobe.com/pdf/enc#RC";
export const ENCRYPTION_PATH = normalizePublicationPath("META-INF/encryption.xml");

function diagnostic(
  sourcePath: PublicationPath,
  severity: ParseDiagnostic["severity"],
  code: string,
  message: string,
): ParseDiagnostic {
  return { severity, code, message, sourcePath };
}

function tokens(value: string | undefined): string[] {
  return value?.trim().split(/\s+/).filter(Boolean) ?? [];
}

function directChild(parent: Element, name: string): Element | undefined {
  return getChildElementsNS(parent, XML_NAMESPACES.opf, name)[0];
}

function parseRefinements(metadata: Element): ReadonlyMap<string, ReadonlyMap<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>();
  for (const meta of getChildElementsNS(metadata, XML_NAMESPACES.opf, "meta")) {
    const target = getAttributeNS(meta, null, "refines")?.trim();
    const property = getAttributeNS(meta, null, "property")?.trim();
    const value = getTextContent(meta);
    if (!target?.startsWith("#") || !property || !value) continue;
    const properties = result.get(target.slice(1)) ?? new Map<string, string[]>();
    const values = properties.get(property) ?? [];
    values.push(value);
    properties.set(property, values);
    result.set(target.slice(1), properties);
  }
  return result;
}

function metaValue(metadata: Element, property: string): string | undefined {
  for (const meta of getChildElementsNS(metadata, XML_NAMESPACES.opf, "meta")) {
    if (getAttributeNS(meta, null, "property")?.trim() === property) return getTextContent(meta);
    if (getAttributeNS(meta, null, "name")?.trim() === property) {
      return getAttributeNS(meta, null, "content")?.trim();
    }
  }
  return undefined;
}

function parseViewport(value: string | undefined): Presentation["viewport"] {
  if (!value) return undefined;
  const width = /(?:^|,)\s*width\s*=\s*([0-9]+(?:\.[0-9]+)?)/i.exec(value)?.[1];
  const height = /(?:^|,)\s*height\s*=\s*([0-9]+(?:\.[0-9]+)?)/i.exec(value)?.[1];
  if (!width || !height) return undefined;
  return { width: Number(width), height: Number(height) };
}

function parsePresentation(metadata: Element): Presentation | undefined {
  const layoutValue = metaValue(metadata, "rendition:layout");
  const flowValue = metaValue(metadata, "rendition:flow");
  const orientationValue = metaValue(metadata, "rendition:orientation");
  const spreadValue = metaValue(metadata, "rendition:spread");
  const viewport = parseViewport(metaValue(metadata, "rendition:viewport"));
  const layout =
    layoutValue === "pre-paginated"
      ? "fixed"
      : layoutValue === "reflowable"
        ? "reflowable"
        : undefined;
  const flow = ["auto", "paginated", "scrolled-continuous", "scrolled-doc"].includes(
    flowValue ?? "",
  )
    ? (flowValue as Presentation["flow"])
    : undefined;
  const orientation = ["auto", "landscape", "portrait"].includes(orientationValue ?? "")
    ? (orientationValue as Presentation["orientation"])
    : undefined;
  const spread = ["auto", "both", "landscape", "none", "portrait"].includes(spreadValue ?? "")
    ? (spreadValue as Presentation["spread"])
    : undefined;
  return layout || flow || orientation || spread || viewport
    ? { layout, flow, orientation, spread, viewport }
    : undefined;
}

function parseMetadata(metadata: Element | undefined, packageElement: Element): ParsedMetadata {
  if (!metadata) return { metadata: { title: "Untitled", languages: [], authors: [] } };
  const refinements = parseRefinements(metadata);
  const titles = getChildElementsNS(metadata, XML_NAMESPACES.dc, "title");
  const mainTitle = titles.find((title) => {
    const id = getAttributeNS(title, null, "id");
    return id && refinements.get(id)?.get("title-type")?.includes("main");
  });
  const title = getTextContent(mainTitle ?? titles[0]) ?? "Untitled";
  const identifiers = getChildElementsNS(metadata, XML_NAMESPACES.dc, "identifier");
  const uniqueId = getAttributeNS(packageElement, null, "unique-identifier")?.trim();
  const identifier = getTextContent(
    identifiers.find((element) => getAttributeNS(element, null, "id") === uniqueId) ??
      identifiers[0],
  );
  const languages = getChildElementsNS(metadata, XML_NAMESPACES.dc, "language")
    .map(getTextContent)
    .filter((value): value is string => value !== undefined);
  const authors: Contributor[] = [];
  for (const creator of getChildElementsNS(metadata, XML_NAMESPACES.dc, "creator")) {
    const name = getTextContent(creator);
    if (!name) continue;
    const id = getAttributeNS(creator, null, "id");
    const refined = id ? refinements.get(id) : undefined;
    const roles =
      refined?.get("role") ?? tokens(getAttributeNS(creator, XML_NAMESPACES.opf, "role"));
    const sortAs =
      refined?.get("file-as")?.[0] ?? getAttributeNS(creator, XML_NAMESPACES.opf, "file-as");
    authors.push({ name, roles, sortAs });
  }
  const presentation = parsePresentation(metadata);
  const coverId = metaValue(metadata, "cover");
  return {
    metadata: { title, languages, identifier, authors, presentation },
    coverId,
  };
}

function buildManifest(
  manifest: Element | undefined,
  sourcePath: PublicationPath,
  coverId: string | undefined,
  diagnostics: ParseDiagnostic[],
): Map<string, ManifestRecord> {
  const result = new Map<string, ManifestRecord>();
  if (!manifest) {
    diagnostics.push(
      diagnostic(sourcePath, "error", "OPF_MISSING_MANIFEST", "Package has no manifest"),
    );
    return result;
  }
  for (const item of getChildElementsNS(manifest, XML_NAMESPACES.opf, "item")) {
    const id = getAttributeNS(item, null, "id")?.trim();
    const href = getAttributeNS(item, null, "href")?.trim();
    if (!id || !href) {
      diagnostics.push(
        diagnostic(
          sourcePath,
          "error",
          "OPF_INVALID_MANIFEST_ITEM",
          "Manifest item needs id and href",
        ),
      );
      continue;
    }
    if (result.has(id)) {
      diagnostics.push(
        diagnostic(
          sourcePath,
          "warning",
          "OPF_DUPLICATE_MANIFEST_ID",
          `Duplicate manifest id: ${id}`,
        ),
      );
      continue;
    }
    let resolved: PublicationPath;
    try {
      resolved = resolvePublicationPath(sourcePath, href);
    } catch (cause) {
      const detail = cause instanceof PublicationPathError ? `: ${cause.message}` : "";
      diagnostics.push(
        diagnostic(
          sourcePath,
          "error",
          "OPF_INVALID_MANIFEST_HREF",
          `Invalid manifest href${detail}`,
        ),
      );
      continue;
    }
    const properties = tokens(getAttributeNS(item, null, "properties"));
    if (id === coverId && !properties.includes("cover-image")) properties.push("cover-image");
    const rel = [
      ...(properties.includes("nav") ? ["contents"] : []),
      ...(properties.includes("cover-image") ? ["cover"] : []),
    ];
    let mediaType;
    const mediaTypeValue = getAttributeNS(item, null, "media-type")?.trim();
    if (mediaTypeValue) {
      try {
        mediaType = createMediaType(mediaTypeValue);
      } catch {
        diagnostics.push(
          diagnostic(
            sourcePath,
            "warning",
            "OPF_INVALID_MEDIA_TYPE",
            `Invalid media type for ${id}`,
          ),
        );
      }
    }
    result.set(id, {
      link: { href: resolved, mediaType, rel, properties },
      fallbackId: getAttributeNS(item, null, "fallback")?.trim(),
    });
  }
  return result;
}

function resolveFallbacks(
  manifest: ReadonlyMap<string, ManifestRecord>,
  sourcePath: PublicationPath,
  diagnostics: ParseDiagnostic[],
): Map<string, readonly Link[]> {
  const result = new Map<string, readonly Link[]>();
  const reported = new Set<string>();
  for (const [id, record] of manifest) {
    const chain: Link[] = [];
    const visited = new Set([id]);
    let fallbackId = record.fallbackId;
    while (fallbackId) {
      if (visited.has(fallbackId)) {
        const key = `cycle:${[...visited].sort().join(",")}`;
        if (!reported.has(key)) {
          diagnostics.push(
            diagnostic(
              sourcePath,
              "warning",
              "OPF_FALLBACK_CYCLE",
              `Fallback cycle includes ${fallbackId}`,
            ),
          );
          reported.add(key);
        }
        break;
      }
      visited.add(fallbackId);
      const fallback = manifest.get(fallbackId);
      if (!fallback) {
        const key = `missing:${fallbackId}`;
        if (!reported.has(key)) {
          diagnostics.push(
            diagnostic(
              sourcePath,
              "warning",
              "OPF_MISSING_FALLBACK",
              `Fallback manifest item not found: ${fallbackId}`,
            ),
          );
          reported.add(key);
        }
        break;
      }
      chain.push(fallback.link);
      fallbackId = fallback.fallbackId;
    }
    result.set(id, chain);
  }
  return result;
}

function parseSpine(
  spine: Element | undefined,
  manifest: ReadonlyMap<string, ManifestRecord>,
  sourcePath: PublicationPath,
  diagnostics: ParseDiagnostic[],
): { readingOrder: Link[]; usedIds: Set<string>; direction?: PageProgressionDirection } {
  const readingOrder: Link[] = [];
  const usedIds = new Set<string>();
  let direction: PageProgressionDirection | undefined;
  if (!spine) {
    diagnostics.push(diagnostic(sourcePath, "error", "OPF_MISSING_SPINE", "Package has no spine"));
    return { readingOrder, usedIds };
  }
  const directionValue = getAttributeNS(spine, null, "page-progression-direction")?.trim();
  if (directionValue === "default" || directionValue === "ltr" || directionValue === "rtl") {
    direction = directionValue;
  }
  for (const itemref of getChildElementsNS(spine, XML_NAMESPACES.opf, "itemref")) {
    const idref = getAttributeNS(itemref, null, "idref")?.trim();
    if (!idref) {
      diagnostics.push(
        diagnostic(sourcePath, "error", "OPF_SPINE_MISSING_IDREF", "Spine item has no idref"),
      );
      continue;
    }
    if (usedIds.has(idref)) {
      diagnostics.push(
        diagnostic(
          sourcePath,
          "warning",
          "OPF_DUPLICATE_SPINE_REF",
          `Duplicate spine reference: ${idref}`,
        ),
      );
    }
    usedIds.add(idref);
    const item = manifest.get(idref);
    if (!item) {
      diagnostics.push(
        diagnostic(sourcePath, "error", "OPF_MISSING_SPINE_ITEM", `Spine item not found: ${idref}`),
      );
      continue;
    }
    const properties = [
      ...new Set([...item.link.properties, ...tokens(getAttributeNS(itemref, null, "properties"))]),
    ];
    readingOrder.push({
      ...item.link,
      linear: getAttributeNS(itemref, null, "linear")?.trim().toLowerCase() !== "no",
      properties,
    });
  }
  return { readingOrder, usedIds, direction };
}

export function parseOpf(source: string, sourcePath: PublicationPath): OpfParseResult {
  const parsed = parseXml(source, sourcePath);
  if (!parsed.document) {
    return {
      publication: null,
      manifest: new Map(),
      fallbackChains: new Map(),
      diagnostics: parsed.diagnostics,
    };
  }
  const root = parsed.document.documentElement;
  if (root.localName !== "package" || root.namespaceURI !== XML_NAMESPACES.opf) {
    const diagnostics = [
      diagnostic(sourcePath, "error", "OPF_INVALID_ROOT", "Package root or namespace is invalid"),
    ];
    return { publication: null, manifest: new Map(), fallbackChains: new Map(), diagnostics };
  }
  const diagnostics: ParseDiagnostic[] = [];
  const parsedMetadata = parseMetadata(directChild(root, "metadata"), root);
  const records = buildManifest(
    directChild(root, "manifest"),
    sourcePath,
    parsedMetadata.coverId,
    diagnostics,
  );
  const fallbackChains = resolveFallbacks(records, sourcePath, diagnostics);
  const spine = parseSpine(directChild(root, "spine"), records, sourcePath, diagnostics);
  if (directChild(root, "bindings")) {
    diagnostics.push(
      diagnostic(
        sourcePath,
        "warning",
        "OPF_BINDINGS_UNSUPPORTED",
        "Package bindings are unsupported",
      ),
    );
  }
  const metadata: Metadata = {
    ...parsedMetadata.metadata,
    pageProgressionDirection: spine.direction,
  };
  const manifest = new Map([...records].map(([id, record]) => [id, record.link]));
  const resources = [...records]
    .filter(([id]) => !spine.usedIds.has(id))
    .map(([, record]) => record.link);
  const publication: Publication = {
    metadata,
    readingOrder: spine.readingOrder,
    resources,
    toc: [],
    landmarks: [],
    diagnostics: diagnostics.map(({ severity, code, message, sourcePath: href }) => ({
      severity,
      code,
      message,
      href,
    })),
  };
  return { publication, manifest, fallbackChains, diagnostics };
}

export function parseEncryptionXml(
  source: string,
  sourcePath: PublicationPath = ENCRYPTION_PATH,
): EncryptionParseResult {
  const parsed = parseXml(source, sourcePath);
  if (!parsed.document) return { entries: [], diagnostics: parsed.diagnostics };
  const diagnostics: ParseDiagnostic[] = [];
  const entries: EncryptionEntry[] = [];
  for (const encryptedData of getElementsNS(
    parsed.document,
    XML_ENCRYPTION_NAMESPACE,
    "EncryptedData",
  )) {
    const method = getFirstElementNS(encryptedData, XML_ENCRYPTION_NAMESPACE, "EncryptionMethod");
    const reference = getFirstElementNS(encryptedData, XML_ENCRYPTION_NAMESPACE, "CipherReference");
    const algorithm = getAttributeNS(method ?? encryptedData, null, "Algorithm")?.trim();
    const uri = getAttributeNS(reference ?? encryptedData, null, "URI")?.trim();
    if (!algorithm || !uri) {
      diagnostics.push(
        diagnostic(
          sourcePath,
          "error",
          "ENCRYPTION_INVALID_ENTRY",
          "EncryptedData needs Algorithm and URI",
        ),
      );
      continue;
    }
    let href: PublicationPath;
    try {
      href = normalizePublicationPath(uri);
    } catch {
      diagnostics.push(
        diagnostic(
          sourcePath,
          "error",
          "ENCRYPTION_INVALID_HREF",
          "Encrypted resource URI is invalid",
        ),
      );
      continue;
    }
    const kind: EncryptionKind =
      algorithm === IDPF_OBFUSCATION
        ? "idpf-font-obfuscation"
        : algorithm === ADOBE_OBFUSCATION
          ? "adobe-font-obfuscation"
          : "unsupported";
    entries.push({ href, algorithm, kind });
    diagnostics.push(
      diagnostic(
        sourcePath,
        "warning",
        kind === "unsupported"
          ? "ENCRYPTION_UNSUPPORTED_ALGORITHM"
          : "ENCRYPTION_FONT_OBFUSCATION_DEFERRED",
        kind === "unsupported"
          ? `Unsupported encryption algorithm: ${algorithm}`
          : `Font deobfuscation is deferred for ${href}`,
      ),
    );
  }
  return { entries, diagnostics };
}
