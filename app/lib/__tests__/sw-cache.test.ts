import { afterEach, describe, expect, it, vi } from "vitest";

import { evictCachedCover } from "~/lib/sw-cache";

interface MockCache {
  deletedUrls: string[];
  keys: () => Promise<Request[]>;
  delete: (request: Request) => Promise<boolean>;
}

function makeCache(urls: string[]): MockCache {
  const requests = urls.map((url) => new Request(url));
  const deletedUrls: string[] = [];

  return {
    deletedUrls,
    keys: vi.fn<() => Promise<Request[]>>().mockResolvedValue(requests),
    delete: vi.fn<(request: Request) => Promise<boolean>>().mockImplementation(async (request) => {
      deletedUrls.push(request.url);
      return true;
    }),
  };
}

function installCaches(caches: Record<string, MockCache>) {
  const cacheStorage = {
    has: vi
      .fn<(cacheName: string) => Promise<boolean>>()
      .mockImplementation(async (cacheName) => cacheName in caches),
    open: vi
      .fn<(cacheName: string) => Promise<MockCache>>()
      .mockImplementation(async (cacheName) => {
        const cache = caches[cacheName];
        if (!cache) throw new Error(`Missing cache: ${cacheName}`);
        return cache;
      }),
  };

  vi.stubGlobal("caches", cacheStorage);
  return cacheStorage;
}

describe("evictCachedCover", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes matching cover entries and keeps non-matching entries", async () => {
    const proxyCache = makeCache([
      "https://reader.test/api/sync/files/download?bookId=book-1&type=cover&v=old",
      "https://reader.test/api/sync/files/download?type=cover&bookId=book-1&v=new",
      "https://reader.test/api/sync/files/download?bookId=book-2&type=cover&v=old",
      "https://reader.test/api/sync/files/download?bookId=book-1&type=file&v=old",
    ]);
    const publicCache = makeCache([
      "https://store.public.blob.vercel-storage.com/covers/user-1/book-1/old.jpg",
      "https://store.public.blob.vercel-storage.com/covers/user-1/book-2/old.jpg",
      "https://store.public.blob.vercel-storage.com/covers/user-1/book-10/old.jpg",
      "https://store.public.blob.vercel-storage.com/files/user-1/book-1/old.jpg",
    ]);
    installCaches({ "covers-proxy": proxyCache, "covers-public": publicCache });

    await evictCachedCover("book-1");

    expect(proxyCache.deletedUrls).toEqual([
      "https://reader.test/api/sync/files/download?bookId=book-1&type=cover&v=old",
      "https://reader.test/api/sync/files/download?type=cover&bookId=book-1&v=new",
    ]);
    expect(publicCache.deletedUrls).toEqual([
      "https://store.public.blob.vercel-storage.com/covers/user-1/book-1/old.jpg",
    ]);
  });

  it("opens only caches that are present", async () => {
    const proxyCache = makeCache([
      "https://reader.test/api/sync/files/download?bookId=book-1&type=cover&v=old",
    ]);
    const cacheStorage = installCaches({ "covers-proxy": proxyCache });

    await evictCachedCover("book-1");

    expect(cacheStorage.has).toHaveBeenCalledWith("covers-proxy");
    expect(cacheStorage.has).toHaveBeenCalledWith("covers-public");
    expect(cacheStorage.open).toHaveBeenCalledTimes(1);
    expect(cacheStorage.open).toHaveBeenCalledWith("covers-proxy");
    expect(proxyCache.deletedUrls).toEqual([
      "https://reader.test/api/sync/files/download?bookId=book-1&type=cover&v=old",
    ]);
  });

  it("does not throw when Cache Storage is unavailable", async () => {
    vi.stubGlobal("caches", undefined);

    await expect(evictCachedCover("book-1")).resolves.toBeUndefined();
  });
});
