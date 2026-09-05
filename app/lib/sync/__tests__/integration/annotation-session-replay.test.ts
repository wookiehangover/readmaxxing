// @vitest-environment node
import { beforeEach, it, expect, vi } from "vitest";
import { clear, get, set } from "idb-keyval";
import { AnnotationService, type Highlight } from "~/lib/stores/annotations-store";
import { BookmarkService, type Bookmark } from "~/lib/stores/bookmark-store";
import { ChatService } from "~/lib/stores/chat-store";
import { ReadingPositionService } from "~/lib/stores/position-store";
import { ENTITY_MERGERS } from "../../entity-mergers";
import { getUnsyncedChanges, recordChange } from "../../change-log";
import { pushChangesWithResult } from "../../push";
import {
  getHighlightStore,
  getBookmarkStore,
  getChatSessionStore,
  getActiveSessionStore,
  getPositionStore,
} from "../../stores";
import { BASE, db, mutation, push, row, pull, ctx, routeFetch } from "./push-route-harness";

beforeEach(async () => {
  await Promise.all(
    [
      getHighlightStore(),
      getBookmarkStore(),
      getChatSessionStore(),
      getActiveSessionStore(),
      getPositionStore(),
    ].map((store) => clear(store)),
  );
});

async function pendingChange() {
  await vi.waitFor(async () => expect(await getUnsyncedChanges()).toHaveLength(1));
  return (await getUnsyncedChanges())[0];
}

it("AnnotationService edits under a frozen clock persist and survive replay", async () => {
  vi.spyOn(Date, "now").mockReturnValue(BASE);
  routeFetch();
  await AnnotationService.saveHighlight({
    id: "entity",
    bookId: "entity",
    cfiRange: "epubcfi(/6/4)",
    text: "old",
    color: "yellow",
    createdAt: BASE,
  });
  const original = await pendingChange();
  await pushChangesWithResult(ctx());
  await AnnotationService.updateHighlight("entity", { note: "new note" });
  const edited = await pendingChange();
  expect(edited.timestamp).toBeGreaterThan(original.timestamp);
  await pushChangesWithResult(ctx());
  expect(await getUnsyncedChanges()).toEqual([]);
  expect((await row("highlight")).note).toBe("new note");
  const saved = await row("highlight");
  await push([original, edited]);
  expect(await row("highlight")).toEqual(saved);
});

it("ChatService title edits and deletes under a frozen clock survive replay", async () => {
  vi.spyOn(Date, "now").mockReturnValue(BASE);
  routeFetch();
  const session = await ChatService.createSession("entity", "original title");
  const original = await pendingChange();
  await pushChangesWithResult(ctx());
  await ChatService.updateSessionTitle(session.id, "entity", "new title");
  const edited = await pendingChange();
  expect(edited.timestamp).toBeGreaterThan(original.timestamp);
  await pushChangesWithResult(ctx());
  const readSession = async () =>
    (
      await db.query<{ title: string; deleted_at: Date | null }>(
        "SELECT title, deleted_at FROM readmax.chat_session WHERE id=$1",
        [session.id],
      )
    ).rows[0];
  expect(await readSession()).toEqual({ title: "new title", deleted_at: null });
  await push([original, edited]);
  expect(await readSession()).toEqual({ title: "new title", deleted_at: null });
  await ChatService.deleteSession(session.id, "entity");
  const deleted = await pendingChange();
  expect(deleted.timestamp).toBeGreaterThan(edited.timestamp);
  await pushChangesWithResult(ctx());
  expect((await readSession()).deleted_at).not.toBeNull();
  await push([edited]);
  expect((await readSession()).deleted_at).not.toBeNull();
  expect(await getUnsyncedChanges()).toEqual([]);
});

it.each(["highlight", "chat_session"] as const)(
  "%s exact replay is acknowledged; ambiguous legacy clock collisions remain durable",
  async (entity) => {
    const original = mutation(entity);
    await push([original]);
    const saved = await row(entity);
    expect((await push([original], true)).body.accepted).toEqual([{ id: original.id }]);
    expect(await row(entity)).toEqual(saved);
    const { id: _id, synced: _synced, ...input } = original;
    const conflicting = await recordChange({
      ...input,
      data: { ...(original.data as object), note: "unsaved note", title: "unsaved title" },
    });
    routeFetch();
    await expect(pushChangesWithResult(ctx())).rejects.toThrow("share a mutation timestamp");
    const [retained] = await getUnsyncedChanges();
    expect(retained).toMatchObject({
      id: conflicting.id,
      data: conflicting.data,
      failure: { retryable: true },
    });
    expect(await row(entity)).toEqual(saved);
    expect((await push([conflicting])).status).toBe(503);
    expect(await row(entity)).toEqual(saved);
  },
);

it.each(["highlight", "bookmark"] as const)(
  "a real older %s delete beats a newer live put and converges for existing and fresh clients",
  async (entity) => {
    const store = entity === "highlight" ? getHighlightStore() : getBookmarkStore();
    const clock = vi.spyOn(Date, "now").mockReturnValue(BASE);
    routeFetch();
    const original: Highlight & Bookmark = {
      id: "entity",
      bookId: "entity",
      cfiRange: "epubcfi(/6/4)",
      text: "old",
      color: "yellow",
      createdAt: BASE,
    };
    if (entity === "highlight") await AnnotationService.saveHighlight(original);
    else await BookmarkService.saveBookmark(original);
    await pendingChange();
    await pushChangesWithResult(ctx());
    const offlineCopy = await get("entity", store);
    await push([mutation(entity, 2)]);
    expect((await row(entity)).deleted_at).toBeNull();
    await set("entity", offlineCopy, store);
    clock.mockReturnValue(BASE + 1000);
    if (entity === "highlight") await AnnotationService.deleteHighlight("entity");
    else await BookmarkService.deleteBookmark("entity");
    const deletion = await pendingChange();
    await pushChangesWithResult(ctx());
    const deleted = await row(entity);
    expect(deleted.deleted_at).toEqual(new Date(deletion.timestamp));
    // A disconnected client then submits an ordinary live edit with a newer clock.
    await push([mutation(entity, 3)]);
    expect(await row(entity)).toEqual(deleted);
    const record = (await pull(entity)).changes[0].records[0] as Record<string, unknown>;
    await ENTITY_MERGERS[entity]!(record);
    const existingClient = await get<Highlight | Bookmark>("entity", store);
    await clear(store);
    await ENTITY_MERGERS[entity]!(record);
    const freshClient = await get<Highlight | Bookmark>("entity", store);
    expect(existingClient?.deletedAt).toBe(deletion.timestamp);
    expect(freshClient?.deletedAt).toBe(existingClient?.deletedAt);
  },
);

it.each(["highlight", "bookmark"] as const)(
  "legacy snapshotless older %s deletes keep delete-wins semantics",
  async (entity) => {
    await push([mutation(entity, 2)]);
    await push([{ ...mutation(entity, 1), operation: "delete", data: null }]);
    const deleted = await row(entity);
    expect(deleted.deleted_at).toEqual(new Date(BASE + 1000));
    await push([mutation(entity, 3)]);
    expect(await row(entity)).toEqual(deleted);
  },
);

it.each(["highlight", "bookmark"] as const)(
  "legacy %s tombstones with no mutation clock remain authoritative",
  async (entity) => {
    await push([{ ...mutation(entity, 1), operation: "delete" }]);
    await db.exec(`UPDATE readmax.${entity} SET mutation_at = NULL`);
    const deleted = await row(entity);
    await push([mutation(entity, 3)]);
    expect(await row(entity)).toEqual(deleted);
  },
);

it("ambiguous legacy position collisions remain durable while exact replays are acknowledged", async () => {
  const initial = { ...mutation("position"), data: { cfi: "legacy-location-one" } };
  await push([initial]);
  const saved = await row("position");
  expect((await push([initial], true)).body.accepted).toEqual([{ id: initial.id }]);
  const { id: _id, synced: _synced, ...input } = initial;
  const conflicting = await recordChange({ ...input, data: { cfi: "legacy-location-two" } });
  routeFetch();
  await expect(pushChangesWithResult(ctx())).rejects.toThrow("share a mutation timestamp");
  expect((await getUnsyncedChanges())[0]).toMatchObject({
    id: conflicting.id,
    data: conflicting.data,
    failure: { retryable: true },
  });
  expect(await row("position")).toEqual(saved);
});

it("ReadingPositionService advances changed incomparable locations under a frozen clock", async () => {
  vi.spyOn(Date, "now").mockReturnValue(BASE);
  routeFetch();
  await ReadingPositionService.savePosition("entity", "legacy-location-one");
  const original = await pendingChange();
  await pushChangesWithResult(ctx());
  await ReadingPositionService.savePosition("entity", "legacy-location-two");
  const edited = await pendingChange();
  expect(edited.timestamp).toBeGreaterThan(original.timestamp);
  await pushChangesWithResult(ctx());
  expect((await row("position")).cfi).toBe("legacy-location-two");
  await push([original, edited]);
  expect((await row("position")).cfi).toBe("legacy-location-two");
});
