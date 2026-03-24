import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Effect } from "effect";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { Route } from "./+types/book-details";
import { BookService, type Book } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

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

      <div className="mx-auto flex max-w-2xl flex-col gap-8 sm:flex-row">
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
      </div>
    </div>
  );
}

