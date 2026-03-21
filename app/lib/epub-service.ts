import { Context, Effect, Layer } from "effect";
import ePub from "epubjs";
import { EpubParseError } from "~/lib/errors";

export interface EpubMetadata {
  title: string;
  author: string;
  coverImage: Blob | null;
}

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
    Effect.tryPromise({
      try: async () => {
        const book = ePub(data);

        await book.ready;

        const metadata = await book.loaded.metadata;
        let coverImage: Blob | null = null;

        // Inner try/catch is intentional: cover extraction is a non-fatal fallback
        // within a single tryPromise. Not all epubs include cover images, and failures
        // here should not prevent metadata extraction from succeeding.
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

        const result: EpubMetadata = {
          title: metadata.title || "Untitled",
          author: metadata.creator || "Unknown Author",
          coverImage,
        };

        book.destroy();

        return result;
      },
      catch: (cause) => new EpubParseError({ operation: "parseEpub", cause }),
    }),
});
