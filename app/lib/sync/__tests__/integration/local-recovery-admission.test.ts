// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { get, clear, entries } from "idb-keyval";
import { USER, OTHER_USER, db, mutation, push } from "./push-route-harness";
import { action as admit } from "~/routes/api.sync.recovery";
import { action as resolve } from "~/routes/api.sync.recovery.$receiptId.resolve";
import { processDeliveries } from "~/lib/database/sync-delivery/worker";
import {
  prepareLocalRecoveryAdmission,
  submitLocalRecoveryAdmission,
} from "../../local-recovery-admission";
import { prepareRecoveryResolution, submitRecoveryResolution } from "../../recovery-mutations";
import { localRecoveryDetail } from "../../custody-export";
import { retainCustody, factsKey, type CustodyItem } from "../../custody-journal";
import { setCustodyAccount } from "../../custody-session";
import { getCustodyStore, getBookRemapStore } from "../../stores";

beforeEach(async () => {
  setCustodyAccount(undefined);
  await Promise.all([getCustodyStore(), getBookRemapStore()].map((store) => clear(store)));
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const request = new Request(`https://test${url}`, init);
    return url.endsWith("/resolve")
      ? resolve({ request, params: { receiptId: url.split("/").at(-2) } })
      : admit({ request });
  });
});
afterEach(() => vi.unstubAllGlobals());
async function source(clock: number | undefined) {
  return retainCustody({
    source: "ebook-reader-notebooks/notebooks",
    key: "entity",
    role: "intended",
    raw: {
      bookId: "entity",
      content: "only local original",
      ...(clock === undefined ? {} : { updatedAt: clock }),
    },
  });
}
it.each(["valid", "invalid", "missing"] as const)(
  "admits %s-clock local text without applying it, then performs an explicit new user edit",
  async (kind) => {
    await push([mutation("book"), mutation("notebook")]);
    const id = await source(
      kind === "valid" ? Date.now() - 5000 : kind === "invalid" ? NaN : undefined,
    );
    const original = (await localRecoveryDetail(id)).item;
    setCustodyAccount(USER);
    const { version } = await localRecoveryDetail(id, USER);
    const submissionId = await prepareLocalRecoveryAdmission({
      ownerId: USER,
      id,
      expectedVersion: version,
    });
    expect(await get(factsKey(id), getCustodyStore())).not.toHaveProperty("ownerId", USER);
    const detail = await submitLocalRecoveryAdmission({ ownerId: USER, submissionId });
    expect(detail.state).toBe("needs_resolution");
    await processDeliveries(USER);
    expect(
      (await db.query<{ content: unknown }>("SELECT content FROM readmax.notebook")).rows,
    ).toEqual([{ content: (mutation("notebook").data as { content: unknown }).content }]);
    if (kind === "valid")
      expect(detail.originalSnapshot.timestamp).toBe(
        (original.raw as { updatedAt: number }).updatedAt,
      );
    if (kind === "invalid")
      expect(detail.originalSnapshot.recoveryProjection).toMatchObject({ requiresNewEdit: true });
    if (kind === "missing") expect(detail.originalSnapshot).not.toHaveProperty("timestamp");
    const editId = await prepareRecoveryResolution({
      ownerId: USER,
      detail,
      action: "submit_edit",
      data: { content: "explicit recovered content" },
    });
    expect((await submitRecoveryResolution({ ownerId: USER, submissionId: editId })).state).toBe(
      "resolved",
    );
    expect(
      (await db.query<{ content: unknown }>("SELECT content FROM readmax.notebook")).rows,
    ).toEqual([{ content: "explicit recovered content" }]);
    const retained = await get<CustodyItem>(id, getCustodyStore());
    expect(retained).toEqual(original);
    expect(await get(factsKey(id), getCustodyStore())).not.toHaveProperty("retired", true);
  },
);
it("reuses admission identity after lost response and retains unreceived raw on rejection", async () => {
  await push([mutation("book"), mutation("notebook")]);
  const id = await source(NaN);
  setCustodyAccount(USER);
  const { version } = await localRecoveryDetail(id, USER);
  const submissionId = await prepareLocalRecoveryAdmission({
    ownerId: USER,
    id,
    expectedVersion: version,
  });
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    await realFetch(...args);
    throw new Error("lost");
  });
  await expect(submitLocalRecoveryAdmission({ ownerId: USER, submissionId })).rejects.toThrow(
    "lost",
  );
  vi.stubGlobal("fetch", realFetch);
  await submitLocalRecoveryAdmission({ ownerId: USER, submissionId });
  expect((await db.query("SELECT * FROM readmax.sync_recovery_admission")).rows).toHaveLength(1);
  expect(await get(id, getCustodyStore())).toBeDefined();
  setCustodyAccount(OTHER_USER);
  await expect(
    submitLocalRecoveryAdmission({ ownerId: OTHER_USER, submissionId }),
  ).rejects.toThrow();
});
it("does not bind a signed-out original when authoritative ownership rejects admission", async () => {
  await db.query('INSERT INTO readmax."user"(id) VALUES($1) ON CONFLICT DO NOTHING', [OTHER_USER]);
  await db.query("INSERT INTO readmax.book(id,user_id,title) VALUES('entity',$1,'foreign')", [
    OTHER_USER,
  ]);
  const id = await source(NaN);
  setCustodyAccount(USER);
  const { version } = await localRecoveryDetail(id, USER);
  const submissionId = await prepareLocalRecoveryAdmission({
    ownerId: USER,
    id,
    expectedVersion: version,
  });
  await expect(submitLocalRecoveryAdmission({ ownerId: USER, submissionId })).rejects.toThrow();
  expect(await get(factsKey(id), getCustodyStore())).not.toHaveProperty("ownerId", USER);
  expect(await get(id, getCustodyStore())).toBeDefined();
  expect(
    (await entries(getCustodyStore())).filter(
      ([key]) => Array.isArray(key) && key[0] === "admission-result",
    ),
  ).toEqual([]);
});

it.each([false, true])(
  "preserves unchanged retry semantics and refuses projected invalid-clock retry (%s)",
  async (invalid) => {
    await push([mutation("book"), mutation("notebook")]);
    const clock = invalid ? NaN : Date.now();
    const id = await source(clock);
    setCustodyAccount(USER);
    const sourceDetail = await localRecoveryDetail(id, USER);
    const submissionId = await prepareLocalRecoveryAdmission({
      ownerId: USER,
      id,
      expectedVersion: sourceDetail.version,
    });
    const detail = await submitLocalRecoveryAdmission({ ownerId: USER, submissionId });
    const retry = await prepareRecoveryResolution({ ownerId: USER, detail, action: "retry" });
    if (invalid) {
      await expect(
        submitRecoveryResolution({ ownerId: USER, submissionId: retry }),
      ).rejects.toThrow("review again");
      expect(
        (await db.query<{ content: unknown }>("SELECT content FROM readmax.notebook")).rows[0]
          .content,
      ).toEqual((mutation("notebook").data as { content: unknown }).content);
    } else {
      expect((await submitRecoveryResolution({ ownerId: USER, submissionId: retry })).state).toBe(
        "applied",
      );
      expect(
        (await db.query<{ content: unknown }>("SELECT content FROM readmax.notebook")).rows[0]
          .content,
      ).toBe("only local original");
      expect(detail.originalSnapshot.timestamp).toBe(clock);
    }
    expect((await get<CustodyItem>(id, getCustodyStore()))?.raw).toEqual(sourceDetail.item.raw);
  },
);

it("rejects a response for different received JSON without binding or retiring the local original", async () => {
  await push([mutation("book"), mutation("notebook")]);
  const id = await source(NaN);
  setCustodyAccount(USER);
  const { version } = await localRecoveryDetail(id, USER);
  const submissionId = await prepareLocalRecoveryAdmission({
    ownerId: USER,
    id,
    expectedVersion: version,
  });
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const detail = await (await realFetch(...args)).json();
    detail.originalSnapshot.data.content = "different source";
    return Response.json(detail);
  });
  await expect(submitLocalRecoveryAdmission({ ownerId: USER, submissionId })).rejects.toThrow(
    "Invalid local recovery response",
  );
  expect(await get(factsKey(id), getCustodyStore())).not.toHaveProperty("ownerId", USER);
  expect(await get(id, getCustodyStore())).toBeDefined();
});

it.each([false, true])(
  "creates a reviewed missing notebook and rejects concurrent creation (%s)",
  async (competingCreation) => {
    await push([mutation("book")]);
    const id = await source(NaN);
    setCustodyAccount(USER);
    const original = await localRecoveryDetail(id, USER);
    const submissionId = await prepareLocalRecoveryAdmission({
      ownerId: USER,
      id,
      expectedVersion: original.version,
    });
    const detail = await submitLocalRecoveryAdmission({ ownerId: USER, submissionId });
    expect(detail.canonical.status).toBe("missing");
    expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
    const edit = await prepareRecoveryResolution({
      ownerId: USER,
      detail,
      action: "submit_edit",
      data: detail.originalSnapshot.data as Record<string, unknown>,
    });
    const prepared = (await localRecoveryDetail(edit, USER)).item.raw as {
      request: {
        newMutation: {
          id: string;
          entityId: string;
          timestamp: number;
          data: { bookId: string; updatedAt: number };
        };
      };
    };
    expect(prepared.request.newMutation.id).not.toBe(detail.originalSnapshot.id);
    expect(prepared.request.newMutation.entityId).toBe(detail.canonical.entityId);
    expect(prepared.request.newMutation.data.bookId).toBe(detail.canonical.entityId);
    expect(Number.isSafeInteger(prepared.request.newMutation.timestamp)).toBe(true);
    expect(prepared.request.newMutation.data.updatedAt).toBe(
      prepared.request.newMutation.timestamp,
    );
    if (competingCreation) await push([mutation("notebook")]);
    if (competingCreation) {
      await expect(submitRecoveryResolution({ ownerId: USER, submissionId: edit })).rejects.toThrow(
        "review again",
      );
      expect(
        (await db.query<{ content: unknown }>("SELECT content FROM readmax.notebook")).rows,
      ).toEqual([{ content: (mutation("notebook").data as { content: unknown }).content }]);
    } else {
      expect((await submitRecoveryResolution({ ownerId: USER, submissionId: edit })).state).toBe(
        "resolved",
      );
      expect((await db.query("SELECT content FROM readmax.notebook")).rows).toEqual([
        { content: "only local original" },
      ]);
    }
    expect((await get<CustodyItem>(id, getCustodyStore()))?.raw).toEqual(original.item.raw);
    expect(await get(factsKey(id), getCustodyStore())).not.toHaveProperty("retired", true);
  },
);

it("rejects creating a reviewed missing notebook after its parent is deleted", async () => {
  await push([mutation("book")]);
  const id = await source(NaN);
  setCustodyAccount(USER);
  const original = await localRecoveryDetail(id, USER);
  const submissionId = await prepareLocalRecoveryAdmission({
    ownerId: USER,
    id,
    expectedVersion: original.version,
  });
  const detail = await submitLocalRecoveryAdmission({ ownerId: USER, submissionId });
  const edit = await prepareRecoveryResolution({
    ownerId: USER,
    detail,
    action: "submit_edit",
    data: detail.originalSnapshot.data as Record<string, unknown>,
  });
  await push([{ ...mutation("book", 1), operation: "delete" }]);
  await expect(submitRecoveryResolution({ ownerId: USER, submissionId: edit })).rejects.toThrow();
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
  expect((await get<CustodyItem>(id, getCustodyStore()))?.raw).toEqual(original.item.raw);
});

it("keeps missing creation restricted to notebooks and rejects deleted or unavailable notebook targets", async () => {
  await push([mutation("book")]);
  const id = await source(NaN);
  setCustodyAccount(USER);
  const { version } = await localRecoveryDetail(id, USER);
  const submissionId = await prepareLocalRecoveryAdmission({
    ownerId: USER,
    id,
    expectedVersion: version,
  });
  const detail = await submitLocalRecoveryAdmission({ ownerId: USER, submissionId });
  for (const entity of ["book", "position", "highlight", "bookmark", "chat_session", "settings"]) {
    await expect(
      prepareRecoveryResolution({
        ownerId: USER,
        detail: { ...detail, canonical: { ...detail.canonical, entity } },
        action: "submit_edit",
        data: { content: "retained" },
      }),
    ).rejects.toThrow("current editable canonical target");
  }
  for (const status of ["deleted", "unavailable"] as const) {
    await expect(
      prepareRecoveryResolution({
        ownerId: USER,
        detail: { ...detail, canonical: { ...detail.canonical, status } },
        action: "submit_edit",
        data: { content: "retained" },
      }),
    ).rejects.toThrow("current editable canonical target");
  }
  expect((await db.query("SELECT * FROM readmax.notebook")).rows).toEqual([]);
  expect(await get(id, getCustodyStore())).toBeDefined();
});
