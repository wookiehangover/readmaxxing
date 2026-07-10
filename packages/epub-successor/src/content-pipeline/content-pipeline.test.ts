import { describe, expect, it } from "vitest";

import { normalizePublicationPath } from "../publication-model/paths";
import {
  assembleSectionDocument,
  CONTENT_IFRAME_SANDBOX,
  CONTENT_SECURITY_POLICY,
  PREFERENCE_STYLE_ID,
  READER_BASE_STYLE_ID,
  sanitize,
  type ContentTransform,
} from "./content-pipeline";

const XHTML = "http://www.w3.org/1999/xhtml";

function parse(markup: string): Document {
  const doc = new DOMParser().parseFromString(markup, "application/xhtml+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("Invalid fixture");
  return doc;
}

function options(transforms: readonly ContentTransform[] = []) {
  return {
    context: { sectionHref: normalizePublicationPath("OPS/chapter.xhtml"), spineIndex: 2 },
    transforms,
  };
}

describe("sanitize", () => {
  it("neutralizes HTML script, navigation, refresh, and form exfiltration vectors", () => {
    const doc = parse(
      `<html xmlns="${XHTML}"><head><meta http-equiv="refresh" content="0;url=https://evil.test"/></head><body onload="steal()"><script>alert(1)</script><a href=" java&#x0a;script:alert(1)" target="_top">bad</a><a id="data-url" href="data:text/html,%3Cscript%3Esteal()%3C/script%3E">data</a><form action="https://evil.test" target="_top"><button formaction="https://evil.test">send</button></form><p class="safe">Safe text</p></body></html>`,
    );

    sanitize(doc, options());

    expect(doc.getElementsByTagName("script")).toHaveLength(0);
    expect(doc.querySelector("meta[http-equiv='refresh']")).toBeNull();
    expect(doc.body.getAttribute("onload")).toBeNull();
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(doc.querySelector("a")?.hasAttribute("target")).toBe(false);
    expect(doc.getElementById("data-url")?.hasAttribute("href")).toBe(false);
    expect(doc.querySelector("form")?.hasAttribute("action")).toBe(false);
    expect(doc.querySelector("form")?.hasAttribute("target")).toBe(false);
    expect(doc.querySelector("button")?.hasAttribute("formaction")).toBe(false);
    expect(doc.querySelector("p")?.outerHTML).toBe('<p class="safe">Safe text</p>');
  });

  it("removes SVG script and foreignObject vectors while preserving benign SVG", () => {
    const doc = parse(
      `<html xmlns="${XHTML}"><body><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><div xmlns="${XHTML}" onclick="steal()">bad</div></foreignObject><circle id="safe" cx="5" cy="5" r="5"/></svg></body></html>`,
    );

    sanitize(doc, options());

    expect(doc.getElementsByTagNameNS("http://www.w3.org/2000/svg", "script")).toHaveLength(0);
    expect(doc.getElementsByTagNameNS("http://www.w3.org/2000/svg", "foreignObject")).toHaveLength(
      0,
    );
    expect(doc.getElementById("safe")?.localName).toBe("circle");
  });

  it("runs typed transforms before the mandatory sanitization pass", () => {
    const doc = parse(`<html xmlns="${XHTML}"><body><p>Safe</p></body></html>`);
    const transform: ContentTransform = (document, context) => {
      document.body.setAttribute("data-section", `${context.spineIndex}:${context.sectionHref}`);
      document.body.setAttribute("onclick", "steal()");
    };

    sanitize(doc, options([transform]));

    expect(doc.body.getAttribute("data-section")).toBe("2:OPS/chapter.xhtml");
    expect(doc.body.hasAttribute("onclick")).toBe(false);
  });

  it("leaves benign content byte-comparable", () => {
    const doc = parse(
      `<html xmlns="${XHTML}"><head><title>Safe</title></head><body><article><h1>Chapter</h1><p class="lead">Text &amp; more.</p></article></body></html>`,
    );
    const before = new XMLSerializer().serializeToString(doc);

    sanitize(doc, options());

    expect(new XMLSerializer().serializeToString(doc)).toBe(before);
  });
});

describe("assembleSectionDocument", () => {
  it("places CSP before publisher content and reader overrides after publisher styles", () => {
    const doc = parse(
      `<html xmlns="${XHTML}"><head><title>Chapter</title><style id="publisher">p { color: red; }</style></head><body><p>Text</p></body></html>`,
    );

    const assembled = assembleSectionDocument(doc, {
      ...options(),
      readerBaseCss: "body { margin: 0; }",
      preferenceCss: "p { color: blue; }",
    });
    const head = doc.head;

    expect(assembled.contentSecurityPolicy).toBe(CONTENT_SECURITY_POLICY);
    expect(head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect([...head.children].map((element) => element.id)).toEqual([
      "",
      "",
      "publisher",
      READER_BASE_STYLE_ID,
      PREFERENCE_STYLE_ID,
    ]);
    expect(assembled.html).toContain(`id="${PREFERENCE_STYLE_ID}"`);
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(CONTENT_IFRAME_SANDBOX).toBe("allow-same-origin");
  });

  it("creates a head and stable empty style placeholders when they are absent", () => {
    const doc = parse(`<html xmlns="${XHTML}"><body><p>Text</p></body></html>`);

    assembleSectionDocument(doc, options());

    expect(doc.head.querySelector(`#${READER_BASE_STYLE_ID}`)?.textContent).toBe("");
    expect(doc.head.querySelector(`#${PREFERENCE_STYLE_ID}`)?.textContent).toBe("");
    expect(doc.documentElement.firstElementChild).toBe(doc.head);
  });
});
