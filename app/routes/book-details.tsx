import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { Effect } from "effect";
import { ArrowLeft, BookOpen, BookOpenText, CloudUpload, Download, RotateCcw } from "lucide-react";
import type { Route } from "./+types/book-details";
import type { JSONContent } from "@tiptap/react";
import { BookService, type BookMeta, bookNeedsDownload } from "~/lib/stores/book-store";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { useSyncState } from "~/lib/sync/use-sync";
import { AppRuntime } from "~/lib/effect-runtime";
import { useBlobObjectUrl } from "~/hooks/use-blob-object-url";
import { coverCacheKey, isPublicBlobUrl } from "~/lib/blob-url";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { TiptapEditor } from "~/components/tiptap-editor";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.book?.title ?? "Readmaxxing";
  return [{ title: `${title} — Readmaxxing` }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const book = await AppRuntime.runPromise(
    BookService.pipe(
      Effect.andThen((s) => s.getBookIncludingDeleted(params.id)),
      Effect.catchTag("BookNotFoundError", () =>
        Effect.die(new Response("Book not found", { status: 404 })),
      ),
    ),
  );
  return { book };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">Loading book details…</p>
    </div>
  );
}

function CoverImage({
  coverImage,
  alt,
  remoteCoverUrl,
  bookId,
  updatedAt,
  needsDownload,
}: {
  coverImage: Blob | null;
  alt: string;
  remoteCoverUrl?: string;
  bookId?: string;
  updatedAt?: number;
  needsDownload?: boolean;
}) {
  const directUrl = remoteCoverUrl && isPublicBlobUrl(remoteCoverUrl) ? remoteCoverUrl : null;
  const cacheKey = coverCacheKey({ remoteCoverUrl, updatedAt });
  const versionParam = cacheKey ? `&v=${encodeURIComponent(cacheKey)}` : "";
  const proxyUrl =
    !directUrl && remoteCoverUrl && bookId
      ? `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=cover${versionParam}`
      : null;
  const remoteUrl = directUrl ?? proxyUrl;
  const fallbackBlobUrl = useBlobObjectUrl(remoteUrl ? null : coverImage, bookId ?? null);
  const url = remoteUrl ?? fallbackBlobUrl;

  if (!url) return null;

  return (
    <img
      src={url}
      alt={alt}
      className={cn("aspect-[2/3] w-full max-w-xs rounded-lg object-cover shadow-md", {
        "grayscale opacity-50": needsDownload,
      })}
    />
  );
}

function CoverPlaceholder() {
  return (
    <div className="flex aspect-[2/3] w-full max-w-xs flex-col items-center justify-center rounded-lg bg-muted">
      <BookOpen className="size-12 text-muted-foreground/50" />
      <p className="mt-2 text-sm text-muted-foreground">No cover image</p>
    </div>
  );
}

export default function BookDetailsRoute({ loaderData }: Route.ComponentProps) {
  const { book } = loaderData;
  const navigate = useNavigate();

  const { triggerSync, isActive } = useSyncState();

  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletedAt, setDeletedAt] = useState(book.deletedAt);
  const [restoring, setRestoring] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);

  const isDeleted = deletedAt !== undefined;

  // Load notebook for this book
  const { data: notebook, isLoading: notebookLoading } = useEffectQuery(
    () => AnnotationService.pipe(Effect.andThen((svc) => svc.getNotebook(book.id))),
    [book.id],
  );
  const notebookContent = notebook?.content ?? null;
  const hasNotebook = !notebookLoading && notebookContent !== null;

  // Debounced notebook save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleNotebookUpdate = useCallback(
    (newContent: JSONContent) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const program = Effect.gen(function* () {
          const svc = yield* AnnotationService;
          yield* svc.saveNotebook({
            bookId: book.id,
            content: newContent,
            updatedAt: Date.now(),
          });
        });
        AppRuntime.runPromise(program).catch((err) =>
          console.error("Failed to save notebook:", err),
        );
      }, 1000);
    },
    [book.id],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pushFeedbackTimerRef.current) clearTimeout(pushFeedbackTimerRef.current);
      if (pushedResetTimerRef.current) clearTimeout(pushedResetTimerRef.current);
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updatedBook: BookMeta = { ...book, title, author, deletedAt };
      await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.updateBookMeta(updatedBook))),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save book:", err);
    } finally {
      setSaving(false);
    }
  }, [book, title, author, deletedAt]);

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    try {
      const updatedBook: BookMeta = { ...book, title, author, deletedAt: undefined };
      await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.updateBookMeta(updatedBook))),
      );
      setDeletedAt(undefined);
    } catch (err) {
      console.error("Failed to restore book:", err);
    } finally {
      setRestoring(false);
    }
  }, [book, title, author]);

  const handlePush = useCallback(() => {
    if (pushFeedbackTimerRef.current) clearTimeout(pushFeedbackTimerRef.current);
    if (pushedResetTimerRef.current) clearTimeout(pushedResetTimerRef.current);
    setPushing(true);
    setPushed(false);
    triggerSync();
    pushFeedbackTimerRef.current = setTimeout(() => {
      setPushing(false);
      setPushed(true);
      pushFeedbackTimerRef.current = null;
      pushedResetTimerRef.current = setTimeout(() => {
        setPushed(false);
        pushedResetTimerRef.current = null;
      }, 2000);
    }, 600);
  }, [triggerSync]);

  return (
    <div className="h-dvh overflow-y-auto p-4 md:p-6">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
      </div>

      <div
        className={`mx-auto flex flex-col gap-8 sm:flex-row ${hasNotebook ? "max-w-5xl" : "max-w-2xl"}`}
      >
        <div className="shrink-0">
          {book.coverImage || book.remoteCoverUrl ? (
            <CoverImage
              coverImage={book.coverImage}
              alt={title}
              remoteCoverUrl={book.remoteCoverUrl}
              bookId={book.id}
              updatedAt={book.updatedAt}
              needsDownload={bookNeedsDownload(book)}
            />
          ) : (
            <CoverPlaceholder />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4">
          {isDeleted && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>This book is soft-deleted.</span>
              <Button variant="outline" size="sm" onClick={handleRestore} disabled={restoring}>
                <RotateCcw className="size-4" />
                {restoring ? "Restoring…" : "Restore"}
              </Button>
            </div>
          )}

          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium">
              Title
            </label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <label htmlFor="author" className="mb-1 block text-sm font-medium">
              Author
            </label>
            <Input id="author" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>

          <div className="mt-2 flex gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </Button>
            {isActive && (
              <Button variant="outline" onClick={handlePush} disabled={pushing}>
                <CloudUpload className="size-4" />
                {pushing ? "Pushing…" : pushed ? "Pushed" : "Push"}
              </Button>
            )}
            {bookNeedsDownload(book) ? (
              <Button variant="outline" render={<Link to={`/books/${book.id}`} />}>
                <Download className="size-4" />
                Download &amp; Read
              </Button>
            ) : (
              <Button variant="outline" render={<Link to={`/books/${book.id}`} />}>
                <BookOpenText className="size-4" />
                Read
              </Button>
            )}
          </div>
        </div>

        {hasNotebook && (
          <div className="flex min-w-0 flex-1 flex-col border-t pt-8 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8">
            <h2 className="mb-2 text-sm font-semibold">Notes</h2>
            <ScrollArea className="flex-1">
              <TiptapEditor content={notebookContent} onUpdate={handleNotebookUpdate} />
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
