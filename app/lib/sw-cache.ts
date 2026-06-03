const COVER_PROXY_CACHE = "covers-proxy";
const COVER_PUBLIC_CACHE = "covers-public";

export async function evictCachedCover(
  bookId: string,
  remoteCoverUrl?: string,
): Promise<void> {
  const cacheStorage = globalThis.caches;
  if (!cacheStorage) return;

  const remoteCoverHref = parseUrl(remoteCoverUrl)?.href;

  await Promise.all([
    evictFromCache(cacheStorage, COVER_PROXY_CACHE, (url) => isProxyCoverForBook(url, bookId)),
    evictFromCache(cacheStorage, COVER_PUBLIC_CACHE, (url) =>
      isPublicCoverForBook(url, bookId, remoteCoverHref),
    ),
  ]);
}

async function evictFromCache(
  cacheStorage: CacheStorage,
  cacheName: string,
  matches: (url: URL) => boolean,
): Promise<void> {
  try {
    if (!(await cacheStorage.has(cacheName))) return;

    const cache = await cacheStorage.open(cacheName);
    const requests = await cache.keys();

    await Promise.all(
      requests.map(async (request) => {
        const url = parseUrl(request.url);
        if (url && matches(url)) await cache.delete(request);
      }),
    );
  } catch {
    // Cache eviction is best-effort; stale covers should not break the replace flow.
  }
}

function isProxyCoverForBook(url: URL, bookId: string): boolean {
  return (
    url.pathname === "/api/sync/files/download" &&
    url.searchParams.get("type") === "cover" &&
    url.searchParams.get("bookId") === bookId
  );
}

function isPublicCoverForBook(url: URL, bookId: string, remoteCoverHref?: string): boolean {
  if (remoteCoverHref && url.href === remoteCoverHref) return true;

  const segments = url.pathname.split("/").map(decodePathSegment);
  const coversIndex = segments.indexOf("covers");
  if (coversIndex === -1) return false;

  return segments.slice(coversIndex + 1).includes(bookId);
}

function parseUrl(value?: string): URL | null {
  if (!value) return null;

  try {
    return new URL(value, globalThis.location?.origin ?? "http://localhost");
  } catch {
    return null;
  }
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}