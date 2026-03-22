import { Effect } from "effect";
import type { Route } from "./+types/book";
import { BookService } from "~/lib/book-store";
import { BookReader } from "~/components/book-reader";
import { AppRuntime } from "~/lib/effect-runtime";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.book?.title ?? "eBook Reader";
  return [{ title }];
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
