import type { PublicationPath } from "../publication-model/paths";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "poster",
  "src",
  "xlink:href",
]);

/**
 * Same-origin is needed for parent-owned measurement and selection. Scripts are
 * deliberately not granted; never combine this value with `allow-scripts`.
 */
export const CONTENT_IFRAME_SANDBOX = "allow-same-origin" as const;
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src blob:; font-src blob:; media-src blob:; " +
  "style-src 'unsafe-inline' blob:; connect-src 'none'; " +
  "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export const READER_BASE_STYLE_ID = "epub-successor-reader-base-style";
export const PREFERENCE_STYLE_ID = "epub-successor-preference-style";

/** Stable section identity available to every content transform. */
export interface ContentTransformContext {
  readonly sectionHref: PublicationPath;
  readonly spineIndex: number;
}

/** A synchronous DOM transform. Its output is always sanitized before serialization. */
export type ContentTransform = (doc: Document, context: ContentTransformContext) => void;

export interface SanitizeOptions {
  readonly context: ContentTransformContext;
  readonly transforms?: readonly ContentTransform[];
}

export interface AssembleSectionDocumentOptions extends SanitizeOptions {
  readonly readerBaseCss?: string;
  readonly preferenceCss?: string;
}

export interface AssembledSectionDocument {
  readonly html: string;
  readonly contentSecurityPolicy: string;
}

export function sanitize(doc: Document, options: SanitizeOptions): Document {
  for (const transform of options.transforms ?? []) transform(doc, options.context);

  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    const name = element.localName.toLowerCase();
    if (name === "script" || name === "foreignobject") {
      element.remove();
      continue;
    }
    if (name === "meta" && element.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh") {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (attribute.localName.toLowerCase().startsWith("on")) {
        element.removeAttributeNode(attribute);
        continue;
      }
      if (name === "form" && attributeName === "action") {
        element.removeAttributeNode(attribute);
        continue;
      }
      if (attributeName === "formaction") {
        element.removeAttributeNode(attribute);
        continue;
      }
      if (attributeName === "target" && attribute.value.trim().toLowerCase() === "_top") {
        element.removeAttributeNode(attribute);
        continue;
      }
      if (URL_ATTRIBUTES.has(attributeName) && isDangerousUrl(attribute.value)) {
        element.removeAttributeNode(attribute);
      }
    }

    const srcset = element.getAttribute("srcset");
    if (srcset !== null && containsDangerousUrl(srcset)) element.removeAttribute("srcset");
  }

  return doc;
}

export function assembleSectionDocument(
  doc: Document,
  options: AssembleSectionDocumentOptions,
): AssembledSectionDocument {
  sanitize(doc, options);
  const head = ensureHead(doc);

  for (const meta of Array.from(head.getElementsByTagName("meta"))) {
    if (meta.getAttribute("http-equiv")?.trim().toLowerCase() === "content-security-policy") {
      meta.remove();
    }
  }

  const cspMeta = doc.createElementNS(XHTML_NAMESPACE, "meta");
  cspMeta.setAttribute("http-equiv", "Content-Security-Policy");
  cspMeta.setAttribute("content", CONTENT_SECURITY_POLICY);
  head.insertBefore(cspMeta, head.firstChild);

  appendStyle(doc, head, READER_BASE_STYLE_ID, options.readerBaseCss ?? "");
  appendStyle(doc, head, PREFERENCE_STYLE_ID, options.preferenceCss ?? "");

  return {
    html: new XMLSerializer().serializeToString(doc),
    contentSecurityPolicy: CONTENT_SECURITY_POLICY,
  };
}

function ensureHead(doc: Document): Element {
  const existing = [...doc.getElementsByTagName("*")].find(
    (element) => element.localName.toLowerCase() === "head",
  );
  if (existing) return existing;

  const head = doc.createElementNS(XHTML_NAMESPACE, "head");
  const root = doc.documentElement;
  const body = [...root.children].find((element) => element.localName.toLowerCase() === "body");
  root.insertBefore(head, body ?? root.firstChild);
  return head;
}

function appendStyle(doc: Document, head: Element, id: string, css: string): void {
  const existing = doc.getElementById(id);
  if (existing) existing.remove();
  const style = doc.createElementNS(XHTML_NAMESPACE, "style");
  style.id = id;
  style.textContent = css;
  head.append(style);
}

function containsDangerousUrl(value: string): boolean {
  return value
    .split(",")
    .some((candidate) => isDangerousUrl(candidate.trim().split(/[\t\n\f\r ]+/)[0] ?? ""));
}

function isDangerousUrl(value: string): boolean {
  let canonical = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code > 32 && code !== 127) canonical += character.toLowerCase();
  }
  return canonical.startsWith("javascript:") || /^data:text\/html(?:[;,]|$)/.test(canonical);
}
