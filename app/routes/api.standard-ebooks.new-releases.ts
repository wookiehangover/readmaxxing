import { parseHTML } from "linkedom";
import type { Route } from "./+types/api.standard-ebooks.new-releases";
import type { SEBook } from "~/lib/standard-ebooks";

const SE_BASE = "https://standardebooks.org";

function parseAtomFeed(xml: string): SEBook[] {
  const { document: doc } = parseHTML(xml);
  const entries = doc.querySelectorAll("entry");
  const books: SEBook[] = [];

  entries.forEach((entry) => {
    const title = entry.querySelector("title")?.textContent?.trim() ?? "";
    const authorEl = entry.querySelector("author name");
    const author = authorEl?.textContent?.trim() ?? "";
    const summary = entry.querySelector("summary")?.textContent?.trim();
    const thumbnail = entry.querySelector("thumbnail");
    const coverUrl = thumbnail?.getAttribute("url") ?? null;

    const idText = entry.querySelector("id")?.textContent?.trim() ?? "";
    const urlPath = idText.startsWith(SE_BASE) ? idText.replace(SE_BASE, "") : idText;

    const categories = entry.querySelectorAll("category");
    const subjects: string[] = [];
    categories.forEach((cat) => {
      const term = cat.getAttribute("term");
      if (term) subjects.push(term);
    });

    books.push({
      title,
      author,
      urlPath,
      coverUrl,
      summary: summary || undefined,
      subjects: subjects.length > 0 ? subjects : undefined,
    });
  });

  return books;
}

export async function loader({ request: _request }: Route.LoaderArgs) {
  const res = await fetch(`${SE_BASE}/feeds/atom/new-releases`);
  if (!res.ok) {
    throw new Response(`Standard Ebooks returned ${res.status}`, {
      status: 502,
    });
  }

  const xml = await res.text();
  const books = parseAtomFeed(xml);

  return Response.json(books, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=7200",
    },
  });
}
