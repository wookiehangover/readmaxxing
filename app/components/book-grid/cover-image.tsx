import { useBlobObjectUrl } from "~/hooks/use-blob-object-url";
import { isPublicBlobUrl } from "~/lib/blob-url";
import { cn } from "~/lib/utils";

export function CoverImage({
  coverImage,
  alt,
  remoteCoverUrl,
  bookId,
  needsDownload,
}: {
  coverImage: Blob | null;
  alt: string;
  remoteCoverUrl?: string;
  bookId?: string;
  needsDownload?: boolean;
}) {
  const directUrl = remoteCoverUrl && isPublicBlobUrl(remoteCoverUrl) ? remoteCoverUrl : null;
  const proxyUrl =
    !directUrl && remoteCoverUrl && bookId
      ? `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=cover`
      : null;
  const remoteUrl = directUrl ?? proxyUrl;
  const fallbackBlobUrl = useBlobObjectUrl(remoteUrl ? null : coverImage, bookId ?? null);
  const url = remoteUrl ?? fallbackBlobUrl;

  if (!url) return null;

  return (
    <img
      src={url}
      alt={alt}
      className={cn("aspect-[2/3] w-full rounded-lg object-cover", {
        "grayscale opacity-50": needsDownload,
      })}
    />
  );
}
