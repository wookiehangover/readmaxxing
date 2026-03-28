import { parseHTML } from "linkedom";
import type { Route } from "./+types/api.standard-ebooks.search";
import type { SEBook, SESearchResult } from "~/lib/standard-ebooks";

const SE_BASE = "https://standardebooks.org";

function parseSearchHtml(html: string, page: number): SESearchResult {
  const { document: doc } = parseHTML(html);
  const items = doc.querySelectorAll('li[typeof="schema:Book"]');
  const books: SEBook[] = [];

  items.forEach((li) => {
    const titleEl = li.querySelector('[property="schema:name"]');
    const authorEl = li.querySelector('[typeof="schema:Person"] [property="schema:name"]');
    const imgEl = li.querySelector("img");
    const aboutAttr = li.getAttribute("about");

    if (titleEl && authorEl) {
      books.push({
        title: titleEl.textContent?.trim() ?? "",
        author: authorEl.textContent?.trim() ?? "",
        urlPath: aboutAttr ?? "",
        coverUrl: imgEl ? `${SE_BASE}${imgEl.getAttribute("src")}` : null,
      });
    }
  });

  let totalPages = 1;
  const paginationLinks = doc.querySelectorAll("nav.pagination a");
  paginationLinks.forEach((a) => {
    const pageNum = parseInt(a.textContent?.trim() ?? "", 10);
    if (!isNaN(pageNum) && pageNum > totalPages) {
      totalPages = pageNum;
    }
  });

  return { books, currentPage: page, totalPages };
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("query") ?? "";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);

  const params = query
    ? new URLSearchParams({
        query,
        "per-page": "12",
        page: String(page),
      })
    : new URLSearchParams({
        "per-page": "12",
        page: String(page),
        sort: "popularity",
      });

  const res = await fetch(`${SE_BASE}/ebooks?${params.toString()}`);
  if (!res.ok) {
    throw new Response(`Standard Ebooks returned ${res.status}`, {
      status: 502,
    });
  }

  const html = await res.text();
  const data = parseSearchHtml(html, page);

  return Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
