import type { Route } from "./+types/api.standard-ebooks.download";

const SE_BASE = "https://standardebooks.org";

function deriveEpubDownloadUrl(urlPath: string): string {
  const segments = urlPath.replace(/^\/ebooks\//, "").split("/");
  const filename = segments.join("_") + ".epub";
  return `${SE_BASE}${urlPath}/downloads/${filename}?source=feed`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path");

  if (!path) {
    throw new Response("Missing path parameter", { status: 400 });
  }

  const downloadUrl = deriveEpubDownloadUrl(path);
  const res = await fetch(downloadUrl);

  if (!res.ok) {
    throw new Response(`Standard Ebooks returned ${res.status}`, {
      status: 502,
    });
  }

  const body = await res.arrayBuffer();

  return new Response(body, {
    headers: {
      "Content-Type": "application/epub+zip",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
