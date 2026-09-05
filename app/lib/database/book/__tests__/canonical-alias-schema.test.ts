// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("keeps fresh setup and additive alias migration equivalent without inferring or losing data", async () => {
  const core = await readFile("database/readmax/core.sql", "utf8");
  const migration = await readFile("database/migrations/022-book-canonical-alias.sql", "utf8");
  const fresh = new PGlite();
  const legacy = new PGlite();
  try {
    await fresh.exec(core);
    await legacy.exec(core.replace(/^.*canonical_id TEXT.*\n/m, ""));
    await legacy.exec(`
      INSERT INTO readmax.user (id) VALUES ('00000000-0000-4000-8000-000000000001');
      INSERT INTO readmax.book (id, user_id, file_hash, deleted_at, mutation_at)
      VALUES ('live', '00000000-0000-4000-8000-000000000001', 'hash', NULL, '2026-01-01'),
        ('ordinary-deletion', '00000000-0000-4000-8000-000000000001', 'hash', '2026-01-01', '2026-01-01');
    `);
    const before = (
      await legacy.query<Record<string, unknown>>("SELECT * FROM readmax.book ORDER BY id")
    ).rows;
    await legacy.exec(migration);
    expect(
      (await legacy.query<Record<string, unknown>>("SELECT * FROM readmax.book ORDER BY id")).rows,
    ).toEqual(before.map((row) => ({ ...row, canonical_id: null })));
    const columns =
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'readmax' AND table_name = 'book' ORDER BY column_name";
    expect((await legacy.query(columns)).rows).toEqual((await fresh.query(columns)).rows);
    await legacy.exec(
      "UPDATE readmax.book SET canonical_id = 'live' WHERE id = 'ordinary-deletion'",
    );
    const withAlias = (
      await legacy.query<Record<string, unknown>>("SELECT * FROM readmax.book ORDER BY id")
    ).rows;
    await legacy.exec(migration);
    expect(
      (await legacy.query<Record<string, unknown>>("SELECT * FROM readmax.book ORDER BY id")).rows,
    ).toEqual(withAlias);
  } finally {
    await fresh.close();
    await legacy.close();
  }
}, 30_000);
