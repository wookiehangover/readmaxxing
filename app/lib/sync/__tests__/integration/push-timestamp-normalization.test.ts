// @vitest-environment node
import { it, expect, vi } from "vitest";
import { DEFAULT_UPDATED_AT_SKEW_MS } from "~/lib/database/clamp-timestamp";
import {
  BASE,
  DELETABLE,
  mutation,
  push,
  row,
  failNotebookOnce,
  failing,
} from "./push-route-harness";

const CREATION_CASES = ["highlight", "bookmark", "chat_session"] as const;

for (const kind of ["future", "invalid"] as const) {
  const metadataTime = kind === "future" ? BASE + 86_400_000 : "invalid-date";

  it.each(CREATION_CASES)(
    `exact %s replay with ${kind} creation time is stable after wall time advances`,
    async (entity) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(BASE + 60_000);
      const original = mutation(entity);
      original.data = { ...(original.data as object), createdAt: metadataTime };
      const first = await push([original]);
      expect(first.status).toBe(200);
      expect(first.body.accepted).toEqual([{ id: original.id }]);
      const saved = await row(entity);
      expect(saved.created_at).toEqual(
        new Date(kind === "future" ? BASE + DEFAULT_UPDATED_AT_SKEW_MS : BASE),
      );
      clock.mockReturnValue(BASE + 61_000);
      const replay = await push([original]);
      expect(replay.status).toBe(200);
      expect(replay.body.accepted).toEqual([{ id: original.id }]);
      expect(await row(entity)).toEqual(saved);
    },
  );

  it.each(DELETABLE)(
    `exact %s tombstone replay with ${kind} deletion time cannot advance the tombstone`,
    async (entity) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(BASE + 60_000);
      const original = mutation(entity);
      original.data = { ...(original.data as object), deletedAt: metadataTime };
      expect((await push([original])).status).toBe(200);
      const saved = await row(entity);
      expect(saved.deleted_at).toEqual(
        new Date(kind === "future" ? BASE + DEFAULT_UPDATED_AT_SKEW_MS : BASE),
      );
      clock.mockReturnValue(BASE + 61_000);
      const replay = await push([original]);
      expect(replay.status).toBe(200);
      expect(replay.body.accepted).toEqual([{ id: original.id }]);
      expect(await row(entity)).toEqual(saved);
    },
  );

  it(`legacy partial-success replay with ${kind} highlight creation time acknowledges the recovered batch`, async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(BASE);
    const original = mutation("highlight");
    original.data = { ...(original.data as object), createdAt: metadataTime };
    failNotebookOnce();
    const first = await push([original, failing]);
    expect(first.status).toBe(503);
    expect(first.body.accepted).toContainEqual({ id: original.id });
    const saved = await row("highlight");
    clock.mockReturnValue(BASE + 1000);
    const replay = await push([original, failing]);
    expect(replay.status).toBe(200);
    expect(replay.body.accepted).toEqual([{ id: original.id }, { id: failing.id }]);
    expect(await row("highlight")).toEqual(saved);

    const different = {
      ...original,
      id: "different-edit",
      data: { ...(original.data as object), note: "distinct content" },
    };
    const conflict = await push([different], true);
    expect(conflict.body.accepted).toEqual([]);
    expect(conflict.body.rejected).toMatchObject([{ id: different.id, retryable: true }]);
    expect((await push([different])).status).toBe(503);
    expect(await row("highlight")).toEqual(saved);
  });
}
