import { describe, expect, it } from "vitest";

import { normalizePublicationPath, PublicationPathError, resolvePublicationPath } from "./paths";

describe("normalizePublicationPath", () => {
  it("normalizes dot segments, separators, and duplicate slashes", () => {
    expect(normalizePublicationPath("./OPS\\text//chapter.xhtml")).toBe("OPS/text/chapter.xhtml");
  });

  it("preserves percent encoding and fragments", () => {
    expect(normalizePublicationPath("OPS/chapter%201.xhtml#part%202")).toBe(
      "OPS/chapter%201.xhtml#part%202",
    );
  });

  it.each(["../secret", "OPS/../secret", "%2e%2e/secret", "OPS/%2E%2E/secret"])(
    "rejects traversal in %s",
    (path) => {
      expect(() => normalizePublicationPath(path)).toThrow(PublicationPathError);
    },
  );

  it.each(["/OPS/chapter.xhtml", "https://example.com/chapter.xhtml", "OPS/%2fsecret"])(
    "rejects non-package path %s",
    (path) => {
      expect(() => normalizePublicationPath(path)).toThrow(PublicationPathError);
    },
  );
});

describe("resolvePublicationPath", () => {
  const base = normalizePublicationPath("EPUB/package.opf");

  it("resolves nested and parent-relative references", () => {
    expect(resolvePublicationPath(base, "./text/chapter.xhtml")).toBe("EPUB/text/chapter.xhtml");
    expect(resolvePublicationPath(base, "../images/cover.jpg")).toBe("images/cover.jpg");
  });

  it("preserves percent encoding while resolving", () => {
    expect(resolvePublicationPath(base, "text/chapter%201.xhtml#part%202")).toBe(
      "EPUB/text/chapter%201.xhtml#part%202",
    );
  });

  it("resolves fragment-only references against the base resource", () => {
    expect(resolvePublicationPath(base, "#toc")).toBe("EPUB/package.opf#toc");
  });

  it.each(["../../secret", "%2e%2e/secret", "/secret"])(
    "rejects traversal or absolute reference %s",
    (reference) => {
      expect(() => resolvePublicationPath(base, reference)).toThrow(PublicationPathError);
    },
  );
});
