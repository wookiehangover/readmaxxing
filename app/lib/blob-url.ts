export function isPublicBlobUrl(url: string): boolean {
  try {
    const host = new URL(url).host;
    return host.includes("public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

type CoverCacheKeyBook = {
  readonly coverBlobUrl?: string | null;
  readonly remoteCoverUrl?: string | null;
  readonly updatedAt?: number | null;
};

export function coverCacheKey(book: CoverCacheKeyBook): string | null {
  const coverUrl = book.coverBlobUrl ?? book.remoteCoverUrl;
  if (!coverUrl) return null;

  const hexMatches = coverUrl.match(/[0-9a-f]{32}/gi);
  const blobVersion = hexMatches?.at(-1);
  if (blobVersion) return blobVersion.toLowerCase();

  if (typeof book.updatedAt === "number" && Number.isFinite(book.updatedAt)) {
    return String(Math.trunc(book.updatedAt));
  }

  return null;
}
