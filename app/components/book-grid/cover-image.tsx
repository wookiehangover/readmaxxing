import { useEffect, useState } from "react";

export function CoverImage({
  coverImage,
  alt,
  remoteCoverUrl,
}: {
  coverImage: Blob | null;
  alt: string;
  remoteCoverUrl?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (coverImage) {
      const objectUrl = URL.createObjectURL(coverImage);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (remoteCoverUrl) {
      setUrl(remoteCoverUrl);
    }
  }, [coverImage, remoteCoverUrl]);

  if (!url) return null;

  return <img src={url} alt={alt} className="aspect-[2/3] w-full rounded-lg object-cover" />;
}
