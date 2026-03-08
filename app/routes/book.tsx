import type { Route } from "./+types/book";
import { getBook } from "~/lib/book-store";
import { BookReader } from "~/components/book-reader";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const book = await getBook(params.id);
  if (!book) {
    throw new Response("Book not found", { status: 404 });
  }
  return { book };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">Loading book…</p>
    </div>
  );
}

export default function BookRoute({ loaderData }: Route.ComponentProps) {
  return <BookReader book={loaderData.book} />;
}

