import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePublicationPath, type PublicationPath } from "../publication-model/paths";
import { rewriteCss } from "./css-urls";
import { ResourceReadAbortedError } from "./resource-provider-errors";
import type { ResourceProvider } from "./resource-loader";
import {
  INTERNAL_LINK_ATTRIBUTE,
  ResourceUrlManager,
  resolvePublicationReference,
  rewriteXhtml,
} from "./urls";

class MemoryProvider implements ResourceProvider {
  readonly reads: string[] = [];

  constructor(readonly resources: Readonly<Record<string, string>>) {}

  has(path: string): boolean {
    return path in this.resources;
  }

  async read(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    this.reads.push(path);
    if (signal?.aborted) throw new ResourceReadAbortedError();
    const value = this.resources[path];
    if (value === undefined) throw new Error(`Missing test resource: ${path}`);
    return new TextEncoder().encode(value);
  }

  async readText(path: string, signal?: AbortSignal): Promise<string> {
    return new TextDecoder().decode(await this.read(path, signal));
  }

  entries(): readonly PublicationPath[] {
    return Object.keys(this.resources).map(normalizePublicationPath);
  }

  close(): void {}
}

const path = normalizePublicationPath;
let blobs: Map<string, Blob>;
let nextBlob: number;

beforeEach(() => {
  blobs = new Map();
  nextBlob = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (!(blob instanceof Blob)) throw new Error("Expected Blob test input");
    const url = `blob:test/${nextBlob++}`;
    blobs.set(url, blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResourceUrlManager", () => {
  it("lazily shares correctly typed URLs and revokes after the final lease", async () => {
    const provider = new MemoryProvider({ "OPS/images/cover.png": "image bytes" });
    const manager = new ResourceUrlManager(provider);

    expect(provider.reads).toEqual([]);
    const first = await manager.acquire(path("OPS/images/cover.png"));
    const second = await manager.acquire(path("OPS/images/cover.png"));

    expect(first.url).toBe(second.url);
    expect(provider.reads).toEqual(["OPS/images/cover.png"]);
    expect(blobs.get(first.url)?.type).toBe("image/png");
    first.dispose();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    second.revoke();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("releases scope-owned URLs and all residual URLs on manager disposal", async () => {
    const manager = new ResourceUrlManager(
      new MemoryProvider({ "OPS/a.jpg": "a", "OPS/b.jpg": "b" }),
    );
    const scope = manager.createScope();
    await scope.resourceUrl("a.jpg", path("OPS/chapter.xhtml"));
    await manager.acquire(path("OPS/b.jpg"));

    scope.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    manager.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("aborts materialization without creating a Blob URL", async () => {
    const provider: ResourceProvider = {
      has: () => true,
      entries: () => [path("OPS/slow.png")],
      close: () => {},
      readText: async () => "",
      read: (_path, signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new ResourceReadAbortedError()), {
            once: true,
          });
        }),
    };
    const manager = new ResourceUrlManager(provider);
    const controller = new AbortController();

    const pending = manager.acquire(path("OPS/slow.png"), undefined, controller.signal);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ResourceReadAbortedError);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    manager.dispose();
  });
});

describe("publication URL resolution", () => {
  it("resolves nested references and preserves fragments through PublicationPath", () => {
    expect(
      resolvePublicationReference(path("OPS/text/chapter.xhtml"), "../images/cover.svg#art"),
    ).toEqual({ path: "OPS/images/cover.svg", suffix: "#art" });
    expect(
      resolvePublicationReference(path("OPS/text/chapter.xhtml"), "https://example.com/a"),
    ).toBeUndefined();
  });

  it("rejects traversal escaping the publication root", () => {
    expect(() => resolvePublicationReference(path("OPS/chapter.xhtml"), "../../evil.png")).toThrow(
      /escapes its root/,
    );
  });
});

describe("CSS rewriting", () => {
  it("tokenizes quoted, unquoted, escaped, comment, data, and font URLs", async () => {
    const provider = new MemoryProvider({
      "OPS/images/a.png": "a",
      "OPS/images/b.png": "b",
      "OPS/fonts/book.woff2": "font",
    });
    const manager = new ResourceUrlManager(provider);
    const scope = manager.createScope();
    const css = `
      /* url(../images/not-real.png) */
      .a { background: url("../images/a.png") }
      .b { background: url(..\\/images\\/b.png) }
      .data { background: url(data:image/png;base64,AAAA) }
      @font-face { src: url('../fonts/book.woff2') format('woff2') }
    `;

    const rewritten = await rewriteCss(css, path("OPS/styles/main.css"), scope);

    expect(rewritten).toContain('url("blob:test/');
    expect(rewritten).toContain("url(blob:test/");
    expect(rewritten).toContain("url(data:image/png;base64,AAAA)");
    expect(rewritten).toContain("url(../images/not-real.png)");
    expect(provider.reads.sort()).toEqual([
      "OPS/fonts/book.woff2",
      "OPS/images/a.png",
      "OPS/images/b.png",
    ]);
    scope.dispose();
    manager.dispose();
  });

  it("recursively rewrites imports and terminates cycles with an empty stylesheet", async () => {
    const provider = new MemoryProvider({
      "OPS/styles/main.css": '@import "nested.css"; body { background: url(../images/bg.png) }',
      "OPS/styles/nested.css":
        '@import url("main.css"); @font-face { src: url(../fonts/book.woff2) }',
      "OPS/images/bg.png": "background",
      "OPS/fonts/book.woff2": "font",
    });
    const manager = new ResourceUrlManager(provider);
    const scope = manager.createScope();

    const mainUrl = await scope.stylesheetUrl("styles/main.css", path("OPS/chapter.xhtml"));
    const mainCss = await blobs.get(mainUrl)!.text();
    const nestedUrl = mainCss.match(/blob:test\/[0-9]+/)?.[0];
    const nestedCss = await blobs.get(nestedUrl!)!.text();
    const cycleUrl = nestedCss.match(/blob:test\/[0-9]+/)?.[0];

    expect(mainCss).toMatch(/@import "blob:test\/[0-9]+"/);
    expect(mainCss).toMatch(/background: url\(blob:test\/[0-9]+\)/);
    expect(nestedCss).toMatch(/@import url\("blob:test\/[0-9]+"\)/);
    expect(nestedCss).toMatch(/src: url\(blob:test\/[0-9]+\)/);
    expect(await blobs.get(cycleUrl!)!.text()).toBe("");
    expect(provider.reads.filter((value) => value.endsWith(".css"))).toEqual([
      "OPS/styles/main.css",
      "OPS/styles/nested.css",
    ]);
    scope.dispose();
    manager.dispose();
  });
});

describe("XHTML rewriting", () => {
  it("walks URL attributes, srcset, SVG xlink, stylesheets, and internal links", async () => {
    const provider = new MemoryProvider({
      "OPS/images/a.png": "a",
      "OPS/images/b.png": "b",
      "OPS/images/vector.svg": "svg",
      "OPS/media/track.mp3": "audio",
      "OPS/media/movie.mp4": "video",
      "OPS/files/sample.bin": "object",
      "OPS/styles/main.css": ".x { background: url(../images/a.png) }",
    });
    const manager = new ResourceUrlManager(provider);
    const scope = manager.createScope();
    const xhtml = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
      <head><link rel="alternate stylesheet" href="../styles/main.css" /></head><body>
      <img src="../images/a.png" srcset="../images/a.png 1x, ../images/b.png 2x" /><source src="../images/a.png" srcset="../images/a.png 1x, ../images/b.png 2x, data:image/png;base64,AAAA 3x" />
      <audio src="../media/track.mp3" /><video src="../media/movie.mp4" />
      <object data="../files/sample.bin" /><svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="../images/vector.svg#icon" /></svg>
      <a id="inside" href="next.xhtml#part">Next</a><a id="outside" href="https://example.com">Outside</a>
      </body></html>`;

    const rewritten = await rewriteXhtml(xhtml, path("OPS/text/chapter.xhtml"), scope);
    const document = new DOMParser().parseFromString(rewritten, "application/xhtml+xml");

    expect(document.querySelector("img")?.getAttribute("src")).toMatch(/^blob:test\//);
    expect(document.querySelector("img")?.getAttribute("srcset")).toMatch(
      /^blob:test\/[0-9]+ 1x, blob:test\/[0-9]+ 2x$/,
    );
    expect(document.querySelector("source")?.getAttribute("srcset")).toMatch(
      /^blob:test\/[0-9]+ 1x, blob:test\/[0-9]+ 2x, data:image\/png;base64,AAAA 3x$/,
    );
    expect(document.querySelector("link")?.getAttribute("href")).toMatch(/^blob:test\//);
    expect(
      document.querySelector("image")?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
    ).toMatch(/^blob:test\/[0-9]+#icon$/);
    expect(document.querySelector("#inside")?.getAttribute("href")).toBe("#");
    expect(document.querySelector("#inside")?.getAttribute(INTERNAL_LINK_ATTRIBUTE)).toBe(
      "OPS/text/next.xhtml#part",
    );
    expect(document.querySelector("#outside")?.getAttribute("href")).toBe("https://example.com");
    scope.dispose();
    manager.dispose();
  });
});
