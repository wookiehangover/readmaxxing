// @vitest-environment node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { promisifyRequest } from "idb-keyval";
import { describe, expect, it } from "vitest";

const loadPackage = createRequire(import.meta.url);
const commonJS = loadPackage("fake-indexeddb") as typeof import("fake-indexeddb");
const packageDirectory = dirname(loadPackage.resolve("fake-indexeddb"));
// Use the emulator's own event class, as its upstream WPT harness does.
const CommonJSEvent = loadPackage(join(packageDirectory, "lib/FakeEvent.js")) as new (
  type: string,
) => Event;
const ESMEvent = (
  await import(pathToFileURL(join(packageDirectory, "../esm/lib/FakeEvent.js")).href)
).default as typeof CommonJSEvent;

// Guard the dev dependency patch in both distributed entry points. This is
// deliberately a count, not a machine-speed deadline: finished transactions
// must not accumulate in the emulator's scheduling/connection bookkeeping.
function tracked(db: IDBDatabase): IDBTransaction[] {
  return (db as unknown as { _rawDatabase: { transactions: IDBTransaction[] } })._rawDatabase
    .transactions;
}

describe.each([
  ["ESM", IDBFactory, ESMEvent],
  ["CommonJS", commonJS.IDBFactory, CommonJSEvent],
] as const)("IndexedDB scheduler (%s)", (_name, Factory, FakeEvent) => {
  async function open(factory = new Factory(), name = "scheduler", version = 1) {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("a");
      request.result.createObjectStore("b");
    };
    return promisifyRequest<IDBDatabase>(request);
  }

  it("releases completed transactions without losing stored data", async () => {
    const db = await open();
    try {
      for (let i = 0; i < 200; i++) {
        const tx = db.transaction("a", "readwrite");
        tx.objectStore("a").put(i, "value");
        await promisifyRequest(tx);
      }
      const tx = db.transaction("a");
      const done = promisifyRequest(tx);
      expect(await promisifyRequest(tx.objectStore("a").get("value"))).toBe(199);
      await done;
      expect(tracked(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("keeps waiting writers ordered, rolls back an aborted writer, and runs the next writer", async () => {
    const db = await open();
    try {
      const first = db.transaction("a", "readwrite");
      first.objectStore("a").put("original", "value");
      const firstDone = promisifyRequest(first);
      const aborted = db.transaction("a", "readwrite");
      const abortDone = new Promise<void>((resolve) =>
        aborted.addEventListener("abort", () => resolve()),
      );
      aborted.objectStore("a").put("discarded", "value").onsuccess = () => aborted.abort();
      const last = db.transaction("a", "readwrite");
      const lastDone = promisifyRequest(last);
      const observed = promisifyRequest(last.objectStore("a").get("value"));
      last.objectStore("a").put("final", "value");
      await Promise.all([firstDone, abortDone, lastDone]);
      expect(await observed).toBe("original");
      const read = db.transaction("a");
      const readDone = promisifyRequest(read);
      expect(await promisifyRequest(read.objectStore("a").get("value"))).toBe("final");
      await readDone;
      expect(tracked(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("releases an aborted transaction that never started", async () => {
    const db = await open();
    try {
      const first = db.transaction("a", "readwrite");
      first.objectStore("a").put("kept", "value");
      const firstDone = promisifyRequest(first);
      const waiting = db.transaction("a", "readwrite");
      const abortDone = new Promise<void>((resolve) =>
        waiting.addEventListener("abort", () => resolve()),
      );
      waiting.abort();
      await Promise.all([firstDone, abortDone]);
      expect(tracked(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it.each(["complete", "abort"])("preserves a pending writer after synthetic %s", async (type) => {
    const db = await open();
    try {
      const writer = db.transaction("a", "readwrite");
      writer.objectStore("a").put("must remain queued", "value");
      writer.dispatchEvent(new FakeEvent(type));
      const remainedQueued = tracked(db).includes(writer);
      const reader = db.transaction("a");
      const done = promisifyRequest(reader);
      const value = await promisifyRequest(reader.objectStore("a").get("value"));
      await done;
      expect(value).toBe("must remain queued");
      expect(remainedQueued).toBe(true);
      expect(tracked(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it.each(["complete", "abort"])(
    "preserves an active writer lock after synthetic %s",
    async (type) => {
      const db = await open();
      let keepWriting = true;
      try {
        const writer = db.transaction("a", "readwrite");
        const firstWrite = promisifyRequest(writer.objectStore("a").put("intermediate", "value"));
        const pump = () => {
          if (keepWriting) writer.objectStore("a").get("value").onsuccess = pump;
          else writer.objectStore("a").put("committed", "value");
        };
        pump();
        await firstWrite;
        writer.dispatchEvent(new FakeEvent(type));
        const remainedTracked = tracked(db).includes(writer);
        // Register after the synthetic event: only the actual completion settles this wait.
        const writerDone = promisifyRequest(writer);
        const reader = db.transaction("a");
        const readerDone = promisifyRequest(reader);
        const value = promisifyRequest(reader.objectStore("a").get("value"));
        const disjoint = db.transaction("b");
        disjoint.objectStore("b").get("value");
        await promisifyRequest(disjoint);
        keepWriting = false;
        await Promise.all([writerDone, readerDone]);
        expect(await value).toBe("committed");
        expect(remainedTracked).toBe(true);
        expect(tracked(db)).toHaveLength(0);
      } finally {
        keepWriting = false;
        db.close();
      }
    },
  );

  it("retains active locks and lets readonly and disjoint transactions progress", async () => {
    const db = await open();
    let keepReading = true;
    try {
      const reader = db.transaction("a");
      const readerDone = promisifyRequest(reader);
      const pump = () => {
        if (keepReading) reader.objectStore("a").get("value").onsuccess = pump;
      };
      pump();
      const parallel = db.transaction("a");
      parallel.objectStore("a").get("value");
      const parallelDone = promisifyRequest(parallel);
      const blocked = db.transaction("a", "readwrite");
      let writerStarted = false;
      blocked.objectStore("a").put("later", "value").onsuccess = () => {
        writerStarted = true;
      };
      const blockedDone = promisifyRequest(blocked);
      const disjoint = db.transaction("b", "readwrite");
      disjoint.objectStore("b").put("independent", "value");
      await Promise.all([parallelDone, promisifyRequest(disjoint)]);
      expect(writerStarted).toBe(false);
      expect(tracked(db)).toContain(reader);
      expect(tracked(db)).toContain(blocked);
      keepReading = false;
      await Promise.all([readerDone, blockedDone]);
      expect(writerStarted).toBe(true);
      expect(tracked(db)).toHaveLength(0);
    } finally {
      keepReading = false;
      db.close();
    }
  });

  it("cleans up an aborted upgrade before reopening and deleting the database", async () => {
    const factory = new Factory();
    const db = await open(factory);
    db.close();
    const upgrade = factory.open("scheduler", 2);
    upgrade.onupgradeneeded = () => {
      upgrade.result.createObjectStore("discarded");
      upgrade.transaction!.abort();
    };
    await expect(promisifyRequest(upgrade)).rejects.toMatchObject({ name: "AbortError" });
    const reopened = await promisifyRequest<IDBDatabase>(factory.open("scheduler", 1));
    expect(reopened.version).toBe(1);
    expect(Array.from(reopened.objectStoreNames)).toEqual(["a", "b"]);
    reopened.close();
    await promisifyRequest(factory.deleteDatabase("scheduler"));
    expect(await factory.databases()).toEqual([]);
  });
});
