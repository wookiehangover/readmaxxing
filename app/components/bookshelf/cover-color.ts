export interface CoverColors {
  cloth: string;
  ink: string;
}

/** Group nearby pixel colors so small differences in texture do not split the dominant color. */
export function dominantCoverColors(pixels: Uint8ClampedArray): CoverColors | null {
  const groups = new Map<number, { count: number; red: number; green: number; blue: number }>();
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 128) continue;
    const [red, green, blue] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    const key = ((red >> 6) << 4) | ((green >> 6) << 2) | (blue >> 6);
    const group = groups.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    group.count += 1;
    group.red += red;
    group.green += green;
    group.blue += blue;
    groups.set(key, group);
  }

  const dominant = [...groups.values()].sort((a, b) => b.count - a.count)[0];
  if (!dominant) return null;
  const channels = [dominant.red, dominant.green, dominant.blue].map((sum) =>
    Math.round(sum / dominant.count),
  );
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return {
    cloth: `rgb(${channels.join(", ")})`,
    ink: luminance > 0.179 ? "#000000" : "#ffffff",
  };
}

/** Sample the decoded cover already displayed in the DOM; no additional image download is needed. */
export function readCoverColors(image: HTMLImageElement): CoverColors | null {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return dominantCoverColors(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    // An unreadable or cross-origin cover keeps the fallback spine colors.
    return null;
  }
}
