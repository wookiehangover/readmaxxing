import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, posix } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "linkedom";
import { put } from "@vercel/blob/client";
import type { ProgressUpdate } from "./terminal.js";
import { Client, type Book } from "./client.js";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

function zipEntry(bytes: Uint8Array, name: string, limit = MAX_METADATA_BYTES): Uint8Array {
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name !== name) return false;
      if (entry.originalSize > limit) throw new Error(`EPUB entry is too large: ${name}`);
      return true;
    },
  });
  if (!files[name]) throw new Error(`Invalid EPUB: missing ${name}`);
  return files[name];
}

export function epubMetadata(bytes: Uint8Array) {
  const parser = new DOMParser();
  const container = parser.parseFromString(
    strFromU8(zipEntry(bytes, "META-INF/container.xml")),
    "text/xml",
  ) as unknown as Document;
  const packagePath = Array.from(container.querySelectorAll("*"))
    .find((node) => node.localName.split(":").pop() === "rootfile")
    ?.getAttribute("full-path");
  if (!packagePath) throw new Error("Invalid EPUB: no package document.");
  const document = parser.parseFromString(
    strFromU8(zipEntry(bytes, packagePath)),
    "text/xml",
  ) as unknown as Document;
  const elements = Array.from(document.querySelectorAll("*"));
  const named = (name: string) =>
    elements.filter((node) => node.localName.split(":").pop() === name);
  const title = named("title")[0]?.textContent?.trim();
  const author =
    named("creator")
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .join(", ") || undefined;
  const coverId = named("meta")
    .find((node) => node.getAttribute("name") === "cover")
    ?.getAttribute("content");
  const coverItem = named("item").find(
    (node) =>
      node.getAttribute("properties")?.split(/\s+/).includes("cover-image") ||
      (coverId && node.getAttribute("id") === coverId),
  );
  let cover: { bytes: Uint8Array; contentType: string; extension: string } | undefined;
  const contentType = coverItem?.getAttribute("media-type") ?? "";
  const extension = (
    { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>
  )[contentType];
  if (coverItem?.getAttribute("href") && extension) {
    try {
      const path = posix.normalize(
        posix.join(posix.dirname(packagePath), decodeURIComponent(coverItem.getAttribute("href")!)),
      );
      cover = { bytes: zipEntry(bytes, path, 5 * 1024 * 1024), contentType, extension };
    } catch {
      /* A missing/oversized cover must not prevent importing the book. */
    }
  }
  return { title, author, cover };
}

async function pushBook(
  client: Client,
  id: string,
  data: Record<string, unknown>,
): Promise<string> {
  const changeId = randomUUID();
  const result = await client.json<{
    accepted: { id: string; canonicalId?: string }[];
    rejected: { id: string; reason: string }[];
  }>("/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      changes: [
        {
          id: changeId,
          entity: "book",
          entityId: id,
          operation: "put",
          data,
          timestamp: Date.now(),
          synced: false,
        },
      ],
    }),
  });
  const accepted = result.accepted.find((entry) => entry.id === changeId);
  if (!accepted)
    throw new Error(
      result.rejected.find((entry) => entry.id === changeId)?.reason ??
        "Server did not accept the book.",
    );
  return accepted.canonicalId ?? id;
}

async function uploadFile(
  client: Client,
  userId: string,
  bookId: string,
  bytes: Uint8Array,
  type: "file" | "cover",
  contentType: string,
  extension: string,
  progress?: (update: ProgressUpdate) => void,
): Promise<string> {
  const { backend } = await client.json<{ backend: string }>("/api/sync/files/upload", {
    method: "POST",
    headers: { "X-Readmax-Storage-Backend": "negotiate" },
  });
  const label = type === "file" ? "Uploading book" : "Uploading cover";
  progress?.({ label, loaded: 0, total: bytes.length });
  const body = new Blob([Uint8Array.from(bytes)], { type: contentType });
  if (backend === "local") {
    let loaded = 0;
    const stream = progress
      ? new ReadableStream<Uint8Array>({
          pull(controller) {
            const end = Math.min(loaded + 64 * 1024, bytes.length);
            controller.enqueue(bytes.subarray(loaded, end));
            loaded = end;
            progress({ label, loaded, total: bytes.length });
            if (loaded === bytes.length) controller.close();
          },
        })
      : body;
    const init: RequestInit & { duplex?: "half" } = {
      method: "POST",
      headers: { "Content-Type": contentType, "Content-Length": String(bytes.length) },
      body: stream,
      ...(progress ? { duplex: "half" as const } : {}),
    };
    const result = await client.json<{ url: string }>(
      `/api/sync/files/upload?${new URLSearchParams({ bookId, type })}`,
      init,
    );
    return result.url;
  }
  if (backend !== "vercel") throw new Error("Unknown file storage backend.");
  const pathname = `${type === "file" ? "books" : "covers"}/${userId}/${bookId}/${type === "file" ? "book" : "cover"}.${extension}`;
  // Acquire a scoped token through our redirect-safe authenticated client.
  const { clientToken } = await client.json<{ clientToken: string }>("/api/sync/files/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, clientPayload: JSON.stringify({ bookId, type }), multipart: true },
    }),
  });
  return (
    await put(pathname, body, {
      access: "private",
      token: clientToken,
      contentType,
      multipart: true,
      ...(progress
        ? {
            onUploadProgress: ({ loaded, total }: { loaded: number; total: number }) =>
              progress({ label, loaded, total }),
          }
        : {}),
    })
  ).url;
}

export async function uploadBook(
  client: Client,
  path: string,
  overrides: { title?: string; author?: string },
  progress?: (update: ProgressUpdate) => void,
): Promise<Book> {
  const format = extname(path).slice(1).toLowerCase();
  if (format !== "epub" && format !== "pdf")
    throw new Error("Upload supports .epub and .pdf files.");
  const info = await stat(path);
  if (!info.isFile() || info.size === 0 || info.size > MAX_FILE_BYTES)
    throw new Error("Book must be a nonempty file no larger than 100 MiB.");
  const bytes = await readFile(path);
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new Error("Invalid book size.");
  if (format === "pdf" && !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new Error("Invalid PDF file.");
  const metadata = format === "epub" ? epubMetadata(bytes) : undefined;
  progress?.({ label: "Checking library" });
  const { user } = await client.json<{ user: { id: string } }>("/api/auth/session");
  const id = randomUUID();
  const data = {
    id,
    title: overrides.title ?? metadata?.title ?? basename(path, extname(path)),
    author: overrides.author ?? metadata?.author ?? "Unknown Author",
    format,
    fileHash: createHash("sha256").update(bytes).digest("hex"),
  };
  const canonicalId = await pushBook(client, id, data);
  const existing = canonicalId !== id ? await client.book(canonicalId) : undefined;
  if (existing?.fileBlobUrl) return existing;
  try {
    const remoteFileUrl = await uploadFile(
      client,
      user.id,
      canonicalId,
      bytes,
      "file",
      format === "epub" ? "application/epub+zip" : "application/pdf",
      format,
      progress,
    );
    // Preserve an existing canonical book's metadata while repairing a missing file.
    const canonicalData = existing ? { id: canonicalId } : { ...data, id: canonicalId };
    progress?.({ label: "Saving book" });
    await pushBook(client, canonicalId, { ...canonicalData, remoteFileUrl });
    if (metadata?.cover) {
      const cover = metadata.cover;
      try {
        const remoteCoverUrl = await uploadFile(
          client,
          user.id,
          canonicalId,
          cover.bytes,
          "cover",
          cover.contentType,
          cover.extension,
          progress,
        );
        progress?.({ label: "Saving cover" });
        await pushBook(client, canonicalId, { ...canonicalData, remoteCoverUrl });
      } catch {
        if (progress)
          progress({ label: "Book saved", warning: "Cover upload failed; book saved." });
        else process.stderr.write("Cover upload failed; book saved.\n");
      }
    }
    return { ...(existing ?? data), id: canonicalId, fileBlobUrl: remoteFileUrl };
  } catch (cause) {
    throw new Error(
      `Upload incomplete for book ${canonicalId}: ${cause instanceof Error ? cause.message : "request failed"}. Rerun the same upload to repair it.`,
      { cause },
    );
  }
}
