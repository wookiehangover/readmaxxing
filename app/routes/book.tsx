import { useEffect, useState } from "react";
import { Effect } from "effect";
import { Loader2 } from "lucide-react";
import type { Route } from "./+types/book";
import { BookService, bookNeedsDownload } from "~/lib/stores/book-store";
import { BookReader } from "~/components/book-reader";
import { PdfReader } from "~/components/pdf-reader";
import { AppRuntime } from "~/lib/effect-runtime";

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

  // Listen for sync:pull-complete which fires after getBookData finishes downloading
  useEffect(() => {
    if (!downloading) return;
    const handler = () => setDownloading(false);
    window.addEventListener("sync:pull-complete", handler);
    return () => window.removeEventListener("sync:pull-complete", handler);
  }, [downloading]);

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
