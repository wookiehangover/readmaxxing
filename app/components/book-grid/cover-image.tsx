import { useBlobObjectUrl } from "~/hooks/use-blob-object-url";
import { coverCacheKey } from "~/lib/blob-url";
import { cn } from "~/lib/utils";

export function CoverImage({
  coverImage,
  alt,
  remoteCoverUrl,
  bookId,
  updatedAt,
  needsDownload,
}: {
  coverImage: Blob | null;
  alt: string;
  remoteCoverUrl?: string;
  bookId?: string;
  updatedAt?: number;
  needsDownload?: boolean;
}) {
  const cacheKey = coverCacheKey({ remoteCoverUrl, updatedAt });
  const versionParam = cacheKey ? `&v=${encodeURIComponent(cacheKey)}` : "";
  const proxyUrl =
    remoteCoverUrl && bookId
      ? `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=cover${versionParam}`
      : null;
  const remoteUrl = proxyUrl;
  const fallbackBlobUrl = useBlobObjectUrl(remoteUrl ? null : coverImage, bookId ?? null);
  const url = remoteUrl ?? fallbackBlobUrl;

  if (!url) return null;

  return (
    <img
      src={url}
      alt={alt}
      className={cn("aspect-2/3 w-full object-cover book-cover-image", {
        "grayscale opacity-50": needsDownload,
      })}
    />
  );
}
