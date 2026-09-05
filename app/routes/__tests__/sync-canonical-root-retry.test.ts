// @vitest-environment node
import { expect, it, vi } from "vitest";
import type { ChangeEntry, SyncPushResponse } from "~/lib/sync/types";
import { BASE, USER, db, push } from "~/lib/sync/__tests__/integration/push-route-harness";

function book(id: string, version: number): ChangeEntry {
  return {
    id: `root-${id}-${version}`,
    entity: "book",
    entityId: id,
    operation: "put",
    data: {
      id,
      title: `${id}-${version}`,
      fileHash: "same-file",
      remoteFileUrl: `https://test/${id}-${version}.epub`,
    },
    timestamp: BASE + version * 1000,
    synced: false,
  };
}

async function canonicalRow() {
  return (
    await db.query("SELECT * FROM readmax.book WHERE user_id = $1 AND id = 'canonical'", [USER])
  ).rows[0];
}

it.each([true, false])(
  "preserves canonical metadata and tombstones after lost alias root ACKs and handler reloads (capable=%s)",
  async (capable) => {
    await push([book("canonical", 0)], capable);
    const original = book("loser", 10);
    // The alias commits, but the client never receives/acknowledges this response.
    await push([original], capable);
    const retries: ChangeEntry[] = [
      original,
      { ...book("loser", 11), operation: "delete", data: null },
      { ...book("loser", 12), data: { ...(original.data as object), deletedAt: BASE + 12000 } },
    ];

    await push([book("canonical", 2)], capable);
    const edited = await canonicalRow();
    expect(edited).toMatchObject({
      title: "canonical-2",
      file_blob_url: "https://test/canonical-2.epub",
      deleted_at: null,
    });

    for (const deleted of [false, true]) {
      if (deleted) await push([{ ...book("canonical", 3), operation: "delete" }], capable);
      const before = await canonicalRow();
      if (deleted) expect(before).toMatchObject({ deleted_at: new Date(BASE + 3000) });
      for (let recovery = 0; recovery < 3; recovery++) {
        vi.resetModules();
        const { action } = await import("~/routes/api.sync.push");
        const response = await action({
          request: new Request("https://test/api/sync/push", {
            method: "POST",
            body: JSON.stringify({ changes: retries, supportsRetryableRejections: capable }),
          }),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as SyncPushResponse;
        expect(body.rejected).toEqual([]);
        expect(body.accepted).toEqual(
          retries.map((entry) => ({ id: entry.id, canonicalId: "canonical" })),
        );
        expect(await canonicalRow()).toEqual(before);
      }
    }

    // Real edits addressed to the canonical root retain their ordinary LWW policy.
    await push([book("canonical", 4)], capable);
    expect(await canonicalRow()).toMatchObject({
      title: "canonical-4",
      deleted_at: null,
      mutation_at: new Date(BASE + 4000),
    });
  },
);
