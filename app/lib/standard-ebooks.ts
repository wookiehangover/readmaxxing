import { Context, Effect, Layer, Schema } from "effect";
import { StandardEbooksError, DecodeError } from "~/lib/errors";

// --- Schemas ---

export const SEBookSchema = Schema.mutable(
  Schema.Struct({
    title: Schema.String,
    author: Schema.String,
    urlPath: Schema.String,
    coverUrl: Schema.NullOr(Schema.String),
    summary: Schema.optional(Schema.String),
    subjects: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  }),
);

export type SEBook = typeof SEBookSchema.Type;

export const SESearchResultSchema = Schema.mutable(
  Schema.Struct({
    books: Schema.mutable(Schema.Array(SEBookSchema)),
    currentPage: Schema.Number,
    totalPages: Schema.Number,
  }),
);

export type SESearchResult = typeof SESearchResultSchema.Type;

const decodeSESearchResult = Schema.decodeUnknownSync(SESearchResultSchema);
const decodeSEBooks = Schema.decodeUnknownSync(Schema.mutable(Schema.Array(SEBookSchema)));

// --- Service ---

export class StandardEbooksService extends Context.Tag("StandardEbooksService")<
  StandardEbooksService,
  {
    readonly searchBooks: (
      query: string,
      page?: number,
    ) => Effect.Effect<SESearchResult, StandardEbooksError | DecodeError>;
    readonly getNewReleases: () => Effect.Effect<SEBook[], StandardEbooksError | DecodeError>;
    readonly downloadEpub: (urlPath: string) => Effect.Effect<ArrayBuffer, StandardEbooksError>;
  }
>() {}

export const StandardEbooksServiceLive = Layer.succeed(StandardEbooksService, {
  searchBooks: (query: string, page = 1) =>
    Effect.gen(function* () {
      const json = yield* Effect.tryPromise({
        try: async () => {
          const params = new URLSearchParams({
            query,
            page: String(page),
          });
          const res = await fetch(`/api/standard-ebooks/search?${params.toString()}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        catch: (cause) => new StandardEbooksError({ operation: "searchBooks", cause }),
      });
      return yield* Effect.try({
        try: () => decodeSESearchResult(json),
        catch: (cause) => new DecodeError({ operation: "searchBooks", cause }),
      });
    }),

  getNewReleases: () =>
    Effect.gen(function* () {
      const json = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetch("/api/standard-ebooks/new-releases");
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        catch: (cause) => new StandardEbooksError({ operation: "getNewReleases", cause }),
      });
      return yield* Effect.try({
        try: () => decodeSEBooks(json),
        catch: (cause) => new DecodeError({ operation: "getNewReleases", cause }),
      });
    }),

  downloadEpub: (urlPath: string) =>
    Effect.tryPromise({
      try: async () => {
        const params = new URLSearchParams({ path: urlPath });
        const res = await fetch(`/api/standard-ebooks/download?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      },
      catch: (cause) => new StandardEbooksError({ operation: "downloadEpub", cause }),
    }),
});
