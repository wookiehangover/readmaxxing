import { useEffect, useState } from "react";
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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (coverImage) {
      const objectUrl = URL.createObjectURL(coverImage);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (remoteCoverUrl && bookId) {
      setUrl(`/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=cover`);
    }
  }, [coverImage, remoteCoverUrl, bookId]);

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
