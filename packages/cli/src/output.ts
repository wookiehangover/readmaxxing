import { createWriteStream } from "node:fs";
import { link, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";

export function safeFilename(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 120) || "book"
  );
}

/** Write beside the destination, then publish only a complete download. */
export async function writeOutput(
  response: Response,
  path: string,
  force = false,
  progress?: (loaded: number, total?: number) => void,
): Promise<void> {
  if (!response.body) throw new Error("Server returned an empty response body.");
  const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  let loaded = 0;
  const length = Number(response.headers.get("content-length"));
  const total = !response.headers.has("content-encoding") && length > 0 ? length : undefined;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      loaded += chunk.length;
      progress?.(loaded, total);
      callback(null, chunk);
    },
  });
  const input = [source, meter] as const;
  if (path === "-") {
    await pipeline(...input, process.stdout, { end: false });
    return;
  }
  const destination = resolve(path);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await pipeline(...input, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    if (force) await rename(temporary, destination);
    else await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(`File exists: ${path}. Use --force to replace it.`);
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}
