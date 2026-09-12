// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { clear, entries, get, set } from "idb-keyval";
import * as stores from "../stores";
import { setCustodyAccount } from "../custody-session";
import { recoverBookAliases } from "../alias-recovery";
import { getBookRemaps } from "../remap-journal";
import { listCustody } from "../custody-journal";
import { getUnsyncedChanges } from "../change-log";

beforeEach(async () => {
  vi.unstubAllGlobals();
  setCustodyAccount(undefined);
  await Promise.all(Object.values(stores).map((store) => clear(store())));
});

it("rejects an in-flight page after account change without publishing progress or cleaning sources", async () => {
  setCustodyAccount("A");
  await set(
    "source",
    { bookId: "source", content: { text: "private" }, updatedAt: 1 },
    stores.getNotebookStore(),
  );
  let release!: (response: Response) => void;
  let started!: () => void;
  const called = new Promise<void>((resolve) => {
    started = resolve;
  });
  vi.stubGlobal("fetch", () => {
    started();
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  const recovery = recoverBookAliases({ userId: "A", isStopped: () => false });
  await called;
  setCustodyAccount("B");
  release(
    Response.json({
      ownerId: "A",
      aliases: [{ fromId: "source", toId: "target", version: "1" }],
      cursor: "1",
      hasMore: false,
    }),
  );
  await expect(recovery).rejects.toThrow("Account changed");
  expect(await entries(stores.getAliasProgressStore())).toEqual([]);
  expect(await getBookRemaps()).toEqual([]);
  expect(await get("source", stores.getNotebookStore())).toMatchObject({
    content: { text: "private" },
  });
  expect(await listCustody("B")).toEqual([]);
});

it("journals invalid-clock source content through an evolving chain without replacing a newer canonical notebook", async () => {
  setCustodyAccount("A");
  await set(
    "source",
    { bookId: "source", content: { text: "invalid source" }, updatedAt: NaN },
    stores.getNotebookStore(),
  );
  await set(
    "middle",
    { bookId: "middle", content: { text: "middle source" }, updatedAt: 2 },
    stores.getNotebookStore(),
  );
  await set(
    "target",
    { bookId: "target", content: { text: "canonical" }, updatedAt: 10 },
    stores.getNotebookStore(),
  );
  let page = 0;
  vi.stubGlobal("fetch", async () =>
    Response.json({
      ownerId: "A",
      aliases:
        page++ === 0
          ? [{ fromId: "source", toId: "middle", version: "1" }]
          : [{ fromId: "source", toId: "target", version: "2" }],
      cursor: String(page),
      hasMore: false,
    }),
  );
  await recoverBookAliases({ userId: "A", isStopped: () => false });
  await recoverBookAliases({ userId: "A", isStopped: () => false });
  expect(await get("source", stores.getNotebookStore())).toBeUndefined();
  expect(await get("middle", stores.getNotebookStore())).toBeUndefined();
  expect(await get("target", stores.getNotebookStore())).toEqual({
    bookId: "target",
    content: { text: "canonical" },
    updatedAt: 10,
  });
  expect((await getUnsyncedChanges()).some((entry) => !Number.isFinite(entry.timestamp))).toBe(
    false,
  );
  expect(
    (await listCustody("A")).some(({ item }) => {
      const raw = item.raw as { updatedAt?: number; content?: { text?: string } };
      return raw?.content?.text === "invalid source" && Number.isNaN(raw.updatedAt);
    }),
  ).toBe(true);
  expect(await get(["aliases", 1, "A"], stores.getAliasProgressStore())).toMatchObject({
    complete: true,
    cursor: "2",
  });
});
