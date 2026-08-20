import { useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, BookOpen, Check, Loader2 } from "lucide-react";
import { SharedDiscussRail } from "~/components/share/shared-discuss-rail";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { getPositionsByUser } from "~/lib/database/book/reading-position";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";
import { getUser } from "~/lib/database/user/user";
import { signDownloadToken } from "~/lib/share-download-token";
import type { BookFormat } from "~/lib/stores/book-store";
import { importSharedBookRequested } from "~/lib/themis/books/books-slice";
import { useAppStore } from "~/lib/themis/provider";

type ShareStatus = "available" | "expired" | "exhausted" | "not_found" | "unavailable";

interface ShareBookData {
  title: string;
  author: string;
  coverUrl: string | null;
  format: BookFormat;
  currentCfi: string | null;
}

interface ShareLoaderData {
  status: ShareStatus;
  id: string;
  shareChats: boolean;
  fileUrl?: string | null;
  message?: string;
  book?: ShareBookData;
  sharer?: {
    id: string;
    displayName: string | null;
  };
}

interface LoaderArgs {
  request: Request;
  params: { id: string };
}

interface ComponentProps {
  loaderData: ShareLoaderData;
}

function isExpired(shareLink: ShareLinkRow): boolean {
  return shareLink.expiresAt != null && shareLink.expiresAt.getTime() <= Date.now();
}

function isExhausted(shareLink: ShareLinkRow): boolean {
  return shareLink.maxUses != null && shareLink.useCount >= shareLink.maxUses;
}

function normalizeFormat(format: string | null | undefined): BookFormat {
  return format === "pdf" ? "pdf" : "epub";
}

export async function loader({ request, params }: LoaderArgs): Promise<ShareLoaderData> {
  const id = params.id;
  if (!process.env.DATABASE_URL) {
    return {
      status: "unavailable",
      id,
      shareChats: false,
      message: "Sharing is not configured for this deployment.",
    };
  }

  const shareLink = await getShareLink(id);
  if (!shareLink) {
    return {
      status: "not_found",
      id,
      shareChats: false,
      message: "This share link could not be found.",
    };
  }

  const [book, sharer, positions] = await Promise.all([
    getBookByIdForUser(shareLink.bookId, shareLink.userId),
    getUser(shareLink.userId),
    getPositionsByUser(shareLink.userId),
  ]);
  if (!book || book.deletedAt || !book.fileBlobUrl) {
    return {
      status: "not_found",
      id,
      shareChats: shareLink.shareChats,
      message: "The shared book is no longer available.",
    };
  }

  const currentPosition = positions.find(
    (position) => position.bookId === shareLink.bookId && position.cfi,
  );
  const bookData: ShareBookData = {
    title: book.title ?? "Untitled",
    author: book.author ?? "Unknown Author",
    coverUrl: book.coverBlobUrl ? new URL(`/api/share/${id}/cover`, request.url).toString() : null,
    format: normalizeFormat(book.format),
    currentCfi: currentPosition?.cfi ?? null,
  };
  const sharerData = { id: shareLink.userId, displayName: sharer?.displayName ?? null };

  if (isExpired(shareLink)) {
    return {
      status: "expired",
      id,
      shareChats: shareLink.shareChats,
      book: bookData,
      sharer: sharerData,
      message: "This share link has expired.",
    };
  }

  if (isExhausted(shareLink)) {
    return {
      status: "exhausted",
      id,
      shareChats: shareLink.shareChats,
      book: bookData,
      sharer: sharerData,
      message: "This share link has reached its use limit.",
    };
  }

  const fileToken = signDownloadToken(shareLink.id, shareLink.useCount);

  return {
    status: "available",
    id,
    shareChats: shareLink.shareChats,
    fileUrl: fileToken
      ? new URL(
          `/api/share/${id}?download=${encodeURIComponent(fileToken)}`,
          request.url,
        ).toString()
      : null,
    book: bookData,
    sharer: sharerData,
  };
}

export function meta({ data }: { data?: ShareLoaderData }) {
  const title = data?.book
    ? `📖 ${data.book.title} — Shared on Readmaxxing`
    : "Shared book — Readmaxxing";
  const description = data?.book
    ? `by ${data.book.author} — Open to start reading`
    : "Open a shared book on Readmaxxing";
  const image = data?.book?.coverUrl ?? "/og-image.png";

  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { property: "og:type", content: "article" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}

function SharedBookSurface({ book }: { book: ShareBookData }) {
  return (
    <section
      className="flex min-h-[55dvh] min-w-0 bg-muted/30 md:min-h-0"
      aria-label="Book surface"
      data-testid="share-book-surface"
    >
      <Empty className="rounded-none border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen />
          </EmptyMedia>
          <EmptyTitle>Read {book.title}</EmptyTitle>
          <EmptyDescription>
            The shared {book.format.toUpperCase()} reader renders here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
  );
}

export default function SharePage({ loaderData }: ComponentProps) {
  const navigate = useNavigate();
  const store = useAppStore();
  const [state, setState] = useState<"idle" | "importing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const canImport = loaderData.status === "available" && !!loaderData.book;
  const sharerName = loaderData.sharer?.displayName ?? "A Readmaxxing reader";

  function handleImport() {
    if (!loaderData.book) return;
    setError(null);
    setState("importing");
    store.dispatch(
      importSharedBookRequested(
        {
          shareId: loaderData.id,
          title: loaderData.book.title,
          author: loaderData.book.author,
          format: loaderData.book.format,
        },
        (book) => {
          setState("done");
          navigate(`/books/${encodeURIComponent(book.id)}`, { replace: true });
        },
        (message) => {
          setState("idle");
          setError(message);
        },
      ),
    );
  }

  if (loaderData.status !== "available" || !loaderData.book) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <Alert variant="destructive" className="max-w-lg">
          <AlertCircle />
          <AlertTitle>Shared book unavailable</AlertTitle>
          <AlertDescription>
            {loaderData.message ?? "This share link is not available."}
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header
        className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b bg-background px-3 py-2 sm:px-4"
        data-testid="share-banner"
        data-status={error ? "error" : state}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Shared by {sharerName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {loaderData.book.title} · {loaderData.book.author}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error && (
            <p
              className="max-w-24 truncate text-xs text-destructive sm:max-w-64"
              role="status"
              title={error}
            >
              {error}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!canImport || state === "importing" || state === "done"}
            onClick={handleImport}
          >
            {state === "importing" && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {state === "done" && <Check data-icon="inline-start" />}
            {state === "idle" && error && <AlertCircle data-icon="inline-start" />}
            {state === "idle" ? "Add to Library" : state === "importing" ? "Adding…" : "Added"}
          </Button>
        </div>
      </header>
      <div
        className="grid min-h-0 flex-1 grid-rows-[auto_auto] overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] md:grid-rows-1 md:overflow-hidden"
        data-testid="share-reading-shell"
      >
        <SharedBookSurface book={loaderData.book} />
        <SharedDiscussRail shareId={loaderData.id} included={loaderData.shareChats} />
      </div>
    </main>
  );
}
