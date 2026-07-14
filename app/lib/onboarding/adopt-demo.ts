import { get, set } from "idb-keyval";
import { Effect } from "effect";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import { AppRuntime } from "~/lib/effect-runtime";
import type { BookMeta } from "~/lib/stores/book-store";
import type { ChatSession } from "~/lib/stores/chat-store";
import type { PositionRecord } from "~/lib/stores/position-store";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { ensureBookChaptersUploaded } from "~/lib/sync/book-chapter-uploads";
import { recordChange } from "~/lib/sync/change-log";
import { pushChangesWithResult } from "~/lib/sync/push";
import {
  getActiveSessionStore,
  getBookDataStore,
  getBookStore,
  getChatSessionStore,
  getNotebookStore,
  getPositionStore,
} from "~/lib/sync/stores";
import type { ChangeEntry, SyncPushResponse } from "~/lib/sync/types";

interface DemoSnapshot {
  book: BookMeta;
  data: ArrayBuffer;
  position: PositionRecord | undefined;
  notebook: Record<string, unknown> | undefined;
  sessions: ChatSession[];
  activeSessionId: string | undefined;
}

export interface AdoptedDemo {
  bookId: string;
  sessionId: string;
}

async function readSnapshot(bookId: string): Promise<DemoSnapshot> {
  const [book, data, position, notebook, sessions, activeSessionId] = await Promise.all([
    get<BookMeta>(bookId, getBookStore()),
    get<ArrayBuffer>(bookId, getBookDataStore()),
    get<PositionRecord>(bookId, getPositionStore()),
    get<Record<string, unknown>>(bookId, getNotebookStore()),
    get<ChatSession[]>(bookId, getChatSessionStore()),
    get<string>(bookId, getActiveSessionStore()),
  ]);
  if (!book || !data || !sessions?.length) {
    throw new Error("The demo library is incomplete. Reload the page and try again.");
  }
  return { book, data, position, notebook, sessions, activeSessionId };
}

function createAdoptedSnapshot(snapshot: DemoSnapshot, bookId: string): DemoSnapshot {
  const demo = snapshot.sessions.find((session) => session.id === DEMO_CHAT_SESSION.id);
  if (!demo) throw new Error("The demo conversation could not be found.");

  // The adopted demo session must always receive a fresh id so it never collides
  // with a user-created session that may have taken over `activeSessionId`.
  const adoptedDemoSessionId = crypto.randomUUID();
  const activeWasUserSession =
    snapshot.activeSessionId != null && snapshot.activeSessionId !== DEMO_CHAT_SESSION.id;
  const activeSessionId = activeWasUserSession ? snapshot.activeSessionId : adoptedDemoSessionId;

  return {
    ...snapshot,
    book: { ...snapshot.book, id: bookId, deletedAt: undefined, updatedAt: Date.now() },
    notebook: snapshot.notebook ? { ...snapshot.notebook, bookId } : undefined,
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      id: session.id === demo.id ? adoptedDemoSessionId : session.id,
      bookId,
      ...(session.id === demo.id ? { updatedAt: Date.now() } : {}),
    })),
    activeSessionId,
  };
}

async function writeSnapshot(bookId: string, snapshot: DemoSnapshot): Promise<void> {
  const writes: Promise<void>[] = [
    set(bookId, snapshot.book, getBookStore()),
    set(bookId, snapshot.data, getBookDataStore()),
    set(bookId, snapshot.sessions, getChatSessionStore()),
  ];
  if (snapshot.position) writes.push(set(bookId, snapshot.position, getPositionStore()));
  if (snapshot.notebook) writes.push(set(bookId, snapshot.notebook, getNotebookStore()));
  if (snapshot.activeSessionId) {
    writes.push(set(bookId, snapshot.activeSessionId, getActiveSessionStore()));
  }
  await Promise.all(writes);
}

async function recordSnapshot(bookId: string, snapshot: DemoSnapshot): Promise<ChangeEntry[]> {
  const activeBook = { ...snapshot.book, id: bookId, deletedAt: undefined };
  const entries = [
    await recordChange({
      entity: "book",
      entityId: bookId,
      operation: "put",
      data: activeBook,
      timestamp: activeBook.updatedAt ?? Date.now(),
    }),
  ];

  if (snapshot.position) {
    entries.push(
      await recordChange({
        entity: "position",
        entityId: bookId,
        operation: "put",
        data: snapshot.position,
        timestamp: snapshot.position.updatedAt,
      }),
    );
  }
  if (snapshot.notebook) {
    const notebook = { ...snapshot.notebook, bookId };
    const notebookUpdatedAt = snapshot.notebook.updatedAt;
    entries.push(
      await recordChange({
        entity: "notebook",
        entityId: bookId,
        operation: "put",
        data: notebook,
        timestamp: typeof notebookUpdatedAt === "number" ? notebookUpdatedAt : Date.now(),
      }),
    );
  }
  for (const session of snapshot.sessions) {
    const { messages: _messages, ...metadata } = { ...session, bookId };
    entries.push(
      await recordChange({
        entity: "chat_session",
        entityId: session.id,
        operation: "put",
        data: metadata,
        timestamp: session.updatedAt,
      }),
    );
  }
  return entries;
}

function assertAccepted(result: SyncPushResponse | null, entries: ChangeEntry[]): void {
  const accepted = new Set(result?.accepted.map((entry) => entry.id));
  if (!result || entries.some((entry) => !accepted.has(entry.id))) {
    throw new Error("The demo library could not be saved to your account. Please try again.");
  }
}

async function remapSavedWorkspace(bookId: string): Promise<void> {
  const state = await AppRuntime.runPromise(
    WorkspaceService.pipe(
      Effect.andThen((service) => service.getFocusedState()),
      Effect.catchAll(() => Effect.succeed(null)),
    ),
  );
  if (!state || !state.order.includes(DEMO_BOOK_ID)) return;

  await AppRuntime.runPromise(
    WorkspaceService.pipe(
      Effect.andThen((service) =>
        service.saveFocusedState({
          order: state.order.map((id) => (id === DEMO_BOOK_ID ? bookId : id)),
          activeBookId: state.activeBookId === DEMO_BOOK_ID ? bookId : state.activeBookId,
          clusters: state.clusters.map((cluster) =>
            cluster.bookId === DEMO_BOOK_ID ? { ...cluster, bookId } : cluster,
          ),
        }),
      ),
    ),
  );
}

export async function adoptDemoContent(userId: string): Promise<AdoptedDemo> {
  const original = await readSnapshot(DEMO_BOOK_ID);
  // Demo IDs are fixed and database primary keys are global, so both entities
  // must receive account-specific IDs before their first server push.
  const adoptedBookId = crypto.randomUUID();
  const adopted = createAdoptedSnapshot(original, adoptedBookId);
  await writeSnapshot(adoptedBookId, adopted);
  const initialEntries = await recordSnapshot(adoptedBookId, adopted);
  const pushContext = {
    fileUploadContext: { userId, uploadRetryState: new Map() },
    isStopped: () => false,
    scheduleFollowUpPush: () => {},
  };
  const initialResult = await pushChangesWithResult(pushContext);
  assertAccepted(
    initialResult,
    initialEntries.filter((entry) => entry.entity === "book"),
  );

  const bookChangeId = initialEntries.find((entry) => entry.entity === "book")?.id;
  const bookId =
    initialResult?.accepted.find((entry) => entry.id === bookChangeId)?.canonicalId ??
    adoptedBookId;

  if (bookId !== adoptedBookId) {
    await set(bookId, { ...adopted.book, id: bookId, deletedAt: undefined }, getBookStore());
  }

  const canonical = await readSnapshot(bookId);
  const canonicalEntries = await recordSnapshot(bookId, canonical);
  const canonicalResult = await pushChangesWithResult(pushContext);
  assertAccepted(canonicalResult, canonicalEntries);
  await ensureBookChaptersUploaded(bookId);
  await remapSavedWorkspace(bookId);
  const now = Date.now();
  await set(DEMO_BOOK_ID, { ...original.book, deletedAt: now, updatedAt: now }, getBookStore());
  if (!adopted.activeSessionId) throw new Error("The demo conversation could not be adopted.");
  return { bookId, sessionId: adopted.activeSessionId };
}
