export type StoredBlobType = "file" | "cover";
export type R2StorageBucket = "files" | "covers";

export type StoredBlobReference = {
  readonly kind: "r2";
  readonly bucket: R2StorageBucket;
  readonly key: string;
};

const R2_BUCKET_BY_TYPE = {
  file: "files",
  cover: "covers",
} as const satisfies Record<StoredBlobType, R2StorageBucket>;

export function r2StorageUrl(type: StoredBlobType, key: string): string {
  return `r2://${R2_BUCKET_BY_TYPE[type]}/${key.replace(/^\/+/, "")}`;
}

export function parseStoredBlobReference(
  value: string,
  expectedType?: StoredBlobType,
): StoredBlobReference | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol === "r2:") {
      const bucket = url.hostname;
      if (bucket !== "files" && bucket !== "covers") return null;
      const key = url.pathname.replace(/^\/+/, "");
      if (!key) return null;
      return { kind: "r2", bucket, key };
    }
  } catch {
    if (expectedType && !value.includes("://")) {
      const key = value.replace(/^\/+/, "");
      if (!key) return null;
      return {
        kind: "r2",
        bucket: R2_BUCKET_BY_TYPE[expectedType],
        key,
      };
    }
  }

  return null;
}

type CoverCacheKeyBook = {
  readonly coverBlobUrl?: string | null;
  readonly remoteCoverUrl?: string | null;
  readonly updatedAt?: number | null;
};

export function coverCacheKey(book: CoverCacheKeyBook): string | null {
  const coverUrl = book.coverBlobUrl ?? book.remoteCoverUrl;
  if (!coverUrl) return null;

  const reference = parseStoredBlobReference(coverUrl, "cover");
  const storageKey = reference?.kind === "r2" ? `${reference.bucket}/${reference.key}` : coverUrl;

  if (typeof book.updatedAt === "number" && Number.isFinite(book.updatedAt)) {
    return `${storageKey}:${Math.trunc(book.updatedAt)}`;
  }

  return storageKey;
}
