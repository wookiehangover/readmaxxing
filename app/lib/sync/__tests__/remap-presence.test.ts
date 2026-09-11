// @vitest-environment node
import { beforeEach, expect, it } from "vitest";
import { clear, get, set, promisifyRequest } from "idb-keyval";
import * as stores from "../stores";
import { moveRemapRecord } from "../remap-records";
import { listCustody } from "../custody-journal";

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((store) => clear(store())));
});
const source = { bookId: "source", content: { text: "source" }, updatedAt: 1 };

it.each([false, true])(
  "retains an undefined target only when it was present (%s)",
  async (present) => {
    const store = stores.getNotebookStore();
    await set("source", source, store);
    if (present) await set("target", undefined, store);
    expect(
      await moveRemapRecord<typeof source>(store, "source", "target", (value) => ({
        ...value,
        bookId: "target",
      })),
    ).toBe(true);
    expect(await get("source", store)).toBeUndefined();
    expect(await get("target", store)).toEqual({ ...source, bookId: "target" });
    const before = (await listCustody()).filter(
      ({ item }) => item.key === "target" && item.role === "before",
    );
    expect(before).toHaveLength(present ? 1 : 0);
    if (present) expect(before[0].item.raw).toBeUndefined();
  },
);

it("rechecks target presence when an old writer stores undefined during preparation", async () => {
  const store = stores.getNotebookStore();
  await set("source", source, store);
  let preparations = 0;
  await moveRemapRecord<typeof source>(
    store,
    "source",
    "target",
    (value) => ({ ...value, bookId: "target" }),
    {
      prepare: async () => {
        if (preparations++ === 0) await set("target", undefined, store);
      },
    },
  );
  expect(preparations).toBe(2);
  expect(await get("target", store)).toEqual({ ...source, bookId: "target" });
  const before = (await listCustody()).filter(
    ({ item }) => item.key === "target" && item.role === "before",
  );
  expect(before).toHaveLength(1);
  expect(before[0].item.raw).toBeUndefined();
});

it("leaves a present undefined source intact without inventing custody or target records", async () => {
  const store = stores.getNotebookStore();
  await set("source", undefined, store);
  expect(await moveRemapRecord(store, "source", "target", () => ({ text: "unexpected" }))).toBe(
    false,
  );
  expect(
    await store("readonly", (objectStore) => promisifyRequest(objectStore.count("source"))),
  ).toBe(1);
  expect(
    await store("readonly", (objectStore) => promisifyRequest(objectStore.count("target"))),
  ).toBe(0);
  expect(await listCustody()).toEqual([]);
});
