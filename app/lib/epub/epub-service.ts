import { Context, Effect, Layer, Schema } from "effect";
import ePub from "epubjs";
import { EpubParseError } from "~/lib/errors";

// --- Schema ---

export const EpubMetadataSchema = Schema.Struct({
  title: Schema.String,
  author: Schema.String,
  coverImage: Schema.NullOr(Schema.instanceOf(Blob)),
});

export type EpubMetadata = typeof EpubMetadataSchema.Type;

export class EpubService extends Context.Tag("EpubService")<
  EpubService,
  {
    readonly parseEpub: (data: ArrayBuffer) => Effect.Effect<EpubMetadata, EpubParseError>;
  }
>() {}

/**
 * Convenience function to access EpubService.parseEpub as an Effect.
 * Must be provided with EpubServiceLive (or via AppRuntime).
 */
export const parseEpubEffect = (data: ArrayBuffer) =>
  Effect.flatMap(EpubService, (svc) => svc.parseEpub(data));

export const EpubServiceLive = Layer.succeed(EpubService, {
  parseEpub: (data: ArrayBuffer) =>
    Effect.acquireUseRelease(
      // Acquire: create the book and wait for it to be ready
      Effect.tryPromise({
        try: async () => {
          const book = ePub(data);
          await book.ready;
          return book;
        },
        catch: (cause) => new EpubParseError({ operation: "parseEpub:acquire", cause }),
      }),
      // Use: extract metadata from the book
      (book) =>
        Effect.tryPromise({
          try: async () => {
            const metadata = await book.loaded.metadata;
            let coverImage: Blob | null = null;

            // Inner try/catch is intentional: cover extraction is a non-fatal fallback.
            // Not all epubs include cover images, and failures here should not prevent
            // metadata extraction from succeeding.
            try {
              const coverHref = await book.loaded.cover;
              if (coverHref) {
                const blob = await book.archive.getBlob(coverHref);
                if (blob && blob.size > 0) {
                  coverImage = blob;
                }
              }
            } catch {
              // cover may not exist in all epubs — fall through with null
            }

            return {
              title: metadata.title || "Untitled",
              author: metadata.creator || "Unknown Author",
              coverImage,
            } satisfies EpubMetadata;
          },
          catch: (cause) => new EpubParseError({ operation: "parseEpub:use", cause }),
        }),
      // Release: always destroy the book, even on error
      (book) => Effect.sync(() => book.destroy()),
    ),
});
