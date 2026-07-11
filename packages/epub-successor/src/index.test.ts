import { describe, expect, it } from "vitest";

import { EPUB_SUCCESSOR_PACKAGE_NAME } from "./index";

describe("epub-successor package", () => {
  it("is discovered by the workspace test runner", () => {
    expect(EPUB_SUCCESSOR_PACKAGE_NAME).toBe("@readmaxxing/epub-successor");
  });
});
