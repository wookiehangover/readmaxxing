import { describe, expect, it } from "vitest";
import { dominantCoverColors } from "./cover-color";

describe("dominantCoverColors", () => {
  it("picks the dominant color family instead of averaging the whole cover", () => {
    const pixels = new Uint8ClampedArray([
      24, 80, 140, 255, 28, 84, 144, 255, 32, 88, 148, 255, 240, 220, 20, 255, 240, 240, 240, 255,
    ]);
    expect(dominantCoverColors(pixels)).toEqual({ cloth: "rgb(28, 84, 144)", ink: "#ffffff" });
  });

  it("ignores transparent pixels and uses dark ink for a light cover", () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0, 240, 220, 200, 255]);
    expect(dominantCoverColors(pixels)).toEqual({ cloth: "rgb(240, 220, 200)", ink: "#000000" });
  });

  it("leaves empty and fully transparent covers on the fallback palette", () => {
    expect(dominantCoverColors(new Uint8ClampedArray())).toBeNull();
    expect(dominantCoverColors(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull();
  });
});
