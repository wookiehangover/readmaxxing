// @vitest-environment node
import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import type { ChangeEntry, EntityType } from "~/lib/sync/types";
import {
  BASE,
  USER,
  OTHER_USER,
  db,
  mocks,
  push,
  pull,
} from "~/lib/sync/__tests__/integration/push-route-harness";

beforeAll(async () => {
  await db.exec(await readFile("database/migrations/004-book-file-hash-unique.sql", "utf8"));
});

function change(entity: EntityType, bookId: string, version = 0): ChangeEntry {
  const entityId =
    entity === "bookmark"
      ? `bookmark:${bookId}:page:7`
      : entity === "highlight" || entity === "chat_session"
        ? `${entity}-${bookId}`
        : bookId;
  return {
    id: `${entity}-${bookId}-${version}`,
    entity,
    entityId,
    operation: "put",
    synced: false,
    timestamp: BASE + version * 1000,
    data: {
      id: entityId,
      bookId,
      fileHash: "same-file",
      title: "Book",
      text: "Highlight",
      createdAt: BASE,
      cfi: "page:7",
      content: { text: `notes-${version}` },
      label: "Bookmark",
    },
  };
}
const dependents = ["notebook", "position", "highlight", "bookmark", "chat_session"] as const;
async function rows(table: string) {
  return (
    await db.query<Record<string, unknown>>(`SELECT * FROM readmax.${table} WHERE user_id = $1`, [
      USER,
    ])
  ).rows;
}
async function expectCanonicalDependents() {
  for (const entity of dependents) {
    const records = await rows(entity === "position" ? "reading_position" : entity);
    expect(records).toHaveLength(1);
    expect(records[0].book_id).toBe("canonical");
    if (entity === "bookmark") expect(records[0].id).toBe("bookmark:canonical:page:7");
  }
}

it("sorts a dependent-first request and stores every dependent under the accepted canonical ID", async () => {
  await push([change("book", "canonical")]);
  const changes = [...dependents.map((entity) => change(entity, "loser")), change("book", "loser")];
  const result = await push(changes, true);
  expect(result.body.rejected).toEqual([]);
  expect(result.body.accepted).toContainEqual({ id: "book-loser-0", canonicalId: "canonical" });
  expect(result.body.accepted.map((entry) => entry.id).sort()).toEqual(
    changes.map((entry) => entry.id).sort(),
  );
  await expectCanonicalDependents();
});

it("resolves later stale-client requests and duplicate retries after a lost response", async () => {
  await push([change("book", "canonical"), change("book", "loser")]);
  const changes = dependents.map((entity) => change(entity, "loser"));
  for (let retry = 0; retry < 2; retry++) {
    expect((await push(changes, true)).body.rejected).toEqual([]);
    await expectCanonicalDependents();
  }
});

it("relocates already stored dependents and exposes them to fresh pulls", async () => {
  await push([change("book", "canonical")]);
  await push(dependents.map((entity) => change(entity, "loser")));
  expect((await push([change("book", "loser")], true)).body.rejected).toEqual([]);
  await expectCanonicalDependents();
  for (const entity of dependents) {
    const result = await pull(entity);
    expect(result.changes[0].records).toEqual([expect.objectContaining({ bookId: "canonical" })]);
  }
});

it("publishes explicit aliases while ordinary deletions stay distinguishable", async () => {
  await push([change("book", "canonical"), change("book", "loser")]);
  await push([{ ...change("book", "deleted"), operation: "delete" }]);
  const books = (await pull("book")).changes[0].records;
  expect(books).toContainEqual(expect.objectContaining({ id: "loser", canonicalId: "canonical" }));
  expect(books).toContainEqual(expect.objectContaining({ id: "deleted", canonicalId: null }));
  await push([change("book", "deleted"), change("notebook", "deleted")]);
  expect(await rows("book")).toContainEqual(
    expect.objectContaining({ id: "deleted", canonical_id: null, deleted_at: new Date(BASE) }),
  );
  expect(await rows("notebook")).toContainEqual(expect.objectContaining({ book_id: "deleted" }));
});

it("preserves newer target notebooks and bookmarks, including their source clocks", async () => {
  await push([
    change("book", "canonical"),
    change("notebook", "canonical", 2),
    change("bookmark", "canonical", 2),
  ]);
  await push([change("notebook", "loser"), change("bookmark", "loser")]);
  const target = (await rows("bookmark"))[0];
  await push([change("book", "loser")]);
  expect(await rows("notebook")).toEqual([
    expect.objectContaining({
      book_id: "canonical",
      content: { text: "notes-2" },
      mutation_at: new Date(BASE + 2000),
    }),
  ]);
  expect(await rows("bookmark")).toEqual([
    expect.objectContaining({ ...target, updated_at: expect.any(Date) }),
  ]);
});

it.each(["source", "target"])(
  "keeps %s bookmark tombstones even against newer live records",
  async (side) => {
    await push([change("book", "canonical")]);
    const source = change("bookmark", "loser", side === "source" ? 0 : 2);
    const target = change("bookmark", "canonical", side === "target" ? 0 : 2);
    await push([
      { ...source, operation: side === "source" ? "delete" : "put" },
      { ...target, operation: side === "target" ? "delete" : "put" },
    ]);
    await push([change("book", "loser")]);
    expect(await rows("bookmark")).toEqual([
      expect.objectContaining({ id: "bookmark:canonical:page:7", deleted_at: new Date(BASE) }),
    ]);
    await push([source, target]);
    expect((await rows("bookmark"))[0].deleted_at).toEqual(new Date(BASE));
  },
);

it("preserves tombstones and active-stream metadata when moving globally keyed records", async () => {
  await push([change("book", "canonical")]);
  await push(
    ["highlight", "chat_session"].map((entity) => ({
      ...change(entity as EntityType, "loser"),
      operation: "delete" as const,
    })),
  );
  await db.query("UPDATE readmax.chat_session SET active_stream_id = 'stream' WHERE user_id = $1", [
    USER,
  ]);
  await push([change("book", "loser")]);
  for (const entity of ["highlight", "chat_session"]) {
    expect(await rows(entity)).toEqual([
      expect.objectContaining({
        book_id: "canonical",
        mutation_at: new Date(BASE),
        deleted_at: new Date(BASE),
      }),
    ]);
  }
  expect((await rows("chat_session"))[0].active_stream_id).toBe("stream");
});

it("keeps furthest-position semantics and the maximum existing source clock during relocation", async () => {
  await push([
    change("book", "canonical"),
    { ...change("position", "canonical", 2), data: { bookId: "canonical", cfi: "page:12" } },
  ]);
  await push([{ ...change("position", "loser"), data: { bookId: "loser", cfi: "page:20" } }]);
  await push([change("book", "loser")]);
  expect(await rows("reading_position")).toEqual([
    expect.objectContaining({
      book_id: "canonical",
      cfi: "page:20",
      mutation_at: new Date(BASE + 2000),
    }),
  ]);
});

it("retains an ambiguous equal-clock position conflict and rolls back the alias and earlier moves", async () => {
  await push([
    change("book", "canonical"),
    { ...change("position", "canonical"), data: { bookId: "canonical", cfi: "uncomparable-a" } },
  ]);
  await push([
    change("notebook", "loser"),
    { ...change("position", "loser"), data: { bookId: "loser", cfi: "uncomparable-b" } },
  ]);
  const notebooks = await rows("notebook");
  const positions = await rows("reading_position");
  const result = await push([change("book", "loser")], true);
  expect(result.body.accepted).toEqual([]);
  expect(result.body.rejected).toEqual([
    expect.objectContaining({ id: "book-loser-0", retryable: true }),
  ]);
  expect(await rows("notebook")).toEqual(notebooks);
  expect(await rows("reading_position")).toEqual(positions);
  expect((await rows("book")).map((book) => book.id)).toEqual(["canonical"]);
});

it("makes all relocated winners visible beyond already advanced exact pull cursors", async () => {
  await push([change("book", "canonical"), ...dependents.map((entity) => change(entity, "loser"))]);
  const cursors = await Promise.all(
    dependents.map(async (entity) => (await pull(entity)).changes[0].cursor),
  );
  await push([change("book", "loser")]);
  for (let i = 0; i < dependents.length; i++) {
    const result = await pull(dependents[i], cursors[i]);
    expect(result.changes[0].records).toEqual([
      expect.objectContaining({ bookId: "canonical", updatedAt: new Date(BASE).toISOString() }),
    ]);
  }
});

it("handles multiple losers, stable duplicate acknowledgments and colliding bookmark keys", async () => {
  await push([change("book", "canonical")]);
  for (const loser of ["loser-a", "loser-b"]) {
    await push([change("notebook", loser), change("bookmark", loser)]);
    const first = await push([change("book", loser)], true);
    const second = await push([change("book", loser)], true);
    expect(first.body.accepted).toEqual([{ id: `book-${loser}-0`, canonicalId: "canonical" }]);
    expect(second.body.accepted).toEqual(first.body.accepted);
  }
  expect(await rows("notebook")).toHaveLength(1);
  expect(await rows("bookmark")).toHaveLength(1);
  expect((await rows("book")).filter((book) => book.canonical_id === "canonical")).toHaveLength(2);
});

it("follows and compresses authoritative alias chains and moves all intermediate dependents", async () => {
  await push([
    change("book", "canonical"),
    change("notebook", "loser-a"),
    change("bookmark", "loser-b"),
  ]);
  await db.query(
    "INSERT INTO readmax.book (id, user_id, canonical_id, deleted_at) VALUES ('loser-a', $1, 'loser-b', NOW()), ('loser-b', $1, 'canonical', NOW())",
    [USER],
  );
  const result = await push([change("book", "loser-a"), change("position", "loser-a")], true);
  expect(result.body.rejected).toEqual([]);
  expect(result.body.accepted).toContainEqual({ id: "book-loser-a-0", canonicalId: "canonical" });
  for (const table of ["notebook", "bookmark", "reading_position"])
    expect((await rows(table))[0].book_id).toBe("canonical");
  expect(
    (await rows("book"))
      .filter((book) => typeof book.id === "string" && book.id.startsWith("loser"))
      .every((book) => book.canonical_id === "canonical"),
  ).toBe(true);
});

it.each(["cycle", "missing", "other-owner"])(
  "rejects an invalid %s alias without acknowledging or altering dependent data",
  async (kind) => {
    await push([change("notebook", "loser")]);
    await db.query(
      "INSERT INTO readmax.book (id, user_id, canonical_id, deleted_at) VALUES ('loser', $1, 'target', NOW())",
      [USER],
    );
    if (kind !== "missing")
      await db.query(
        "INSERT INTO readmax.book (id, user_id, canonical_id, deleted_at) VALUES ('target', $1, $2, NOW())",
        [kind === "other-owner" ? OTHER_USER : USER, kind === "cycle" ? "loser" : null],
      );
    const before = await rows("notebook");
    const result = await push([change("notebook", "loser", 2)], true);
    expect(result.body.accepted).toEqual([]);
    expect(result.body.rejected[0].retryable).toBe(true);
    expect(await rows("notebook")).toEqual(before);
  },
);

it("does not deduplicate an ID or write a dependent owned by another authenticated user", async () => {
  await push([change("book", "canonical")]);
  await db.query("INSERT INTO readmax.book (id, user_id) VALUES ('loser', $1)", [OTHER_USER]);
  const before = (await db.query("SELECT * FROM readmax.book ORDER BY id")).rows;
  const result = await push([change("book", "loser"), change("notebook", "loser")], true);
  expect(result.body.accepted).toEqual([]);
  expect(result.body.rejected).toHaveLength(2);
  expect((await db.query("SELECT * FROM readmax.book ORDER BY id")).rows).toEqual(before);
  expect(await rows("notebook")).toEqual([]);
});

it("relocates only the authenticated user's dependents", async () => {
  await push([change("book", "canonical"), change("notebook", "loser")]);
  await db.query(
    "INSERT INTO readmax.notebook (user_id, book_id, content) VALUES ($1, 'loser', '{}'::jsonb)",
    [OTHER_USER],
  );
  const before = (await db.query("SELECT * FROM readmax.notebook WHERE user_id = $1", [OTHER_USER]))
    .rows;
  await push([change("book", "loser")]);
  expect((await rows("notebook"))[0].book_id).toBe("canonical");
  expect(
    (await db.query("SELECT * FROM readmax.notebook WHERE user_id = $1", [OTHER_USER])).rows,
  ).toEqual(before);
});

it("does not resurrect a deleted canonical or remap its stale aliases to a same-hash replacement", async () => {
  await push([change("book", "canonical"), change("book", "loser")]);
  await push([
    { ...change("book", "canonical", 1), operation: "delete" },
    change("book", "replacement", 2),
  ]);
  const books = await rows("book");
  const result = await push([change("book", "loser", 3), change("notebook", "loser", 3)], true);
  expect(result.body.accepted).toContainEqual({ id: "book-loser-3", canonicalId: "canonical" });
  expect(await rows("book")).toEqual(books);
  expect((await rows("notebook"))[0].book_id).toBe("canonical");
});

it("treats alias-book deletes as alias acknowledgments rather than deleting the canonical", async () => {
  await push([change("book", "canonical"), change("book", "loser")]);
  const books = await rows("book");
  const result = await push(
    [{ ...change("book", "loser", 3), operation: "delete", data: null }],
    true,
  );
  expect(result.body.accepted).toEqual([{ id: "book-loser-3", canonicalId: "canonical" }]);
  expect(await rows("book")).toEqual(books);
});

it.each([false, true])(
  "canonicalizes deterministic bookmark deletion keys with snapshot=%s",
  async (snapshot) => {
    await push([change("book", "canonical"), change("book", "loser"), change("bookmark", "loser")]);
    const deletion = change("bookmark", "loser", 1);
    const result = await push(
      [{ ...deletion, operation: "delete", data: snapshot ? deletion.data : null }],
      true,
    );
    expect(result.body.accepted).toEqual([{ id: deletion.id }]);
    expect(await rows("bookmark")).toEqual([
      expect.objectContaining({
        id: "bookmark:canonical:page:7",
        book_id: "canonical",
        deleted_at: new Date(BASE + 1000),
      }),
    ]);
  },
);

it("normalizes independently remapped bookmark keys and embedded references while retaining random IDs", async () => {
  await push([change("book", "canonical"), change("book", "loser")]);
  const input = change("bookmark", "loser");
  expect(
    (await push([{ ...input, data: { ...(input.data as object), bookId: "canonical" } }], true))
      .body.rejected,
  ).toEqual([]);
  expect(
    (await push([{ ...input, entityId: "bookmark:canonical:page:7" }], true)).body.rejected,
  ).toEqual([]);
  expect((await push([{ ...input, entityId: "random-bookmark" }], true)).body.rejected).toEqual([]);
  expect((await rows("bookmark")).map((row) => row.id).sort()).toEqual([
    "bookmark:canonical:page:7",
    "random-bookmark",
  ]);
  expect((await rows("bookmark")).every((row) => row.book_id === "canonical")).toBe(true);
});

it("keeps equal-clock highlight and chat conflicts retryable after identity normalization", async () => {
  await push([
    change("book", "canonical"),
    change("book", "loser"),
    change("highlight", "loser"),
    change("chat_session", "loser"),
  ]);
  for (const entity of ["highlight", "chat_session"] as const) {
    const before = await rows(entity);
    const entry = change(entity, "loser");
    const result = await push(
      [{ ...entry, data: { ...(entry.data as object), text: "different", title: "different" } }],
      true,
    );
    expect(result.body.accepted).toEqual([]);
    expect(result.body.rejected[0].retryable).toBe(true);
    expect(await rows(entity)).toEqual(before);
  }
});

it("rolls back a failed remap and retains dependent-before-book changes for retry", async () => {
  await push([change("book", "canonical"), change("notebook", "loser")]);
  const before = await rows("notebook");
  const execute = mocks.query.getMockImplementation()!;
  let fail = true;
  mocks.query.mockImplementation((query) => {
    if (fail && typeof query !== "string" && query.text.includes("UPDATE readmax.highlight")) {
      fail = false;
      throw new Error("temporary remap outage");
    }
    return execute(query);
  });
  const changes = [change("notebook", "loser", 2), change("book", "loser")];
  const failed = await push(changes, true);
  expect(failed.body.accepted).toEqual([]);
  expect(failed.body.rejected.map((entry) => entry.id).sort()).toEqual(
    changes.map((entry) => entry.id).sort(),
  );
  expect(failed.body.rejected.every((entry) => entry.retryable)).toBe(true);
  expect(await rows("notebook")).toEqual(before);
  expect((await rows("book")).map((book) => book.id)).toEqual(["canonical"]);
  expect((await push(changes, true)).body.rejected).toEqual([]);
  expect(await rows("notebook")).toEqual([
    expect.objectContaining({ book_id: "canonical", content: { text: "notes-2" } }),
  ]);
});

it("does not infer an alias from an obsolete hash in a stale book snapshot", async () => {
  await push([
    change("book", "canonical"),
    { ...change("book", "different-book", 2), data: { fileHash: "different-file" } },
    change("notebook", "different-book"),
  ]);
  const books = await rows("book");
  await push([change("book", "different-book")]);
  expect(await rows("book")).toEqual(books);
  expect((await rows("notebook"))[0].book_id).toBe("different-book");
});

it("does not discard a losing bookmark when its canonical key belongs to another user", async () => {
  await push([change("book", "canonical"), change("bookmark", "loser")]);
  await db.query(
    "INSERT INTO readmax.bookmark (id, user_id, book_id) VALUES ('bookmark:canonical:page:7', $1, 'other-book')",
    [OTHER_USER],
  );
  const before = (await db.query("SELECT * FROM readmax.bookmark ORDER BY id")).rows;
  const result = await push([change("book", "loser")], true);
  expect(result.body.accepted).toEqual([]);
  expect((await db.query("SELECT * FROM readmax.bookmark ORDER BY id")).rows).toEqual(before);
  expect((await rows("book")).map((book) => book.id)).toEqual(["canonical"]);
});

it("upserts new and canonical books normally and keeps blob URLs in the same guarded write", async () => {
  const book = change("book", "canonical");
  expect((await push([book], true)).body.accepted).toEqual([{ id: book.id }]);
  const newer = {
    ...change("book", "canonical", 1),
    data: { fileHash: "same-file", title: "New", remoteFileUrl: "https://test/book.epub" },
  };
  expect((await push([newer], true)).body.accepted).toEqual([{ id: newer.id }]);
  const before = await rows("book");
  expect(before[0]).toMatchObject({
    canonical_id: null,
    title: "New",
    file_blob_url: "https://test/book.epub",
  });
  await push([book]);
  expect(await rows("book")).toEqual(before);
  const noHash = { ...change("book", "no-hash"), data: { title: "No hash" } };
  expect((await push([noHash], true)).body.accepted).toEqual([{ id: noHash.id }]);
});

it("allows a fresh same-hash upload when existing matching books are ordinary tombstones", async () => {
  await push([{ ...change("book", "deleted"), operation: "delete" }]);
  const book = change("book", "reupload");
  expect((await push([book], true)).body.accepted).toEqual([{ id: book.id }]);
  expect(await rows("book")).toContainEqual(
    expect.objectContaining({ id: "reupload", deleted_at: null, canonical_id: null }),
  );
});
