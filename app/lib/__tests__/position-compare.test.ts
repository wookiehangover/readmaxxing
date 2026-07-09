import { describe, expect, it } from "vitest";
import { isFurtherAlong } from "~/lib/position-compare";

describe("isFurtherAlong", () => {
  it("orders epub CFIs with epubjs", () => {
    expect(isFurtherAlong("epubcfi(/6/4!/4/4/2)", "epubcfi(/6/4!/4/2/2)")).toBe(true);
    expect(isFurtherAlong("epubcfi(/6/4!/4/2/2)", "epubcfi(/6/4!/4/4/2)")).toBe(false);
    expect(isFurtherAlong("epubcfi(/6/4!/4/2/2)", "epubcfi(/6/4!/4/2/2)")).toBe(false);
  });

  it("orders PDF page pseudo-CFIs numerically", () => {
    expect(isFurtherAlong("page:12", "page:2")).toBe(true);
    expect(isFurtherAlong("page:2", "page:12")).toBe(false);
    expect(isFurtherAlong("page:2", "page:2")).toBe(false);
  });

  it("rejects mismatched or malformed positions", () => {
    expect(isFurtherAlong("page:3", "epubcfi(/6/4!/4/2/2)")).toBe(false);
    expect(isFurtherAlong("not-a-cfi", "epubcfi(/6/4!/4/2/2)")).toBe(false);
    expect(isFurtherAlong("page:0", "page:1")).toBe(false);
    expect(isFurtherAlong("page:abc", "page:1")).toBe(false);
  });
});