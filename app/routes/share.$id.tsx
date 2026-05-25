import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import { Effect } from "effect";
import { AlertCircle, BookOpen, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { getPositionsByUser } from "~/lib/database/book/reading-position";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";
import { getUser } from "~/lib/database/user/user";
import { parseEpubEffect } from "~/lib/epub/epub-service";
import { parsePdfEffect } from "~/lib/pdf/pdf-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { computeFileHash } from "~/lib/book-hash";
import { signDownloadToken } from "~/lib/share-download-token";
import { BookService, type BookFormat, type BookMeta } from "~/lib/stores/book-store";
import { cn } from "~/lib/utils";

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

interface ShareResolveResponse {
  book: {
    title: string | null;
    author: string | null;
    format: string | null;
  };
  fileUrl: string;
  sharerId: string;
}

type SharedChatMessage = { role: string; content: string; createdAt: string };

type SharedChatSession = { id: string; title: string | null; messages: SharedChatMessage[] };

interface LoaderArgs {
  request: Request;
  params: { id: string };
}

interface ComponentProps {
  loaderData: ShareLoaderData;
}

class ShareImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareImportError";
  }
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

function getBookFileName(book: ShareBookData): string {
  const extension = book.format === "pdf" ? "pdf" : "epub";
  return `${book.title}.${extension}`;
}

async function readApiError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string"
    ? body.error
    : `Request failed with ${response.status} ${response.statusText}`;
}

function fetchShareFile(shareId: string) {
  return Effect.tryPromise({
    try: async () => {
      const infoResponse = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
      if (!infoResponse.ok) {
        throw new ShareImportError(await readApiError(infoResponse));
      }

      const shareInfo = (await infoResponse.json()) as ShareResolveResponse;
      const fileResponse = await fetch(shareInfo.fileUrl);
      if (!fileResponse.ok) {
        throw new ShareImportError(await readApiError(fileResponse));
      }

      return {
        shareInfo,
        arrayBuffer: await fileResponse.arrayBuffer(),
      };
    },
    catch: (cause) =>
      cause instanceof ShareImportError
        ? cause
        : new ShareImportError(cause instanceof Error ? cause.message : "Failed to download book"),
  });
}

function importSharedBook(loaderData: ShareLoaderData) {
  return Effect.gen(function* () {
    if (loaderData.status !== "available" || !loaderData.book) {
      return yield* Effect.fail(new ShareImportError("This share link is not available."));
    }

    const { shareInfo, arrayBuffer } = yield* fetchShareFile(loaderData.id);
    const format = normalizeFormat(shareInfo.book.format ?? loaderData.book.format);
    const fileHash = yield* Effect.tryPromise({
      try: () => computeFileHash(arrayBuffer),
      catch: (cause) =>
        new ShareImportError(cause instanceof Error ? cause.message : "Failed to hash book file"),
    });

    const service = yield* BookService;
    const existing = yield* service.findByFileHash(fileHash);
    if (existing) {
      const updated = { ...existing, sharedBy: shareInfo.sharerId, shareId: loaderData.id };
      yield* service.updateBookMeta(updated);
      return updated;
    }

    const metadata =
      format === "pdf"
        ? yield* parsePdfEffect(arrayBuffer, getBookFileName(loaderData.book))
        : yield* parseEpubEffect(arrayBuffer);

    const book: BookMeta = {
      id: crypto.randomUUID(),
      title: metadata.title || shareInfo.book.title || loaderData.book.title,
      author: metadata.author || shareInfo.book.author || loaderData.book.author,
      coverImage: metadata.coverImage,
      format,
      fileHash,
      sharedBy: shareInfo.sharerId,
      shareId: loaderData.id,
    };
    yield* service.saveBook(book, arrayBuffer);
    return book;
  });
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

function CoverArt({ book }: { book?: ShareBookData }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex aspect-[2/3] w-48 items-center justify-center overflow-hidden bg-muted sm:w-56">
      {book?.coverUrl && !failed ? (
        <img
          src={book.coverUrl}
          alt={`Cover for ${book.title}`}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <BookOpen className="size-16 text-muted-foreground/50" />
      )}
    </div>
  );
}

async function fetchSharedJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

function SharedEpubPreview({ book, fileUrl }: { book: ShareBookData; fileUrl?: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [loading, setLoading] = useState(book.format === "epub");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (book.format !== "epub") return;
    const container = containerRef.current;
    if (!container) return;
    if (!fileUrl) {
      setLoading(false);
      setError("Reader preview is unavailable because the download link could not be signed.");
      return;
    }

    const previewContainer = container;
    const previewFileUrl = fileUrl;
    const abortController = new AbortController();
    let cancelled = false;
    let epubBook: EpubBook | null = null;
    let rendition: Rendition | null = null;

    async function initPreview() {
      try {
        setLoading(true);
        setError(null);
        previewContainer.replaceChildren();

        const [response, epubModule] = await Promise.all([
          fetch(previewFileUrl, { signal: abortController.signal }),
          import("epubjs"),
        ]);
        if (!response.ok) throw new Error(await readApiError(response));
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;

        epubBook = epubModule.default(arrayBuffer);
        bookRef.current = epubBook;
        rendition = epubBook.renderTo(previewContainer, {
          width: "100%",
          height: "100%",
          spread: "none",
        });
        renditionRef.current = rendition;

        rendition.hooks.content.register((contents: { document?: Document }) => {
          const doc = contents.document;
          if (!doc) return;
          const style = doc.createElement("style");
          style.textContent = `
            body {
              color: #171717 !important;
              background: #ffffff !important;
              font-family: Georgia, "Times New Roman", serif !important;
              font-size: 18px !important;
              line-height: 1.7 !important;
            }
            p, li { line-height: 1.7 !important; }
            a { color: #2563eb !important; }
          `;
          doc.head.appendChild(style);
        });

        rendition.themes.register("share-preview", {
          body: {
            color: "#171717",
            background: "#ffffff",
          },
        });
        rendition.themes.select("share-preview");

        try {
          await rendition.display(book.currentCfi ?? undefined);
        } catch {
          await rendition.display();
        }
        if (!cancelled) setLoading(false);
      } catch (cause) {
        if (cancelled || abortController.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Failed to load reader preview");
        setLoading(false);
      }
    }

    void initPreview();
    return () => {
      cancelled = true;
      abortController.abort();
      rendition?.destroy();
      epubBook?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
      previewContainer.replaceChildren();
    };
  }, [book.currentCfi, book.format, fileUrl]);

  if (book.format === "pdf") {
    return (
      <div className="flex h-[600px] flex-col overflow-hidden bg-background lg:h-full">
        <div className="flex flex-1 items-center justify-center bg-muted/40 p-8">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={`Cover for ${book.title}`}
              className="max-h-[520px] object-contain"
            />
          ) : (
            <div className="flex aspect-[2/3] w-56 items-center justify-center bg-muted">
              <BookOpen className="size-16 text-muted-foreground/50" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[600px] flex-col overflow-hidden bg-background lg:h-full">
      <div className="relative min-h-0 flex-1 bg-white">
        <div ref={containerRef} className="size-full" />
        {loading && (
          <div className="absolute inset-0 flex flex-col gap-4 bg-background p-8">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
            <Skeleton className="mt-8 h-64 w-full" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-8 text-center">
            <p className="max-w-sm text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => renditionRef.current?.prev()}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => renditionRef.current?.next()}
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function SharedChatPanel({ shareId, enabled }: { shareId: string; enabled: boolean }) {
  const [chats, setChats] = useState<SharedChatSession[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function loadSharedChats() {
      try {
        const chatsData = await fetchSharedJson<{ sessions: SharedChatSession[] }>(
          `/api/share/${shareId}/chats`,
        );
        if (cancelled) return;
        setChats(chatsData.sessions);
        setError(null);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Failed to load shared content");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSharedChats();
    const interval = window.setInterval(loadSharedChats, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, shareId]);

  if (!enabled) {
    return (
      <aside className="flex h-[600px] flex-col overflow-hidden bg-background lg:h-full">
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Chat sessions were not included with this share link.
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-[600px] flex-col overflow-hidden bg-background lg:h-full">
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-16 w-5/6 self-end" />
          </div>
        ) : chats.length > 0 ? (
          <div className="flex flex-col gap-6">
            {chats.map((session) => (
              <section key={session.id} className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-medium">{session.title || "Untitled chat"}</h3>
                  <p className="text-xs text-muted-foreground">
                    {session.messages.length} messages
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {session.messages.map((message, index) => (
                    <SharedChatBubble
                      key={`${session.id}-${message.createdAt}-${index}`}
                      message={message}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="bg-muted/50 p-6 text-center text-sm text-muted-foreground">No chats yet.</p>
        )}
      </div>
    </aside>
  );
}

function SharedChatBubble({ message }: { message: SharedChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", { "justify-end": isUser, "justify-start": !isUser })}>
      <div
        className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", {
          "bg-secondary text-secondary-foreground": isUser,
          "text-foreground": !isUser,
        })}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Streamdown>{message.content}</Streamdown>
        )}
      </div>
    </div>
  );
}

function SharedReadingSection({
  shareId,
  book,
  fileUrl,
  shareChats,
}: {
  shareId: string;
  book: ShareBookData;
  fileUrl?: string | null;
  shareChats: boolean;
}) {
  return (
    <section className="min-h-0 flex-1 border-t pt-6">
      <div className="grid min-h-0 gap-5 lg:h-full lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <SharedEpubPreview book={book} fileUrl={fileUrl} />
        <SharedChatPanel shareId={shareId} enabled={shareChats} />
      </div>
    </section>
  );
}

export default function SharePage({ loaderData }: ComponentProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "importing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const canImport = loaderData.status === "available" && !!loaderData.book;
  const sharerName = loaderData.sharer?.displayName ?? "A Readmaxxing reader";

  async function handleImport() {
    setError(null);
    setState("importing");
    const result = await AppRuntime.runPromise(
      importSharedBook(loaderData).pipe(
        Effect.match({
          onFailure: (cause) => ({ ok: false as const, error: cause }),
          onSuccess: (book) => ({ ok: true as const, book }),
        }),
      ),
    );

    if (!result.ok) {
      setState("idle");
      setError(result.error.message);
      return;
    }

    setState("done");
    navigate("/", { replace: true, state: { importedBookId: result.book.id } });
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-7xl items-start justify-center lg:h-[calc(100dvh-5rem)]">
        <div className="flex w-full flex-col gap-6 lg:h-full lg:min-h-0">
          <section className="grid w-full shrink-0 gap-10 p-0 md:grid-cols-[auto_1fr] md:items-center">
            <div className="flex justify-center md:justify-start">
              <CoverArt book={loaderData.book} />
            </div>

            <div className="space-y-6 text-center md:text-left">
              <div className="space-y-3">
                <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Shared on Readmaxxing
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                  {loaderData.book?.title ?? "Shared book unavailable"}
                </h1>
                {loaderData.book && (
                  <p className="text-lg text-muted-foreground">by {loaderData.book.author}</p>
                )}
                {loaderData.sharer && (
                  <p className="text-sm text-muted-foreground">Shared by {sharerName}</p>
                )}
              </div>

              {loaderData.status !== "available" && (
                <div className="inline-flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{loaderData.message ?? "This share link is not available."}</span>
                </div>
              )}

              {error && (
                <div className="inline-flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-col items-center gap-3 sm:flex-row md:justify-start">
                <Button
                  type="button"
                  size="lg"
                  disabled={!canImport || state === "importing" || state === "done"}
                  onClick={handleImport}
                  className={cn("min-w-48", { "opacity-80": state !== "idle" })}
                >
                  {state === "importing" && <Loader2 className="animate-spin" />}
                  {state === "done" && <Check />}
                  {state === "idle" ? "Add to Library & Read" : "Adding to library…"}
                </Button>
                <p className="max-w-sm text-sm text-muted-foreground">
                  The book will be saved locally in this browser and opened in your workspace.
                </p>
              </div>
            </div>
          </section>
          {canImport && loaderData.book && (
            <SharedReadingSection
              shareId={loaderData.id}
              book={loaderData.book}
              fileUrl={loaderData.fileUrl}
              shareChats={loaderData.shareChats}
            />
          )}
        </div>
      </div>
    </main>
  );
}
