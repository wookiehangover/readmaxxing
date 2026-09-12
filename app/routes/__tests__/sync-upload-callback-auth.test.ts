// @vitest-environment node
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import type { SQLQuery } from "pg-sql";
import { handleUpload, getPayloadFromClientToken } from "@vercel/blob/client";

// Real SDK, session authentication and SQL; only adapt pg's transport to PGlite.
const transport = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/lib/database/pool", () => ({
  getPool: () => ({
    query: transport.query,
    connect: async () => ({ query: transport.query, release: () => {} }),
  }),
}));
import { action } from "../api.sync.files.upload";
import { getRecoveryBook } from "~/lib/database/sync-delivery/recovery-book";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const SESSION = "00000000-0000-4000-8000-000000000003";
const SECRET = "vercel_blob_rw_disposable_verification_secret";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  for (const path of [
    "database/readmax/core.sql",
    "database/readmax/annotations.sql",
    "database/readmax/chat.sql",
    "database/readmax/settings.sql",
    "database/migrations/008-bookmarks.sql",
    "database/migrations/009-bookmark-display-page.sql",
    "database/migrations/021-sync-mutation-ordering.sql",
    "database/migrations/022-book-canonical-alias.sql",
    "database/migrations/023-sync-delivery-custody.sql",
    "database/migrations/024-sync-recovery-admission.sql",
  ])
    await db.exec(await readFile(path, "utf8"));
  await db.query("INSERT INTO readmax.user(id) VALUES($1),($2)", [OWNER, OTHER]);
}, 30_000);
beforeEach(async () => {
  await db.exec(
    "TRUNCATE readmax.book,readmax.sync_resource_binding,readmax.sync_alias_event,readmax.sync_alias_revision,readmax.session CASCADE",
  );
  await db.query(
    "INSERT INTO readmax.book(id,user_id,title,file_blob_url) VALUES('book',$1,'reviewed','https://blob.test/original')",
    [OWNER],
  );
  await db.query(
    "INSERT INTO readmax.session(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [SESSION, OWNER],
  );
  transport.query.mockReset().mockImplementation(async (query: SQLQuery | string) => {
    if (typeof query !== "string" && query.text.includes("pg_advisory_xact_lock"))
      return { rows: [], rowCount: 1 };
    const result =
      typeof query === "string" ? await db.query(query) : await db.query(query.text, query.values);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  });
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  vi.stubEnv("BLOB_STORAGE_BACKEND", "vercel");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", SECRET);
  vi.stubEnv("VERCEL_BLOB_CALLBACK_URL", "https://test.invalid/api/sync/files/upload");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db.close());
async function completion(owner = OWNER) {
  const version = (await getRecoveryBook(OWNER, "book")).canonical.version;
  const pathname = `books/${owner}/book/selected-unique.pdf`;
  return {
    type: "blob.upload-completed" as const,
    payload: {
      blob: {
        url: `https://test.public.blob.vercel-storage.com/${pathname}`,
        pathname,
        etag: "selected-etag",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        downloadUrl: "https://test.invalid/file",
      },
      tokenPayload: JSON.stringify({
        userId: owner,
        bookId: "book",
        type: "file",
        recovery: { ownerId: owner, expectedCanonicalVersion: version },
      }),
    },
  };
}
function request(body: unknown, signature?: string, cookie?: string) {
  return new Request("https://test.invalid/api/sync/files/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "x-vercel-signature": signature } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
const sign = (body: unknown) =>
  createHmac("sha256", SECRET).update(JSON.stringify(body)).digest("hex");
async function current() {
  return (
    await db.query<{ file_blob_url: string }>(
      "SELECT file_blob_url FROM readmax.book WHERE id='book'",
    )
  ).rows[0].file_blob_url;
}

it("real SDK accepts the correctly signed service callback without a session", async () => {
  const body = await completion(),
    completed = vi.fn();
  expect(
    await handleUpload({
      token: SECRET,
      request: request(body, sign(body)),
      body,
      onBeforeGenerateToken: async () => ({}),
      onUploadCompleted: completed,
    }),
  ).toMatchObject({ response: "ok" });
  expect(completed).toHaveBeenCalledWith(body.payload);
});
it.each([undefined, "readmax_session=expired", `readmax_session=${SESSION}`])(
  "signed cookie-free or stale-cookie callback publishes using signed owner (%s)",
  async (cookie) => {
    const body = await completion();
    if (cookie === `readmax_session=${SESSION}`)
      await db.query("UPDATE readmax.session SET user_id=$1 WHERE id=$2", [OTHER, SESSION]);
    const response = await action({ request: request(body, sign(body), cookie) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ response: "ok" });
    expect(await current()).toBe(body.payload.blob.url);
    expect(
      transport.query.mock.calls.some(
        ([query]) => typeof query !== "string" && query.text.includes("FROM readmax.session"),
      ),
    ).toBe(false);
  },
);
it.each(["missing", "invalid", "tampered"])(
  "rejects %s signature before any SQL publication",
  async (kind) => {
    const body = await completion();
    const signature =
      kind === "missing" ? undefined : kind === "invalid" ? "00".repeat(32) : sign(body);
    if (kind === "tampered") body.payload.blob.url += "-tampered";
    const count = transport.query.mock.calls.length;
    const response = await action({
      request: request(body, signature, `readmax_session=${SESSION}`),
    });
    expect(response.status).toBe(400);
    expect(transport.query).toHaveBeenCalledTimes(count);
    expect(await current()).toBe("https://blob.test/original");
  },
);
it.each(["foreign", "deleted", "alias", "changed"])(
  "valid signature cannot publish to a %s target",
  async (state) => {
    const body = await completion(state === "foreign" ? OTHER : OWNER);
    if (state === "deleted")
      await db.query("UPDATE readmax.book SET deleted_at=now() WHERE id='book'");
    if (state === "changed")
      await db.query("UPDATE readmax.book SET title='newer' WHERE id='book'");
    if (state === "alias") {
      await db.query("INSERT INTO readmax.book(id,user_id) VALUES('canonical',$1)", [OWNER]);
      await db.query("UPDATE readmax.book SET canonical_id='canonical' WHERE id='book'");
    }
    const response = await action({ request: request(body, sign(body)) });
    expect(response.status).toBe(state === "changed" ? 409 : 400);
    expect(await current()).toBe("https://blob.test/original");
  },
);
it("a valid signature cannot override a different recovery guard owner", async () => {
  const body = await completion();
  const payload = JSON.parse(body.payload.tokenPayload);
  payload.recovery.ownerId = OTHER;
  body.payload.tokenPayload = JSON.stringify(payload);
  expect((await action({ request: request(body, sign(body)) })).status).toBe(409);
  expect(await current()).toBe("https://blob.test/original");
});

it("signed completion does not acknowledge a failed SQL publication", async () => {
  const body = await completion();
  await db.exec(`CREATE OR REPLACE FUNCTION readmax.reject_callback_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'publication unavailable'; END $$;
    CREATE TRIGGER reject_callback_publication BEFORE UPDATE ON readmax.book
    FOR EACH ROW EXECUTE FUNCTION readmax.reject_callback_publication();`);
  try {
    const response = await action({ request: request(body, sign(body)) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "publication unavailable" });
    expect(await current()).toBe("https://blob.test/original");
  } finally {
    await db.exec("DROP TRIGGER reject_callback_publication ON readmax.book");
  }
});

it("browser issuance still requires a valid session and returns an owner-bound signed token", async () => {
  const body = {
    type: "blob.generate-client-token",
    payload: {
      pathname: `books/${OWNER}/book/selected.pdf`,
      clientPayload: JSON.stringify({
        bookId: "book",
        type: "file",
        recovery: {
          ownerId: OWNER,
          expectedCanonicalVersion: (await getRecoveryBook(OWNER, "book")).canonical.version,
        },
      }),
      multipart: false,
    },
  };
  expect((await action({ request: request(body) })).status).toBe(401);
  expect(
    (await action({ request: request(body, sign(body), "readmax_session=expired") })).status,
  ).toBe(401);
  const result = await action({ request: request(body, undefined, `readmax_session=${SESSION}`) });
  expect(result.status).toBe(200);
  const token = getPayloadFromClientToken((await result.json()).clientToken);
  expect(JSON.parse(token.onUploadCompleted!.tokenPayload!)).toMatchObject({
    userId: OWNER,
    bookId: "book",
    recovery: { ownerId: OWNER },
  });
  expect(token).toMatchObject({ allowOverwrite: false, addRandomSuffix: true });
});
