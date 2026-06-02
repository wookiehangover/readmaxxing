import { beforeEach, describe, expect, it } from "vitest";
import { clear, createStore, get, set } from "idb-keyval";
import { registerActiveReader, unregisterActiveReader } from "../active-readers";
import { mergePositionRecord } from "../entity-mergers";

const positionStore = createStore("ebook-reader-positions", "positions");
const TEST_BOOK_IDS = ["book-active", "book-missing-active", "book-lww", "book-closed-lww"];

beforeEach(async () => {
  for (const bookId of TEST_BOOK_IDS) {
    unregisterActiveReader(bookId);
  }
  await clear(positionStore);
});

describe("mergePositionRecord", () => {
  it("drops remote position records for active readers without writing IDB", async () => {
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
  });

  it("preserves LWW behavior for non-active readers", async () => {
    await mergePositionRecord({ bookId: "book-lww", cfi: "initial", updatedAt: 100 });
    await expect(get("book-lww", positionStore)).resolves.toMatchObject({
      cfi: "initial",
      updatedAt: 100,
    });

    await mergePositionRecord({ bookId: "book-lww", cfi: "older", updatedAt: 50 });
    await expect(get("book-lww", positionStore)).resolves.toMatchObject({
      cfi: "initial",
      updatedAt: 100,
    });

    await mergePositionRecord({ bookId: "book-lww", cfi: "newer", updatedAt: 200 });
    await expect(get("book-lww", positionStore)).resolves.toMatchObject({
      cfi: "newer",
      updatedAt: 200,
    });
  });

  it("restores LWW behavior after unregistering an active reader", async () => {
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
      cfi: "remote-closed",
      updatedAt: 300,
    });
  });
});
