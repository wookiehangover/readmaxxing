import { get, set } from "idb-keyval";
import { Effect } from "effect";
import { AuthService } from "~/lib/auth-service";
import { computeFileHash } from "~/lib/book-hash";
import { AppRuntime } from "~/lib/effect-runtime";
import { ChatError, StorageError } from "~/lib/errors";
import { parseEpubEffect } from "~/lib/epub/epub-service";
import {
  DEMO_BOOK_ID,
  DEMO_BOOK_METADATA,
  DEMO_CHAT_SESSION,
  DEMO_EPUB_PATH,
  DEMO_NOTEBOOK_CONTENT,
  DEMO_POSITION_CFI,
} from "~/lib/onboarding/demo-content";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import type { ChatSession } from "~/lib/stores/chat-store";
import { ReadingPositionService } from "~/lib/stores/position-store";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { getActiveSessionStore, getChatSessionStore } from "~/lib/sync/stores";

const ONBOARDING_FLAG = "demo-onboarding";

export function hasDemoOnboardingState(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(ONBOARDING_FLAG) !== null;
}

export async function isFirstVisit(): Promise<boolean> {
  if (typeof window === "undefined" || hasDemoOnboardingState()) {
    return false;
  }

  const check = Effect.gen(function* () {
    const auth = yield* AuthService;
    const session = yield* auth.getSession();
    if (session.user !== null) return false;

    const books = yield* BookService;
    return (yield* books.getBooks()).length === 0;
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));

  return AppRuntime.runPromise(check);
}

function fetchDemoEpub() {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(DEMO_EPUB_PATH);
      if (!response.ok) {
        throw new Error(`Failed to fetch demo EPUB (${response.status})`);
      }
      return response.arrayBuffer();
    },
    catch: (cause) => new StorageError({ operation: "fetchDemoEpub", cause }),
  });
}

function saveDemoChat(bookId: string) {
  return Effect.tryPromise({
    try: async () => {
      const sessionStore = getChatSessionStore();
      const activeSessionStore = getActiveSessionStore();
      const sessions = (await get<ChatSession[]>(bookId, sessionStore)) ?? [];
      const session = { ...DEMO_CHAT_SESSION, bookId };

      if (!sessions.some((existing) => existing.id === session.id)) {
        // Direct IDB writes intentionally avoid a sync change while the visitor is signed out.
        await set(bookId, [...sessions, session], sessionStore);
      }
      if (!(await get<string>(bookId, activeSessionStore))) {
        await set(bookId, session.id, activeSessionStore);
      }
    },
    catch: (cause) => new ChatError({ operation: "saveDemoChat", cause }),
  });
}

export async function seedDemo(): Promise<BookMeta | null> {
  if (typeof window === "undefined") return null;

  const program = Effect.gen(function* () {
    const data = yield* fetchDemoEpub();
    const fileHash = yield* Effect.promise(() => computeFileHash(data));
    const books = yield* BookService;
    let book = yield* books.findByFileHash(fileHash);

    if (!book) {
      const parsed = yield* parseEpubEffect(data);
      book = {
        ...DEMO_BOOK_METADATA,
        id: DEMO_BOOK_ID,
        coverImage: parsed.coverImage,
        fileHash,
      };
      // BookService and saveNotebook always record changes. That is safe here because
      // sync only runs while authenticated; the position and chat writes avoid them.
      yield* books.saveBook(book, data);
    }

    const positions = yield* ReadingPositionService;
    if ((yield* positions.getPosition(book.id)) === null) {
      yield* positions.savePosition(book.id, DEMO_POSITION_CFI, { recordChange: false });
    }

    const annotations = yield* AnnotationService;
    if ((yield* annotations.getNotebook(book.id)) === null) {
      yield* annotations.saveNotebook({
        bookId: book.id,
        content: DEMO_NOTEBOOK_CONTENT,
        updatedAt: Date.now(),
      });
    }

    yield* saveDemoChat(book.id);
    const workspace = yield* WorkspaceService;
    yield* Effect.all([workspace.clearLayout(), workspace.clearFocusedState()]);
    return book;
  });

  const book = await AppRuntime.runPromise(program);
  window.localStorage.setItem(ONBOARDING_FLAG, "complete");
  return book;
}
