import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Effect } from "effect";
import { AlertCircle, BookOpen, Check, Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";
import { getUser } from "~/lib/database/user/user";
import { parseEpubEffect } from "~/lib/epub/epub-service";
import { parsePdfEffect } from "~/lib/pdf/pdf-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { computeFileHash } from "~/lib/book-hash";
import { BookService, type BookFormat, type BookMeta } from "~/lib/stores/book-store";
import { cn } from "~/lib/utils";

type ShareStatus = "available" | "expired" | "exhausted" | "not_found" | "unavailable";

interface ShareBookData {
  title: string;
  author: string;
  coverUrl: string | null;
  format: BookFormat;
}

interface ShareLoaderData {
  status: ShareStatus;
  id: string;
  shareChats: boolean;
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

  const [book, sharer] = await Promise.all([
    getBookByIdForUser(shareLink.bookId, shareLink.userId),
    getUser(shareLink.userId),
  ]);
  if (!book || book.deletedAt || !book.fileBlobUrl) {
    return {
      status: "not_found",
      id,
      shareChats: shareLink.shareChats,
      message: "The shared book is no longer available.",
    };
  }

  const bookData: ShareBookData = {
    title: book.title ?? "Untitled",
    author: book.author ?? "Unknown Author",
    coverUrl: book.coverBlobUrl ? new URL(`/api/share/${id}/cover`, request.url).toString() : null,
    format: normalizeFormat(book.format),
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

  return {
    status: "available",
    id,
    shareChats: shareLink.shareChats,
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
    <div className="flex aspect-[2/3] w-48 items-center justify-center overflow-hidden rounded-xl border bg-muted shadow-xl sm:w-56">
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

function SharedReadingSection({ shareId }: { shareId: string }) {
  const [tab, setTab] = useState<"chats" | "notes">("chats");
  const [chats, setChats] = useState<SharedChatSession[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSharedContent() {
      try {
        const [chatsData, notebookData] = await Promise.all([
          fetchSharedJson<{ sessions: SharedChatSession[] }>(`/api/share/${shareId}/chats`),
          fetchSharedJson<{ markdown: string }>(`/api/share/${shareId}/notebook`),
        ]);
        if (cancelled) return;
        setChats(chatsData.sessions);
        setMarkdown(notebookData.markdown);
        setError(null);
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Failed to load shared content");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSharedContent();
    const interval = window.setInterval(loadSharedContent, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [shareId]);

  return (
    <section className="rounded-3xl border bg-card/70 p-6 shadow-sm backdrop-blur sm:p-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Co-reading
            </p>
            <h2 className="text-2xl font-semibold tracking-tight">Shared chats and notes</h2>
          </div>
          <div className="inline-flex rounded-lg border bg-background p-1">
            {(["chats", "notes"] as const).map((item) => (
              <Button
                key={item}
                type="button"
                variant={tab === item ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTab(item)}
              >
                {item === "chats" ? "Chats" : "Notes"}
              </Button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : tab === "chats" ? (
          chats.length > 0 ? (
            <div className="flex flex-col gap-3">
              {chats.map((session) => (
                <details key={session.id} className="group rounded-xl border bg-background/60 p-4">
                  <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
                    {session.title || "Untitled chat"}
                    <span className="ml-2 text-sm text-muted-foreground">
                      {session.messages.length} messages
                    </span>
                  </summary>
                  <div className="mt-4 flex flex-col gap-3">
                    {session.messages.map((message, index) => (
                      <div
                        key={`${session.id}-${message.createdAt}-${index}`}
                        className={cn("flex", { "justify-end": message.role === "user" })}
                      >
                        <div
                          className={cn("max-w-prose rounded-lg px-3 py-2 text-sm", {
                            "bg-secondary text-secondary-foreground": message.role === "user",
                            "bg-muted text-foreground": message.role !== "user",
                          })}
                        >
                          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                            {message.role}
                          </p>
                          {message.role === "user" ? (
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          ) : (
                            <Streamdown>{message.content}</Streamdown>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border bg-background/60 p-6 text-center text-sm text-muted-foreground">
              No chats yet.
            </p>
          )
        ) : markdown.trim() ? (
          <div className="prose prose-sm max-w-none rounded-xl border bg-background/60 p-5 text-foreground dark:prose-invert">
            <Streamdown>{markdown}</Streamdown>
          </div>
        ) : (
          <p className="rounded-xl border bg-background/60 p-6 text-center text-sm text-muted-foreground">
            No notes yet.
          </p>
        )}
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
      <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-5xl items-center justify-center">
        <div className="flex w-full flex-col gap-6">
          <section className="grid w-full gap-10 rounded-3xl border bg-card/70 p-6 shadow-sm backdrop-blur sm:p-10 md:grid-cols-[auto_1fr] md:items-center">
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
                <div className="inline-flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{loaderData.message ?? "This share link is not available."}</span>
                </div>
              )}

              {error && (
                <div className="inline-flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive">
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
          {loaderData.shareChats && canImport && <SharedReadingSection shareId={loaderData.id} />}
        </div>
      </div>
    </main>
  );
}
