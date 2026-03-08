import ePub from "epubjs";

export interface EpubMetadata {
  title: string;
  author: string;
  coverImage: Blob | null;
}

export async function parseEpub(data: ArrayBuffer): Promise<EpubMetadata> {
  const book = ePub(data);

  await book.ready;

  const metadata = await book.loaded.metadata;
  let coverImage: Blob | null = null;

  try {
    const coverHref = await book.loaded.cover;
    if (coverHref) {
      // Use the archive to get the actual image data as a Blob
      const blob = await book.archive.getBlob(coverHref);
      if (blob && blob.size > 0) {
        coverImage = blob;
      }
    }
  } catch {
    // cover may not exist in all epubs
  }

  const result: EpubMetadata = {
    title: metadata.title || "Untitled",
    author: metadata.creator || "Unknown Author",
    coverImage,
  };

  book.destroy();

  return result;
}

