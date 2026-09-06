// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, get, set } from "idb-keyval";
import { BASE, USER, db, push, pull, routeFetch } from "./push-route-harness";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import { persistAdoptedDemoContent } from "~/lib/onboarding/adopt-demo";
import { getUnsyncedChanges } from "../../change-log";
import * as stores from "../../stores";

vi.mock("../../book-chapter-uploads", () => ({ ensureBookChaptersUploaded: async () => {} }));

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  await Promise.all([
    set(
      DEMO_BOOK_ID,
      {
        id: DEMO_BOOK_ID,
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        fileHash: "gatsby",
        format: "epub",
        updatedAt: BASE,
      },
      stores.getBookStore(),
    ),
    set(DEMO_BOOK_ID, new ArrayBuffer(8), stores.getBookDataStore()),
    set(
      DEMO_BOOK_ID,
      { bookId: DEMO_BOOK_ID, content: { text: "offline notes" }, updatedAt: BASE },
      stores.getNotebookStore(),
    ),
    set(DEMO_BOOK_ID, { cfi: "page:12", updatedAt: BASE }, stores.getPositionStore()),
    set(
      DEMO_BOOK_ID,
      [{ ...DEMO_CHAT_SESSION, createdAt: BASE, updatedAt: BASE }],
      stores.getChatSessionStore(),
    ),
    set(DEMO_BOOK_ID, DEMO_CHAT_SESSION.id, stores.getActiveSessionStore()),
  ]);
  routeFetch();
});

it("adopts through the real route and SQL, preserves newer canonical notes, and exposes fresh pull", async () => {
  await push(
    [
      {
        id: "cloud-root",
        entity: "book",
        entityId: "canonical",
        operation: "put",
        data: { id: "canonical", title: "My cloud edition", fileHash: "gatsby", format: "epub" },
        timestamp: BASE + 1000,
        synced: false,
      },
      {
        id: "cloud-notes",
        entity: "notebook",
        entityId: "canonical",
        operation: "put",
        data: { bookId: "canonical", content: { text: "newer cloud notes" } },
        timestamp: BASE + 1000,
        synced: false,
      },
    ],
    true,
  );
  const result = await persistAdoptedDemoContent(USER);
  expect(result.bookId).toBe("canonical");
  expect(await getUnsyncedChanges()).toEqual([]);
  expect(
    (await db.query("SELECT title, mutation_at FROM readmax.book WHERE id = 'canonical'")).rows,
  ).toEqual([{ title: "My cloud edition", mutation_at: new Date(BASE + 1000) }]);
  expect(
    (await db.query("SELECT content FROM readmax.notebook WHERE book_id = 'canonical'")).rows,
  ).toEqual([{ content: { text: "newer cloud notes" } }]);
  const pulled = await pull("notebook");
  expect(pulled.changes[0].records).toContainEqual(
    expect.objectContaining({ bookId: "canonical", content: { text: "newer cloud notes" } }),
  );
  expect(await get("canonical", stores.getBookDataStore())).toBeInstanceOf(ArrayBuffer);
  expect((await persistAdoptedDemoContent(USER)).bookId).toBe("canonical");
});

it("retains the original adoption when a disposable database lacks the mutation column", async () => {
  await db.exec("ALTER TABLE readmax.book RENAME COLUMN mutation_at TO unavailable_mutation_at");
  try {
    await expect(persistAdoptedDemoContent(USER)).rejects.toThrow();
    const pending = await getUnsyncedChanges();
    const root = pending.find((change) => change.entity === "book")!;
    expect(root.failure?.retryable).toBe(true);
    expect(root.timestamp).toBe(BASE);
    await expect(persistAdoptedDemoContent(USER)).rejects.toThrow();
    expect(await getUnsyncedChanges()).toEqual(pending);
    expect(await get(root.entityId, stores.getBookDataStore())).toBeInstanceOf(ArrayBuffer);
  } finally {
    await db.exec("ALTER TABLE readmax.book RENAME COLUMN unavailable_mutation_at TO mutation_at");
  }
});
