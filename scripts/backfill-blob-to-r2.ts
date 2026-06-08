import { createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { r2StorageUrl, type StoredBlobType } from "../app/lib/blob-url";

type BlobColumn = "fileBlobUrl" | "coverBlobUrl";

interface BookRow {
  readonly id: string;
  readonly userId: string;
  readonly fileBlobUrl: string | null;
  readonly coverBlobUrl: string | null;
}

interface MigrationItem {
  readonly bookId: string;
  readonly userId: string;
  readonly type: StoredBlobType;
  readonly column: BlobColumn;
  readonly oldUrl: string;
}

interface MigratedItem extends MigrationItem {
  readonly key: string;
  readonly storageUrl: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly migratedAtISO: string;
}

interface CliOptions {
  readonly help: boolean;
  readonly dryRun: boolean;
  readonly resumeFrom?: string;
  readonly concurrency: number;
  readonly auditCsv?: string;
  readonly databaseUrl?: string;
  readonly blobToken?: string;
  readonly r2AccountId?: string;
  readonly r2AccessKeyId?: string;
  readonly r2SecretAccessKey?: string;
  readonly r2FilesBucket?: string;
  readonly r2CoversBucket?: string;
}

interface RuntimeConfig {
  readonly dryRun: boolean;
  readonly resumeFrom?: string;
  readonly concurrency: number;
  readonly auditCsv?: string;
  readonly databaseUrl: string;
  readonly blobToken: string;
  readonly r2: R2Config;
}

interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly filesBucket: string;
  readonly coversBucket: string;
}

interface BlobBytes {
  readonly body: Buffer;
  readonly bytes: number;
  readonly sha256: string;
}

const VERCEL_BLOB_PATTERN = "%blob.vercel-storage.com%";
const COVER_CACHE_CONTROL = "private, max-age=31536000, immutable";

function isLegacyVercelBlobUrl(value: string): boolean {
  try {
    return new URL(value).host.includes("blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function classifyBookStorage(row: BookRow): MigrationItem[] {
  const items: MigrationItem[] = [];
  if (row.fileBlobUrl && isLegacyVercelBlobUrl(row.fileBlobUrl)) {
    items.push({
      bookId: row.id,
      userId: row.userId,
      type: "file",
      column: "fileBlobUrl",
      oldUrl: row.fileBlobUrl,
    });
  }
  if (row.coverBlobUrl && isLegacyVercelBlobUrl(row.coverBlobUrl)) {
    items.push({
      bookId: row.id,
      userId: row.userId,
      type: "cover",
      column: "coverBlobUrl",
      oldUrl: row.coverBlobUrl,
    });
  }
  return items;
}

export function deriveR2ObjectKey(input: {
  readonly type: StoredBlobType;
  readonly userId: string;
  readonly bookId: string;
  readonly contentType?: string | null;
  readonly sourceUrl?: string;
}): string {
  const extension = extensionForStorage(input.type, input.contentType, input.sourceUrl);
  const prefix = input.type === "cover" ? "covers" : "books";
  const fileName = input.type === "cover" ? `cover.${extension}` : `book.${extension}`;
  return `${prefix}/${pathSegment(input.userId)}/${pathSegment(input.bookId)}/${fileName}`;
}

function extensionForStorage(
  type: StoredBlobType,
  contentType?: string | null,
  sourceUrl?: string,
): string {
  const normalized = normalizeContentType(contentType);
  switch (normalized) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    case "application/epub+zip":
      return "epub";
    default:
      return extensionFromUrl(type, sourceUrl);
  }
}

function extensionFromUrl(type: StoredBlobType, sourceUrl?: string): string {
  if (sourceUrl) {
    try {
      const pathname = new URL(sourceUrl).pathname.toLowerCase();
      const match = pathname.match(/\.([a-z0-9]+)$/);
      const ext = match?.[1];
      if (type === "file" && (ext === "pdf" || ext === "epub")) return ext;
      if (
        type === "cover" &&
        (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp")
      ) {
        return ext === "jpeg" ? "jpg" : ext;
      }
    } catch {
      // Fall through to the same defaults as the upload route.
    }
  }
  return type === "cover" ? "jpg" : "epub";
}

function normalizeContentType(value?: string | null): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function parseCli(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  let dryRun = false;
  let help = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    const rawName = equalsIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : withoutPrefix.slice(equalsIndex + 1);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${rawName}`);
    values.set(rawName, value);
  }

  const concurrency = Number(values.get("concurrency") ?? "5");
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }

  return {
    help,
    dryRun,
    concurrency,
    resumeFrom: values.get("resume-from"),
    auditCsv: values.get("audit-csv"),
    databaseUrl: values.get("database-url"),
    blobToken: values.get("blob-read-write-token"),
    r2AccountId: values.get("r2-account-id"),
    r2AccessKeyId: values.get("r2-access-key-id"),
    r2SecretAccessKey: values.get("r2-secret-access-key"),
    r2FilesBucket: values.get("r2-files-bucket"),
    r2CoversBucket: values.get("r2-covers-bucket"),
  };
}

async function loadDotEnvLocal(): Promise<void> {
  if (!existsSync(".env.local")) return;
  const content = await readFile(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function buildConfig(options: CliOptions): RuntimeConfig {
  const env = process.env;
  const config = {
    dryRun: options.dryRun,
    resumeFrom: options.resumeFrom,
    concurrency: options.concurrency,
    auditCsv: options.auditCsv,
    databaseUrl: options.databaseUrl ?? env.DATABASE_URL,
    blobToken: options.blobToken ?? env.BLOB_READ_WRITE_TOKEN,
    r2: {
      accountId: options.r2AccountId ?? env.R2_ACCOUNT_ID,
      accessKeyId: options.r2AccessKeyId ?? env.R2_ACCESS_KEY_ID,
      secretAccessKey: options.r2SecretAccessKey ?? env.R2_SECRET_ACCESS_KEY,
      filesBucket: options.r2FilesBucket ?? env.R2_FILES_BUCKET,
      coversBucket: options.r2CoversBucket ?? env.R2_COVERS_BUCKET,
    },
  };

  const missing = [
    ["DATABASE_URL", config.databaseUrl],
    ["BLOB_READ_WRITE_TOKEN", config.blobToken],
    ["R2_ACCOUNT_ID", config.r2.accountId],
    ["R2_ACCESS_KEY_ID", config.r2.accessKeyId],
    ["R2_SECRET_ACCESS_KEY", config.r2.secretAccessKey],
    ["R2_FILES_BUCKET", config.r2.filesBucket],
    ["R2_COVERS_BUCKET", config.r2.coversBucket],
  ].flatMap(([name, value]) => (value ? [] : [name]));

  if (missing.length > 0) throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  return config as RuntimeConfig;
}

async function selectRows(pool: Pool, resumeFrom?: string): Promise<BookRow[]> {
  const result = await pool.query<BookRow>(
    `
      SELECT id,
             user_id AS "userId",
             file_blob_url AS "fileBlobUrl",
             cover_blob_url AS "coverBlobUrl"
      FROM readmax.book
      WHERE (file_blob_url ILIKE $1 OR cover_blob_url ILIKE $1)
        AND ($2::text IS NULL OR id >= $2)
      ORDER BY id ASC
    `,
    [VERCEL_BLOB_PATTERN, resumeFrom ?? null],
  );
  return result.rows;
}

async function migrateBook(row: BookRow, pool: Pool, config: RuntimeConfig): Promise<number> {
  const items = classifyBookStorage(row);
  if (items.length === 0) return 0;

  if (config.dryRun) {
    for (const item of items) {
      const key = deriveR2ObjectKey({
        type: item.type,
        userId: item.userId,
        bookId: item.bookId,
        sourceUrl: item.oldUrl,
      });
      console.log(
        `[dry-run] ${item.bookId} ${item.type}: ${item.oldUrl} -> ${r2StorageUrl(item.type, key)}`,
      );
      await writeAuditRow(config.auditCsv, {
        bookId: item.bookId,
        oldUrl: item.oldUrl,
        newKey: key,
        bytes: "",
        sha256: "",
        migratedAtISO: "",
      });
    }
    return items.length;
  }

  const migrated: MigratedItem[] = [];
  for (const item of items) {
    const result = await downloadVercelBlob(item.oldUrl, config.blobToken);

    const key = deriveR2ObjectKey({
      type: item.type,
      userId: item.userId,
      bookId: item.bookId,
      contentType: result.contentType,
      sourceUrl: item.oldUrl,
    });
    const bytes = await readStreamBytes(result.stream);
    await putR2Object(config.r2, item.type, key, bytes.body, result.contentType);

    const migratedItem = {
      ...item,
      key,
      storageUrl: r2StorageUrl(item.type, key),
      bytes: bytes.bytes,
      sha256: bytes.sha256,
      migratedAtISO: new Date().toISOString(),
    };
    migrated.push(migratedItem);
    await writeAuditRow(config.auditCsv, {
      bookId: migratedItem.bookId,
      oldUrl: migratedItem.oldUrl,
      newKey: migratedItem.key,
      bytes: String(migratedItem.bytes),
      sha256: migratedItem.sha256,
      migratedAtISO: migratedItem.migratedAtISO,
    });
    console.log(
      `[uploaded] ${item.bookId} ${item.type}: ${item.oldUrl} -> ${migratedItem.storageUrl} (${bytes.bytes} bytes)`,
    );
  }

  await updateBookRow(pool, row.id, migrated);
  console.log(`[updated] ${row.id}: ${migrated.length} reference(s) now point at R2`);
  return migrated.length;
}

async function downloadVercelBlob(
  url: string,
  token: string,
): Promise<{ readonly stream: ReadableStream<Uint8Array>; readonly contentType: string }> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to read Vercel Blob object: ${response.status} ${response.statusText} ${text}`,
    );
  }
  return {
    stream: response.body,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<BlobBytes> {
  const reader = stream.getReader();
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    bytes += chunk.byteLength;
    hash.update(chunk);
  }

  return { body: Buffer.concat(chunks, bytes), bytes, sha256: hash.digest("hex") };
}

async function updateBookRow(pool: Pool, bookId: string, migrated: MigratedItem[]): Promise<void> {
  const file = migrated.find((item) => item.column === "fileBlobUrl");
  const cover = migrated.find((item) => item.column === "coverBlobUrl");
  const sets: string[] = [];
  const values: string[] = [];

  if (file) {
    values.push(file.storageUrl);
    sets.push(`file_blob_url = $${values.length}`);
  }
  if (cover) {
    values.push(cover.storageUrl);
    sets.push(`cover_blob_url = $${values.length}`);
  }
  if (sets.length === 0) return;

  values.push(bookId);
  await pool.query(
    `UPDATE readmax.book SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${values.length}`,
    values,
  );
}

async function putR2Object(
  config: R2Config,
  type: StoredBlobType,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const bucket = type === "cover" ? config.coversBucket : config.filesBucket;
  const url = new URL(
    `https://${config.accountId}.r2.cloudflarestorage.com/${bucket}/${encodeS3Key(key)}`,
  );
  const contentDisposition =
    type === "cover" ? "inline" : `attachment; filename="${key.split("/").at(-1) ?? "book.epub"}"`;
  const headers: Record<string, string> = {
    "content-disposition": contentDisposition,
    "content-length": String(body.byteLength),
    "content-type": contentType || "application/octet-stream",
    host: url.host,
    "x-amz-content-sha256": createHash("sha256").update(body).digest("hex"),
    "x-amz-date": amzTimestamp(new Date()),
  };
  if (type === "cover") headers["cache-control"] = COVER_CACHE_CONTROL;

  headers.authorization = signR2Request({
    method: "PUT",
    url,
    headers,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: new Blob([new Uint8Array(body)]),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `R2 upload failed for ${bucket}/${key}: ${response.status} ${response.statusText} ${text}`,
    );
  }
}

function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

function signR2Request(input: {
  readonly method: string;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}): string {
  const date = input.headers["x-amz-date"].slice(0, 8);
  const credentialScope = `${date}/auto/s3/aws4_request`;
  const signedHeaders = Object.keys(input.headers)
    .filter((name) => name !== "authorization")
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${input.headers[name].trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    input.url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders.join(";"),
    input.headers["x-amz-content-sha256"],
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.headers["x-amz-date"],
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(input.secretAccessKey, date))
    .update(stringToSign)
    .digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`;
}

function signingKey(secret: string, date: string): Buffer {
  const dateKey = createHmac("sha256", `AWS4${secret}`).update(date).digest();
  const regionKey = createHmac("sha256", dateKey).update("auto").digest();
  const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
  return createHmac("sha256", serviceKey).update("aws4_request").digest();
}

function amzTimestamp(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function writeAuditHeader(path?: string): Promise<void> {
  if (!path) return;
  await writeFile(path, "bookId,oldUrl,newKey,bytes,sha256,migratedAtISO\n", "utf8");
}

async function writeAuditRow(
  path: string | undefined,
  row: {
    readonly bookId: string;
    readonly oldUrl: string;
    readonly newKey: string;
    readonly bytes: string;
    readonly sha256: string;
    readonly migratedAtISO: string;
  },
): Promise<void> {
  if (!path) return;
  await appendFile(
    path,
    [row.bookId, row.oldUrl, row.newKey, row.bytes, row.sha256, row.migratedAtISO]
      .map(csvEscape)
      .join(",") + "\n",
    "utf8",
  );
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

function helpText(): string {
  return `Backfill Vercel Blob book objects into Cloudflare R2.

Usage:
  pnpm exec tsx scripts/backfill-blob-to-r2.ts [options]

Options:
  --dry-run                         Print the migration plan without downloads, R2 writes, or DB updates.
  --resume-from <bookId>            Start from this book id in id-sorted order.
  --concurrency <n>                 Number of books to process concurrently (default: 5).
  --audit-csv <path>                Write bookId,oldUrl,newKey,bytes,sha256,migratedAtISO rows.
  --database-url <url>              Overrides DATABASE_URL.
  --blob-read-write-token <token>   Overrides BLOB_READ_WRITE_TOKEN.
  --r2-account-id <id>              Overrides R2_ACCOUNT_ID.
  --r2-access-key-id <id>           Overrides R2_ACCESS_KEY_ID.
  --r2-secret-access-key <secret>   Overrides R2_SECRET_ACCESS_KEY.
  --r2-files-bucket <name>          Overrides R2_FILES_BUCKET.
  --r2-covers-bucket <name>         Overrides R2_COVERS_BUCKET.
  -h, --help                        Show this help.
`;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }

  await loadDotEnvLocal();
  const config = buildConfig(options);
  await writeAuditHeader(config.auditCsv);

  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const rows = await selectRows(pool, config.resumeFrom);
    console.log(`Found ${rows.length} book row(s) with legacy Vercel Blob references.`);
    let migrated = 0;
    let failed = 0;

    await runPool(rows, config.concurrency, async (row) => {
      try {
        migrated += await migrateBook(row, pool, config);
      } catch (error) {
        failed++;
        console.error(`[failed] ${row.id}:`, error);
      }
    });

    console.log(`${config.dryRun ? "Planned" : "Migrated"} ${migrated} object reference(s).`);
    if (failed > 0) {
      throw new Error(
        `${failed} book row(s) failed. Re-run with --resume-from after fixing the cause.`,
      );
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
