// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { clear, get, keys } from "idb-keyval";
import {
  USER,
  OTHER_USER,
  db,
  mutation,
  push,
} from "~/lib/sync/__tests__/integration/push-route-harness";
import * as idbStores from "~/lib/sync/stores";
import { retainCustody } from "~/lib/sync/custody-journal";
import { setCustodyAccount } from "~/lib/sync/custody-session";
import { getRecovery } from "~/lib/database/sync-delivery/recovery";
import { loader as list, action as admit } from "~/routes/api.sync.recovery";
import { loader as detail } from "~/routes/api.sync.recovery.$receiptId";
import { loader as exported } from "~/routes/api.sync.recovery.$receiptId.export";
import { action as resolve } from "~/routes/api.sync.recovery.$receiptId.resolve";
import { createAppStore, type AppStore } from "../store";
import { authSessionResolved, authSessionCleared } from "../auth-session/auth-session-slice";
import { createSyncRecoverySaga } from "./sagas/sync-recovery-saga";
import { refreshRecovery, selectRecovery, runRecoveryCommand } from "./sync-recovery-slice";

let store: AppStore;
let bodyByUrl: Map<string, Blob>;
let failResolve = false;
let loseResolveResponse = false;
let resolveCalls: string[];
async function fetchRoute(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input), "https://test");
  const request = new Request(url, init);
  const receiptId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
  const params = { receiptId };
  if (url.pathname.endsWith("/resolve")) {
    resolveCalls.push(String(init?.body));
    if (failResolve) throw new TypeError("offline");
    const response = await resolve({ request, params });
    if (loseResolveResponse) {
      loseResolveResponse = false;
      throw new TypeError("response lost");
    }
    return response;
  }
  if (url.pathname.endsWith("/export")) return exported({ request, params });
  if (receiptId) return detail({ request, params });
  return request.method === "POST" ? admit({ request }) : list({ request });
}
beforeEach(async () => {
  setCustodyAccount(undefined);
  await Promise.all(Object.values(idbStores).map((getStore) => clear(getStore())));
  failResolve = false;
  loseResolveResponse = false;
  resolveCalls = [];
  bodyByUrl = new Map();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("fetch", fetchRoute);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:test-${bodyByUrl.size}`;
    if (!(blob instanceof Blob)) throw new Error("Expected a Blob preview");
    bodyByUrl.set(url, blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    bodyByUrl.delete(url);
  });
  store = createAppStore();
  store.init();
});
afterEach(() => {
  store.dispose();
  setCustodyAccount(undefined);
});
function start(ownerId: string | null = USER) {
  setCustodyAccount(ownerId ?? undefined);
  store.dispatch(authSessionResolved(ownerId ? { id: ownerId, displayName: "Reader" } : null));
  store.runSaga(createSyncRecoverySaga(store));
  store.dispatch(refreshRecovery(true));
}
async function loaded() {
  await vi.waitFor(() => expect(store.state.syncRecovery.loading).toBe(false));
  expect(store.state.syncRecovery.error).toBeNull();
}
async function inspect(id: string) {
  store.dispatch(selectRecovery(id));
  await vi.waitFor(() => expect(store.state.syncRecovery.view).not.toBeNull());
  return store.state.syncRecovery.view!;
}
async function retainedNotebook() {
  await push([mutation("book"), mutation("notebook")]);
  const result = await push([
    { ...mutation("notebook", 2), id: "old-client-conflict", timestamp: Date.now() + 86_400_000 },
  ]);
  expect(result.body.rejected.some((entry) => entry.id === "old-client-conflict")).toBe(true);
  const receipt = (
    await db.query<{ receipt_id: string }>(
      "SELECT receipt_id FROM readmax.sync_delivery_receipt WHERE change_id='old-client-conflict'",
    )
  ).rows[0].receipt_id;
  // Historical client has already retired its queue. Discovery must use receipts.
  expect(await keys(idbStores.getChangeLogStore())).toEqual([]);
  return receipt;
}

it("discovers retired old-client work, shows both versions without raw Redux, and applies explicitly", async () => {
  const receipt = await retainedNotebook();
  start();
  await loaded();
  expect(store.state.syncRecovery.items.ids).toContain(`server:${receipt}`);
  const view = await inspect(`server:${receipt}`);
  const html = await bodyByUrl.get(view.url)!.text();
  expect(html).toContain("Original edit");
  expect(html).toContain("Current saved version");
  expect(html).toContain('"new"');
  expect(html).toContain('"old"');
  expect(JSON.stringify(store.state.syncRecovery)).not.toContain('"originalSnapshot"');
  expect(JSON.stringify(store.state.syncRecovery)).not.toContain('"content"');
  store.dispatch(runRecoveryCommand("submit_edit", view.token));
  await vi.waitFor(() => expect(store.state.syncRecovery.notice).toContain("Decision saved"));
  expect(
    (
      await db.query<{ content: unknown }>(
        "SELECT content FROM readmax.notebook WHERE user_id=$1",
        [USER],
      )
    ).rows[0].content,
  ).toMatchObject({ content: [{ text: "new" }] });
  expect((await getRecovery(USER, receipt))!.originalSnapshot.timestamp).toBeGreaterThan(
    Date.now(),
  );
  expect((await getRecovery(USER, receipt))!.state).toBe("resolved");
});
it("concurrent canonical edits reject the reviewed replacement and retain both originals", async () => {
  const receipt = await retainedNotebook();
  start();
  await loaded();
  const view = await inspect(`server:${receipt}`);
  await push([
    {
      ...mutation("notebook", 3),
      id: "concurrent",
      timestamp: Date.now(),
      data: {
        bookId: "entity",
        content: { type: "doc", content: [{ type: "text", text: "concurrent content" }] },
      },
    },
  ]);
  store.dispatch(runRecoveryCommand("submit_edit", view.token));
  await vi.waitFor(() => expect(store.state.syncRecovery.error).toMatch(/changed|review/i));
  expect((await getRecovery(USER, receipt))!.state).not.toBe("resolved");
  expect(
    (
      await db.query<{ content: unknown }>(
        "SELECT content FROM readmax.notebook WHERE user_id=$1",
        [USER],
      )
    ).rows[0].content,
  ).toMatchObject({ content: [{ text: "concurrent content" }] });
  expect(store.state.syncRecovery.view?.token).toBe(view.token);
});
it("network retries reuse the durable resolution identity after a lost success response", async () => {
  const receipt = await retainedNotebook();
  start();
  await loaded();
  const view = await inspect(`server:${receipt}`);
  loseResolveResponse = true;
  store.dispatch(runRecoveryCommand("keep_canonical", view.token));
  await vi.waitFor(() => expect(store.state.syncRecovery.error).not.toBeNull());
  expect((await getRecovery(USER, receipt))!.state).toBe("resolved");
  store.dispatch(runRecoveryCommand("keep_canonical", view.token));
  await vi.waitFor(() => expect(store.state.syncRecovery.notice).toContain("Decision saved"));
  expect(resolveCalls).toHaveLength(2);
  expect(resolveCalls[0]).toBe(resolveCalls[1]);
});
it("signed-out device snapshots survive server failures and discard requires the inspected revision", async () => {
  const local = await retainCustody({
    source: "notes",
    key: "notebook",
    role: "intended",
    raw: { content: "device-only text", updatedAt: NaN },
  });
  start(null);
  await loaded();
  const view = await inspect(`device:${local}`);
  expect(await bodyByUrl.get(view.url)!.text()).toContain("device-only text");
  expect(JSON.stringify(store.state.syncRecovery)).not.toContain("device-only text");
  store.dispatch(runRecoveryCommand("discard", "obsolete-view-token"));
  expect(await get(local, idbStores.getCustodyStore())).toBeDefined();
  store.dispatch(runRecoveryCommand("discard", view.token));
  await vi.waitFor(() => expect(store.state.syncRecovery.notice).toContain("discarded"));
  expect(await get(local, idbStores.getCustodyStore())).toBeUndefined();
});
it("account changes clear visible handles and reject late detail publication", async () => {
  const receipt = await retainedNotebook();
  start();
  await loaded();
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const response = await fetchRoute(url, init);
    if (url.endsWith(receipt)) await gate;
    return response;
  });
  store.dispatch(selectRecovery(`server:${receipt}`));
  setCustodyAccount(OTHER_USER);
  store.dispatch(authSessionResolved({ id: OTHER_USER, displayName: "Other" }));
  resume();
  await vi.waitFor(() => expect(store.state.syncRecovery.loading).toBe(false));
  expect(store.state.syncRecovery.selectedId).toBeNull();
  expect(store.state.syncRecovery.view).toBeNull();
  expect(bodyByUrl.size).toBe(0);
  setCustodyAccount(undefined);
  store.dispatch(authSessionCleared());
});

it("admits local-only invalid-clock text for comparison, then explicitly edits without retiring raw", async () => {
  await push([mutation("book"), mutation("notebook")]);
  const raw = {
    bookId: "entity",
    content: { type: "doc", content: [{ type: "text", text: "Local surviving text" }] },
    updatedAt: NaN,
    optional: undefined,
  };
  const id = await retainCustody({
    source: "ebook-reader-notebooks/notebooks",
    key: "entity",
    role: "intended",
    raw,
  });
  start();
  await loaded();
  const originalView = await inspect(`device:${id}`);
  expect(originalView.localText).toBe(true);
  store.dispatch(runRecoveryCommand("admit", originalView.token));
  await vi.waitFor(() =>
    expect(store.state.syncRecovery.notice).toContain("Content received for review"),
  );
  const reviewed = store.state.syncRecovery.view!;
  expect(reviewed.token).not.toBe(originalView.token);
  expect(reviewed.resolution?.state).toBe("needs_resolution");
  expect(await bodyByUrl.get(reviewed.url)!.text()).toContain("Local surviving text");
  expect(await bodyByUrl.get(reviewed.url)!.text()).toContain('"old"');
  expect(
    (
      await db.query<{ content: unknown }>(
        "SELECT content FROM readmax.notebook WHERE user_id=$1",
        [USER],
      )
    ).rows[0].content,
  ).toMatchObject({ content: [{ text: "old" }] });
  expect(JSON.stringify(store.state.syncRecovery)).not.toContain("Local surviving text");
  store.dispatch(runRecoveryCommand("submit_edit", reviewed.token));
  await vi.waitFor(() => expect(store.state.syncRecovery.notice).toContain("Decision saved"));
  expect(
    (
      await db.query<{ content: unknown }>(
        "SELECT content FROM readmax.notebook WHERE user_id=$1",
        [USER],
      )
    ).rows[0].content,
  ).toMatchObject({ content: [{ text: "Local surviving text" }] });
  const retained = await get(id, idbStores.getCustodyStore());
  expect(retained.raw.updatedAt).toBeNaN();
  expect(Object.hasOwn(retained.raw, "optional")).toBe(true);
});
