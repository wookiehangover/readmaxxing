import { parseEpubEffect } from "~/lib/epub-service";
import { AppRuntime } from "~/lib/effect-runtime";

export type { EpubMetadata } from "~/lib/epub-service";

/**
 * Parse an epub file and extract metadata.
 * This is a convenience wrapper that runs the EpubService effect.
 */
export async function parseEpub(
  data: ArrayBuffer,
): Promise<import("~/lib/epub-service").EpubMetadata> {
  return AppRuntime.runPromise(parseEpubEffect(data));
}
