// Public Vercel Blob URLs have a host of the form
// `<store-id>.public.blob.vercel-storage.com`, while private blobs live on
// `<store-id>.blob.vercel-storage.com`. The substring `public.blob.vercel-storage.com`
// is the simplest reliable signal that the URL can be fetched directly from the
// CDN without going through our signed-download proxy.
export function isPublicBlobUrl(url: string): boolean {
  try {
    const host = new URL(url).host;
    return host.includes("public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}
