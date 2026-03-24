import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { Effect } from "effect";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { Route } from "./+types/book-details";
import type { JSONContent } from "@tiptap/react";
import { BookService, type Book } from "~/lib/book-store";
import { AnnotationService } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useEffectQuery } from "~/lib/use-effect-query";
import { TiptapEditor } from "~/components/tiptap-editor";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const book = await AppRuntime.runPromise(
    BookService.pipe(
      Effect.andThen((s) => s.getBook(params.id)),
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

function CoverImage({ coverImage, alt }: { coverImage: Blob; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(coverImage);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [coverImage]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt={alt}
      className="aspect-[2/3] w-full max-w-xs rounded-lg object-cover shadow-md"
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

  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load notebook for this book
  const { data: notebook, isLoading: notebookLoading } = useEffectQuery(
    () =>
      AnnotationService.pipe(
        Effect.andThen((svc) => svc.getNotebook(book.id)),
      ),
    [book.id],
  );
  const notebookContent = notebook?.content ?? null;
  const hasNotebook = !notebookLoading && notebookContent !== null;

  // Debounced notebook save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updatedBook: Book = { ...book, title, author };
      await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.saveBook(updatedBook))),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save book:", err);
    } finally {
      setSaving(false);
    }
  }, [book, title, author]);

  return (
    <div className="h-screen overflow-y-auto p-6">
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
          {book.coverImage ? (
            <CoverImage coverImage={book.coverImage} alt={title} />
          ) : (
            <CoverPlaceholder />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium">
              Title
            </label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="author" className="mb-1 block text-sm font-medium">
              Author
            </label>
            <Input
              id="author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>

          <div className="mt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </Button>
          </div>
        </div>

        {hasNotebook && (
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="mb-2 text-sm font-semibold">Notebook</h2>
            <ScrollArea className="flex-1">
              <TiptapEditor
                content={notebookContent}
                onUpdate={handleNotebookUpdate}
              />
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}

