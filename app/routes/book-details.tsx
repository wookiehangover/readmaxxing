import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { ArrowLeft, BookOpen, CloudUpload, RotateCcw } from "lucide-react";
import type { Route } from "./+types/book-details";
import { BookService, type BookMeta, bookNeedsDownload } from "~/lib/stores/book-store";
import { useSyncActions } from "~/lib/sync/use-sync";
import { useBlobObjectUrl } from "~/hooks/use-blob-object-url";
import { coverCacheKey, isPublicBlobUrl } from "~/lib/blob-url";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  replaceBookFileRequested,
  updateBookMetadataRequested,
} from "~/lib/themis/books/books-slice";
import { useAppStore } from "~/lib/themis/provider";
import { cn } from "~/lib/utils";
import { hydrateAnnotationsRequested } from "~/lib/themis/annotations/annotations-slice";
import { useSyncListener } from "~/hooks/use-sync-listener";

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.book?.title ?? "Readmaxxing";
  return [{ title: `${title} — Readmaxxing` }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const book = await BookService.getBookIncludingDeleted(params.id).catch((error: unknown) => {
    if (error instanceof Error && "_tag" in error && error._tag === "BookNotFoundError") {
      throw new Response("Book not found", { status: 404 });
    }
    throw error;
  });
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
  const revalidator = useRevalidator();
  const store = useAppStore();

  const { triggerSync, isActive, reloadBookFiles } = useSyncActions();

  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletedAt, setDeletedAt] = useState(book.deletedAt);
  const [restoring, setRestoring] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState<"idle" | "success" | "failed">("idle");
  const [replacing, setReplacing] = useState(false);

  const isDeleted = deletedAt !== undefined;

  const notebook = store.annotationsSelectors.selectNotebookByBookId.useValue(book.id);
  const annotationsLoaded = store.annotationsSelectors.selectAnnotationsLoaded.useValue(book.id);
  const notebookSyncVersion = useSyncListener(["notebook"]);
  const notebookContent = notebook?.content ?? null;
  const hasNotebook = annotationsLoaded && notebookContent !== null;

  useEffect(() => {
    store.dispatch(hydrateAnnotationsRequested(book.id));
  }, [book.id, notebookSyncVersion, store]);

  // Debounced notebook save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pushFeedbackTimerRef.current) clearTimeout(pushFeedbackTimerRef.current);
      if (pushedResetTimerRef.current) clearTimeout(pushedResetTimerRef.current);
    };
  }, []);

  const handleSave = useCallback(() => {
    setSaving(true);
    setSaved(false);
    const updatedBook: BookMeta = { ...book, title, author, deletedAt };
    store.dispatch(
      updateBookMetadataRequested(
        updatedBook,
        "update",
        () => {
          setSaved(true);
          setSaving(false);
          setTimeout(() => setSaved(false), 2000);
        },
        (error) => {
          console.error("Failed to save book:", error);
          setSaving(false);
        },
      ),
    );
  }, [book, title, author, deletedAt, store]);

  const handleRestore = useCallback(() => {
    setRestoring(true);
    const updatedBook: BookMeta = {
      ...book,
      title,
      author,
      deletedAt: undefined,
    };
    store.dispatch(
      updateBookMetadataRequested(
        updatedBook,
        "restore",
        () => {
          setDeletedAt(undefined);
          setRestoring(false);
        },
        (error) => {
          console.error("Failed to restore book:", error);
          setRestoring(false);
        },
      ),
    );
  }, [book, title, author, store]);

  const handlePush = useCallback(async () => {
    if (pushFeedbackTimerRef.current) clearTimeout(pushFeedbackTimerRef.current);
    if (pushedResetTimerRef.current) clearTimeout(pushedResetTimerRef.current);
    pushFeedbackTimerRef.current = null;
    pushedResetTimerRef.current = null;
    setPushing(true);
    setPushStatus("idle");
    try {
      await triggerSync();
      setPushStatus("success");
      pushedResetTimerRef.current = setTimeout(() => {
        setPushStatus("idle");
        pushedResetTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.error("Failed to push book:", err);
      setPushStatus("failed");
      pushFeedbackTimerRef.current = setTimeout(() => {
        setPushStatus("idle");
        pushFeedbackTimerRef.current = null;
      }, 2000);
    } finally {
      setPushing(false);
    }
  }, [triggerSync]);

  const handleReplaceButtonClick = useCallback(() => {
    replaceInputRef.current?.click();
  }, []);

  const handleReplaceFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".epub")) {
        console.error("Only .epub files can replace book files.");
        input.value = "";
        return;
      }

      setReplacing(true);
      store.dispatch(
        replaceBookFileRequested(
          {
            bookId: book.id,
            file,
            remoteCoverUrl: book.remoteCoverUrl,
            syncActive: isActive,
            reloadBookFiles,
          },
          () => {
            revalidator.revalidate();
            setReplacing(false);
            input.value = "";
          },
          (error) => {
            console.error("Failed to replace book file:", error);
            setReplacing(false);
            input.value = "";
          },
        ),
      );
    },
    [book.id, book.remoteCoverUrl, isActive, reloadBookFiles, revalidator, store],
  );

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
            <input
              ref={replaceInputRef}
              type="file"
              accept=".epub"
              className="hidden"
              onChange={handleReplaceFile}
            />
            <Button variant="outline" onClick={handleReplaceButtonClick} disabled={replacing}>
              {replacing ? "Replacing…" : "Replace book file"}
            </Button>
            {isActive && (
              <Button variant="outline" onClick={handlePush} disabled={pushing}>
                <CloudUpload className="size-4" />
                {pushing
                  ? "Pushing…"
                  : pushStatus === "success"
                    ? "Pushed"
                    : pushStatus === "failed"
                      ? "Failed"
                      : "Push"}
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
