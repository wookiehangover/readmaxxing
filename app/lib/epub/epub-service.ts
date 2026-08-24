import { openPublication, openZipResourceProvider } from "@readmaxxing/epub-successor";
import { EpubParseError } from "~/lib/errors";

export interface EpubMetadata {
  title: string;
  author: string;
  coverImage: Blob | null;
}

export async function parseEpub(data: ArrayBuffer): Promise<EpubMetadata> {
  let provider: Awaited<ReturnType<typeof openZipResourceProvider>>;
  try {
    provider = await openZipResourceProvider(data);
  } catch (cause) {
    throw new EpubParseError({ operation: "parseEpub:acquire", cause });
  }

  try {
    const result = await openPublication(provider);
    if (!result.publication) {
      throw new Error(
        result.diagnostics.map(({ message }) => message).join("; ") ||
          "EPUB publication could not be parsed",
      );
    }

    const { metadata, resources } = result.publication;
    let coverImage: Blob | null = null;
    const cover = resources.find(
      ({ rel, properties }) => rel.includes("cover") || properties.includes("cover-image"),
    );
    try {
      if (cover) {
        const bytes = await provider.read(cover.href);
        if (bytes.byteLength > 0) {
          coverImage = new Blob([Uint8Array.from(bytes)], {
            type: cover.mediaType,
          });
        }
      }
    } catch {
      // Cover extraction is optional and must not prevent importing the book.
    }

    return {
      title: metadata.title || "Untitled",
      author:
        metadata.authors
          .map(({ name }) => name)
          .filter(Boolean)
          .join(", ") || "Unknown Author",
      coverImage,
    } satisfies EpubMetadata;
  } catch (cause) {
    throw cause instanceof EpubParseError
      ? cause
      : new EpubParseError({ operation: "parseEpub:use", cause });
  } finally {
    provider.close();
  }
}
