import type { Config } from "./config.js";

export interface Book {
  id: string;
  title: string | null;
  author: string | null;
  format: string | null;
  fileBlobUrl?: string | null;
  deletedAt?: string | null;
}
export interface ChatSession {
  id: string;
  bookId: string | null;
  title: string | null;
  deletedAt?: string | null;
}

export class Client {
  config: Config;
  constructor(config: Config) {
    this.config = config;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(path, this.config.url);
    if (target.origin !== this.config.url)
      throw new Error("Refusing to send credentials to a different server.");
    const headers = new Headers(init.headers);
    headers.set("Cookie", `readmax_session=${this.config.token}`);
    const response = await fetch(target, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 401)
      throw new Error("Session expired or invalid. Run readmaxxing login again.");
    if (!response.ok) {
      const body = await response.text();
      let message = response.statusText;
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.error === "string") message = parsed.error;
      } catch {
        /* Avoid printing HTML error pages. */
      }
      throw new Error(`Request failed (${response.status}): ${message}`);
    }
    return response;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await this.request(path, init)).json() as Promise<T>;
  }

  async pull<T extends { deletedAt?: string | null }>(entity: string): Promise<T[]> {
    const records: T[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const query = new URLSearchParams({ entityType: entity, limit: "1000" });
      if (cursor) query.set("cursors", JSON.stringify([{ entityType: entity, cursor }]));
      const result = await this.json<{
        changes: { entity: string; records: T[]; cursor: string; hasMore: boolean }[];
      }>(`/api/sync/pull?${query}`);
      const batch = result.changes.find((change) => change.entity === entity);
      if (!batch) break;
      records.push(...batch.records.filter((record) => !record.deletedAt));
      if (!batch.hasMore) break;
      if (!batch.cursor || seen.has(batch.cursor))
        throw new Error("Server returned a non-advancing pagination cursor.");
      cursor = batch.cursor;
      seen.add(cursor);
    }
    return records;
  }

  async book(id: string): Promise<Book> {
    const book = (await this.pull<Book>("book")).find((book) => book.id === id);
    if (!book)
      throw new Error(`Book not found: ${id}. Run readmaxxing books to see synced book IDs.`);
    return book;
  }
}
