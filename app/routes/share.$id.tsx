import { useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { SharedBookReader } from "~/components/share/shared-book-reader";
import { SharedReadingRail } from "~/components/share/shared-reading-rail";
import { ReadingRailTabProvider } from "~/components/reading-shell/reading-rail-tab-context";
import { ReadingSplit } from "~/components/reading-shell/reading-split";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { useIsMobile } from "~/hooks/use-mobile";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { getPositionForBook } from "~/lib/database/book/reading-position";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";
import { getUser } from "~/lib/database/user/user";
import { signDownloadToken } from "~/lib/share-download-token";
import type { BookFormat } from "~/lib/stores/book-store";
import { importSharedBookRequested } from "~/lib/themis/books/books-slice";
import { useAppStore } from "~/lib/themis/provider";
import type { Route } from "./+types/share.$id";

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
  shareUrl: string;
  shareChats: boolean;
  fileUrl?: string | null;
  message?: string;
  book?: ShareBookData;
  sharer?: {
    id: string;
    displayName: string | null;
  };
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

export async function loader({ request, params }: Route.LoaderArgs): Promise<ShareLoaderData> {
  const id = params.id;
  const shareUrl = new URL(request.url);
  shareUrl.search = "";
  shareUrl.hash = "";
  const absoluteShareUrl = shareUrl.toString();

  if (!process.env.DATABASE_URL) {
    return {
      status: "unavailable",
      id,
      shareUrl: absoluteShareUrl,
      shareChats: false,
      message: "Sharing is not configured for this deployment.",
    };
  }

  const shareLink = await getShareLink(id);
  if (!shareLink) {
    return {
      status: "not_found",
      id,
      shareUrl: absoluteShareUrl,
      shareChats: false,
      message: "This share link could not be found.",
    };
  }

  const [book, sharer, currentPosition] = await Promise.all([
    getBookByIdForUser(shareLink.bookId, shareLink.userId),
    getUser(shareLink.userId),
    getPositionForBook(shareLink.userId, shareLink.bookId),
  ]);
  if (!book || book.deletedAt || !book.fileBlobUrl) {
    return {
      status: "not_found",
      id,
      shareUrl: absoluteShareUrl,
      shareChats: shareLink.shareChats,
      message: "The shared book is no longer available.",
    };
  }

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
      shareUrl: absoluteShareUrl,
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
      shareUrl: absoluteShareUrl,
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
    shareUrl: absoluteShareUrl,
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

export function meta({ loaderData }: Route.MetaArgs) {
  const book = loaderData?.status === "available" ? loaderData.book : undefined;
  const shareUrl = loaderData?.shareUrl ?? "https://readmaxxing.invalid/share/unavailable";
  const title = book ? `${book.title} — Shared on Readmaxxing` : "Shared book — Readmaxxing";
  const description = book
    ? `By ${book.author}. Open this shared book on Readmaxxing.`
    : "This shared book is unavailable. Read and discuss books on Readmaxxing.";
  const image = book?.coverUrl ?? new URL("/og-image.png", shareUrl).toString();

  return [
    { title },
    { tagName: "link", rel: "canonical", href: shareUrl },
    { name: "description", content: description },
    { property: "og:url", content: shareUrl },
    { property: "og:site_name", content: "Readmaxxing" },
    { property: "og:type", content: "article" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}

function SharedBookSurface({
  shareId,
  book,
  fileUrl,
}: {
  shareId: string;
  book: ShareBookData;
  fileUrl: string | null | undefined;
}) {
  return (
    <section className="h-full min-w-0" aria-label="Book surface" data-testid="share-book-surface">
      {fileUrl ? (
        <SharedBookReader
          shareId={shareId}
          fileUrl={fileUrl}
          format={book.format}
          currentCfi={book.currentCfi}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <Alert variant="destructive" className="max-w-lg">
            <AlertCircle />
            <AlertTitle>Shared book file unavailable</AlertTitle>
            <AlertDescription>
              The reader could not open this shared file. Ask the sharer to create a new link.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </section>
  );
}

export default function SharePage({ loaderData }: ComponentProps) {
  const navigate = useNavigate();
  const store = useAppStore();
  const isMobile = useIsMobile();
  const [state, setState] = useState<"idle" | "importing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const canImport = loaderData.status === "available" && !!loaderData.book;

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

  const bookSurface = (
    <SharedBookSurface
      shareId={loaderData.id}
      book={loaderData.book}
      fileUrl={loaderData.fileUrl}
    />
  );

  return (
    <main className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header
        className="flex h-10 shrink-0 items-center justify-between gap-3 border-b bg-background px-3 sm:px-4"
        data-testid="share-banner"
        data-status={error ? "error" : state}
      >
        <p className="flex min-w-0 items-center gap-2 overflow-hidden text-sm">
          <span className="shrink-0 font-medium">Readmaxxing</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="truncate text-muted-foreground">{loaderData.book.title}</span>
        </p>
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
            variant="ghost"
            size="xs"
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
      <div className="min-h-0 flex-1">
        <ReadingRailTabProvider>
          {isMobile === true ? (
            <SharedReadingRail
              mobile
              bookSurface={bookSurface}
              shareId={loaderData.id}
              bookTitle={loaderData.book.title}
              included={loaderData.shareChats}
            />
          ) : (
            <ReadingSplit
              book={bookSurface}
              rail={
                <SharedReadingRail
                  shareId={loaderData.id}
                  bookTitle={loaderData.book.title}
                  included={loaderData.shareChats}
                />
              }
            />
          )}
        </ReadingRailTabProvider>
      </div>
    </main>
  );
}
