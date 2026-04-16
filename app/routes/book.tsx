import { useEffect, useState } from "react";
import { Effect } from "effect";
import { Loader2 } from "lucide-react";
import type { Route } from "./+types/book";
import { BookService, bookNeedsDownload } from "~/lib/stores/book-store";
import { BookReader } from "~/components/book-reader";
import { PdfReader } from "~/components/pdf-reader";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSyncListener } from "~/hooks/use-sync-listener";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.book?.title ?? "Readmaxxing";
  return [{ title: `${title} — Readmaxxing` }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const book = await AppRuntime.runPromise(
    BookService.pipe(
      Effect.andThen((s) => s.getBook(params.id)),
      Effect.catchTag("BookNotFoundError", () =>
        Effect.die(new Response("Book not found", { status: 404 })),
      ),
    ),
  );
  return { book, needsDownload: bookNeedsDownload(book) };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">Loading book…</p>
    </div>
  );
}

function DownloadingFallback({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
      <div className="text-center">
        <p className="font-medium text-muted-foreground">Downloading book…</p>
        <p className="mt-1 text-sm text-muted-foreground/70">{title}</p>
      </div>
    </div>
  );
}

export default function BookRoute({ loaderData }: Route.ComponentProps) {
  const { book, needsDownload } = loaderData;
  const [downloading, setDownloading] = useState(needsDownload);
  const bookSyncVersion = useSyncListener(["book"]);

  // Re-check download state when book data changes via sync
  useEffect(() => {
    if (!downloading) return;
    // Re-fetch the book to check if hasLocalFile is now true
    AppRuntime.runPromise(
      BookService.pipe(
        Effect.andThen((s) => s.getBook(book.id)),
        Effect.catchAll(() => Effect.succeed(null)),
      ),
    ).then((updated) => {
      if (updated && !bookNeedsDownload(updated)) {
        setDownloading(false);
      }
    });
  }, [downloading, bookSyncVersion, book.id]);

  if (book.format === "pdf") {
    if (downloading) {
      return <DownloadingFallback title={book.title} />;
    }
    return <PdfReader book={book} />;
  }
  return (
    <div className="relative h-full">
      {downloading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium text-muted-foreground">Downloading book…</p>
            <p className="mt-1 text-sm text-muted-foreground/70">{book.title}</p>
          </div>
        </div>
      )}
      <BookReader book={book} />
    </div>
  );
}
