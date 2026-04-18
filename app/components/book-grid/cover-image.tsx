import { useBlobObjectUrl } from "~/hooks/use-blob-object-url";
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
  const remoteUrl =
    remoteCoverUrl && bookId
      ? `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=cover`
      : null;
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
