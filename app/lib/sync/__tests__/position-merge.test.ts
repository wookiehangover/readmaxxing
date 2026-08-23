import { beforeEach, describe, expect, it } from "vitest";
import { clear, createStore, get, set } from "idb-keyval";
import { registerActiveReader, unregisterActiveReader } from "../active-readers";
import { mergePositionRecord } from "../entity-mergers";
import { getRemotePositionRecord } from "~/lib/stores/remote-position-store";

const positionStore = createStore("ebook-reader-positions", "positions");
const remotePositionStore = createStore("ebook-reader-remote-positions", "positions");
const TEST_BOOK_IDS = ["book-active", "book-missing-active", "book-lww", "book-closed-lww"];

beforeEach(async () => {
  for (const bookId of TEST_BOOK_IDS) {
    unregisterActiveReader(bookId);
  }
  await clear(positionStore);
  await clear(remotePositionStore);
});

describe("mergePositionRecord", () => {
  it("writes active-reader remote records without touching local positions", async () => {
    await set("book-active", { id: "book-active", cfi: "local", updatedAt: 100 }, positionStore);
    registerActiveReader("book-active");
    registerActiveReader("book-missing-active");

    await mergePositionRecord({ bookId: "book-active", cfi: "remote", updatedAt: 200 });
    await mergePositionRecord({ bookId: "book-missing-active", cfi: "remote", updatedAt: 200 });

    await expect(get("book-active", positionStore)).resolves.toMatchObject({
      cfi: "local",
      updatedAt: 100,
    });
    await expect(get("book-missing-active", positionStore)).resolves.toBeUndefined();
    await expect(getRemotePositionRecord("book-active")).resolves.toEqual({
      cfi: "remote",
      updatedAt: 200,
    });
    await expect(getRemotePositionRecord("book-missing-active")).resolves.toEqual({
      cfi: "remote",
      updatedAt: 200,
    });
  });

  it.each([
    ["EPUB CFI", "epubcfi(/6/4!/4/2/2)", "epubcfi(/6/4!/4/4/2)"],
    ["PDF page", "page:2", "page:12"],
  ])("prefers further %s content before timestamps", async (_label, earlier, further) => {
    await mergePositionRecord({ bookId: "book-lww", cfi: earlier, updatedAt: 200 });
    await mergePositionRecord({ bookId: "book-lww", cfi: further, updatedAt: 100 });
    await expect(getRemotePositionRecord("book-lww")).resolves.toEqual({
      cfi: further,
      updatedAt: 200,
    });
    await expect(get("book-lww", positionStore)).resolves.toBeUndefined();

    await mergePositionRecord({ bookId: "book-lww", cfi: earlier, updatedAt: 300 });
    await expect(getRemotePositionRecord("book-lww")).resolves.toEqual({
      cfi: further,
      updatedAt: 200,
    });

    await mergePositionRecord({ bookId: "book-lww", cfi: further, updatedAt: 300 });
    await expect(getRemotePositionRecord("book-lww")).resolves.toEqual({
      cfi: further,
      updatedAt: 300,
    });
  });

  it("keeps local position untouched after unregistering an active reader", async () => {
    await set(
      "book-closed-lww",
      { id: "book-closed-lww", cfi: "local", updatedAt: 100 },
      positionStore,
    );
    registerActiveReader("book-closed-lww");

    await mergePositionRecord({ bookId: "book-closed-lww", cfi: "remote-open", updatedAt: 200 });
    await expect(get("book-closed-lww", positionStore)).resolves.toMatchObject({
      cfi: "local",
      updatedAt: 100,
    });

    unregisterActiveReader("book-closed-lww");
    await mergePositionRecord({ bookId: "book-closed-lww", cfi: "remote-closed", updatedAt: 300 });

    await expect(get("book-closed-lww", positionStore)).resolves.toMatchObject({
      cfi: "local",
      updatedAt: 100,
    });
    await expect(getRemotePositionRecord("book-closed-lww")).resolves.toEqual({
      cfi: "remote-closed",
      updatedAt: 300,
    });
  });

  it("dispatches a position sync update event after writing a remote position", async () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener("sync:entity-updated", listener);

    try {
      await mergePositionRecord({ bookId: "book-lww", cfi: "remote", updatedAt: 100 });
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    } finally {
      window.removeEventListener("sync:entity-updated", listener);
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({ entity: "position" });
  });
});
