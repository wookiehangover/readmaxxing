import { StandardEbooksError, DecodeError } from "~/lib/errors";

export interface SEBook {
  title: string;
  author: string;
  urlPath: string;
  coverUrl: string | null;
  summary?: string;
  subjects?: string[];
}

export interface SESearchResult {
  books: SEBook[];
  currentPage: number;
  totalPages: number;
}

function decodeBook(value: unknown): SEBook {
  if (!value || typeof value !== "object") throw new Error("Invalid book");
  const book = value as Record<string, unknown>;
  if (
    typeof book.title !== "string" ||
    typeof book.author !== "string" ||
    typeof book.urlPath !== "string" ||
    (book.coverUrl !== null && typeof book.coverUrl !== "string") ||
    (book.summary !== undefined && typeof book.summary !== "string") ||
    (book.subjects !== undefined &&
      (!Array.isArray(book.subjects) ||
        book.subjects.some((subject) => typeof subject !== "string")))
  ) {
    throw new Error("Invalid book");
  }
  return book as unknown as SEBook;
}

function decodeBooks(value: unknown): SEBook[] {
  if (!Array.isArray(value)) throw new Error("Invalid books response");
  return value.map(decodeBook);
}

export const StandardEbooksService = {
  async searchBooks(query: string, page = 1): Promise<SESearchResult> {
    let json: unknown;
    try {
      const params = new URLSearchParams({
        query,
        page: String(page),
      });
      const res = await fetch(`/api/standard-ebooks/search?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (cause) {
      throw new StandardEbooksError({ operation: "searchBooks", cause });
    }
    try {
      if (!json || typeof json !== "object") throw new Error("Invalid search response");
      const result = json as Record<string, unknown>;
      if (typeof result.currentPage !== "number" || typeof result.totalPages !== "number") {
        throw new Error("Invalid search response");
      }
      return {
        books: decodeBooks(result.books),
        currentPage: result.currentPage,
        totalPages: result.totalPages,
      };
    } catch (cause) {
      throw new DecodeError({ operation: "searchBooks", cause });
    }
  },

  async getNewReleases(): Promise<SEBook[]> {
    let json: unknown;
    try {
      const res = await fetch("/api/standard-ebooks/new-releases");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (cause) {
      throw new StandardEbooksError({ operation: "getNewReleases", cause });
    }
    try {
      return decodeBooks(json);
    } catch (cause) {
      throw new DecodeError({ operation: "getNewReleases", cause });
    }
  },

  async downloadEpub(urlPath: string): Promise<ArrayBuffer> {
    try {
      const params = new URLSearchParams({ path: urlPath });
      const res = await fetch(`/api/standard-ebooks/download?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    } catch (cause) {
      throw new StandardEbooksError({ operation: "downloadEpub", cause });
    }
  },
};
