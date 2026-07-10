import { Context, Effect, Layer, Schema } from "effect";
import { openPublication, openZipResourceProvider } from "@readmaxxing/epub-successor";
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
      Effect.tryPromise({
        try: () => openZipResourceProvider(data),
        catch: (cause) => new EpubParseError({ operation: "parseEpub:acquire", cause }),
      }),
      (provider) =>
        Effect.tryPromise({
          try: async () => {
            const result = await openPublication(provider);
            if (!result.publication) {
              throw new Error(
                result.diagnostics.map(({ message }) => message).join("; ") ||
                  "EPUB publication could not be parsed",
              );
            }

            const { metadata, resources } = result.publication;
            let coverImage: Blob | null = null;
            const cover = resources.find(
              ({ rel, properties }) => rel.includes("cover") || properties.includes("cover-image"),
            );
            try {
              if (cover) {
                const bytes = await provider.read(cover.href);
                if (bytes.byteLength > 0) {
                  coverImage = new Blob([Uint8Array.from(bytes)], {
                    type: cover.mediaType,
                  });
                }
              }
            } catch {
              // Cover extraction is optional and must not prevent importing the book.
            }

            return {
              title: metadata.title || "Untitled",
              author:
                metadata.authors
                  .map(({ name }) => name)
                  .filter(Boolean)
                  .join(", ") || "Unknown Author",
              coverImage,
            } satisfies EpubMetadata;
          },
          catch: (cause) => new EpubParseError({ operation: "parseEpub:use", cause }),
        }),
      (provider) => Effect.sync(() => provider.close()),
    ),
});
