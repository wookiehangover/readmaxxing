import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clear, entries, get, set } from "idb-keyval";
import * as stores from "~/lib/sync/stores";
import * as remapRecords from "~/lib/sync/remap-records";
import { getUnsyncedChanges, recordChange } from "~/lib/sync/change-log";
import { persistBookRemap } from "~/lib/sync/remap-journal";
import { pushChangesWithResult } from "~/lib/sync/push";
import { pullChanges } from "~/lib/sync/pull";
import { prepareAdoptedDemoContent, repairAdoptedDemoSessions } from "./adopt-demo-local";
import { persistAdoptedDemoContent } from "./adopt-demo";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import { ChatService, type ChatSession } from "~/lib/stores/chat-store";
import type { SyncPushRequest } from "~/lib/sync/types";

vi.mock("~/lib/sync/file-uploads", () => ({ uploadPendingFiles: async () => {} }));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({ ensureBookChaptersUploaded: async () => {} }));

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  await set(
    DEMO_BOOK_ID,
    { id: DEMO_BOOK_ID, title: "Gatsby", format: "epub", fileHash: "gatsby", updatedAt: 100 },
    stores.getBookStore(),
  );
  await set(DEMO_BOOK_ID, new Uint8Array([1, 2, 3]).buffer, stores.getBookDataStore());
  await set(DEMO_BOOK_ID, [DEMO_CHAT_SESSION], stores.getChatSessionStore());
  await set(DEMO_BOOK_ID, DEMO_CHAT_SESSION.id, stores.getActiveSessionStore());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["adopted", DEMO_CHAT_SESSION.id, "stale-session", undefined])(
  "preserves a real newly created conversation selected during active-pointer repair (previous: %s)",
  async (previous) => {
    const adopted = await prepareAdoptedDemoContent("reader");
    const activeStore = stores.getActiveSessionStore();
    if (previous !== "adopted") await set(adopted.bookId, previous, activeStore);
    let newSession!: ChatSession;
    let inserted = false;
    vi.spyOn(stores, "getActiveSessionStore").mockReturnValue(async (mode, callback) => {
      if (mode === "readwrite" && !inserted) {
        inserted = true;
        newSession = await ChatService.createSession(adopted.bookId, "New conversation");
      }
      return activeStore(mode, callback);
    });
    await repairAdoptedDemoSessions("reader");
    expect(inserted).toBe(true);
    expect(await get(adopted.bookId, stores.getChatSessionStore())).toContainEqual(newSession);
    expect(await get(adopted.bookId, activeStore)).toBe(newSession.id);
    await vi.waitFor(async () =>
      expect(await getUnsyncedChanges()).toContainEqual(
        expect.objectContaining({ entity: "chat_session", entityId: newSession.id, synced: false }),
      ),
    );
  },
);

it("repairs canonical sessions only after their messages merge during the same pull", async () => {
  const adopted = await prepareAdoptedDemoContent("reader");
  await seedCanonical();
  await persistBookRemap("reader", adopted.bookId, "canonical");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("book-aliases")
        ? Response.json({ ownerId: "reader", aliases: [], cursor: "0", hasMore: false })
        : Response.json({
            changes: [
              {
                entity: "chat_session",
                records: [{ ...DEMO_CHAT_SESSION, bookId: "canonical" }],
                cursor: new Date().toISOString(),
              },
              {
                entity: "chat_message",
                records: [
                  {
                    id: "pulled-message",
                    sessionId: DEMO_CHAT_SESSION.id,
                    content: "Keep this incoming message too",
                    role: "user",
                    createdAt: 170,
                  },
                ],
                cursor: new Date().toISOString(),
              },
            ],
          }),
    ),
  );
  await pullChanges({ userId: "reader", isStopped: () => false });
  const sessions = await get<ChatSession[]>("canonical", stores.getChatSessionStore());
  expect(sessions?.some((session) => session.id === DEMO_CHAT_SESSION.id)).toBe(false);
  expect(sessions?.flatMap((session) => session.messages)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "retained-message" }),
      expect.objectContaining({ id: "pulled-message" }),
    ]),
  );
  expect(await get("canonical", stores.getActiveSessionStore())).toBe(adopted.sessionId);
});

it.each(["journal", "outbox", "same-owner-missing-intent"])(
  "rejects %s ownership evidence before allocating or mutating any data",
  async (evidence) => {
    if (evidence !== "outbox")
      await persistBookRemap(
        evidence === "journal" ? "previous-reader" : "reader",
        DEMO_BOOK_ID,
        "previous-book",
      );
    await recordChange({
      entity: "book",
      entityId: DEMO_BOOK_ID,
      operation: "put",
      data: await get(DEMO_BOOK_ID, stores.getBookStore()),
      timestamp: 100,
      ...(evidence === "outbox" ? { ownerId: "previous-reader" } : {}),
    });
    const snapshot = () => Promise.all(Object.values(stores).map((store) => entries(store())));
    const before = await snapshot();
    const allocate = vi.spyOn(crypto, "randomUUID");
    await expect(prepareAdoptedDemoContent("reader")).rejects.toThrow(/ownership|another account/);
    expect(allocate).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  },
);

function acceptingServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const { changes } = JSON.parse(init.body) as SyncPushRequest;
      return Response.json({
        accepted: changes.map((change) => ({
          id: change.id,
          ...(change.entity === "book" ? { canonicalId: "canonical" } : {}),
        })),
        rejected: [],
        serverTimestamp: new Date().toISOString(),
      });
    }),
  );
}

async function seedCanonical(active = DEMO_CHAT_SESSION.id) {
  await set(
    "canonical",
    { id: "canonical", title: "Cloud edition", updatedAt: 900 },
    stores.getBookStore(),
  );
  await set(
    "canonical",
    [
      {
        ...DEMO_CHAT_SESSION,
        bookId: "canonical",
        messages: [
          {
            id: "retained-message",
            role: "user",
            content: "Keep me",
            createdAt: 150,
          },
        ],
      },
      {
        ...DEMO_CHAT_SESSION,
        id: "unrelated",
        bookId: "canonical",
        title: "My conversation",
        messages: [
          { id: "unrelated-message", role: "user", content: "Also keep me", createdAt: 160 },
        ],
      },
    ],
    stores.getChatSessionStore(),
  );
  await set("canonical", active, stores.getActiveSessionStore());
}

it.each([DEMO_CHAT_SESSION.id, "unrelated"])(
  "repairs canonical reserved sessions while preserving cached messages and active %s",
  async (active) => {
    await seedCanonical(active);
    acceptingServer();
    const result = await persistAdoptedDemoContent("reader");
    const sessions = await get<ChatSession[]>("canonical", stores.getChatSessionStore());
    expect(await get("canonical", stores.getActiveSessionStore())).toBe(result.sessionId);
    if (active === "unrelated") expect(result.sessionId).toBe(active);
    expect(sessions).toHaveLength(2);
    expect(sessions?.some((session) => session.id === DEMO_CHAT_SESSION.id)).toBe(false);
    expect(sessions?.flatMap((session) => session.messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "retained-message", content: "Keep me" }),
        expect.objectContaining({ id: "unrelated-message", content: "Also keep me" }),
      ]),
    );
  },
);

it("resumes canonical session repair after retained replay and before the local identity write", async () => {
  await seedCanonical();
  const adopted = await prepareAdoptedDemoContent("reader");
  const move = remapRecords.moveRemapRecord;
  vi.spyOn(remapRecords, "moveRemapRecord").mockImplementation(
    async (store, from, to, merge, options) => {
      if (from === "canonical" && to === "canonical") {
        await options?.prepare?.(await get(from, store));
        throw new Error("Interrupted canonical session repair");
      }
      return move(store, from, to, merge, options);
    },
  );
  acceptingServer();
  await expect(persistAdoptedDemoContent("reader")).rejects.toThrow(
    "Interrupted canonical session repair",
  );
  expect((await getUnsyncedChanges()).some((change) => change.entityId === adopted.sessionId)).toBe(
    true,
  );
  expect(
    (await get<ChatSession[]>("canonical", stores.getChatSessionStore()))?.some(
      (session) => session.id === DEMO_CHAT_SESSION.id,
    ),
  ).toBe(true);
  vi.restoreAllMocks();
  await pushChangesWithResult({
    fileUploadContext: { userId: "reader", uploadRetryState: new Map() },
    isStopped: () => false,
    scheduleFollowUpPush: () => {},
  });
  expect(await get("canonical", stores.getActiveSessionStore())).toBe(adopted.sessionId);
  const sessions = await get<ChatSession[]>("canonical", stores.getChatSessionStore());
  expect(sessions?.some((session) => session.id === DEMO_CHAT_SESSION.id)).toBe(false);
  expect(sessions?.flatMap((session) => session.messages)).toContainEqual(
    expect.objectContaining({ id: "retained-message" }),
  );
});
