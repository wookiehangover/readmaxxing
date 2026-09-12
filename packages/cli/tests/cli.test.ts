// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../src/client";
import { loginUrl, normalizeUrl, readConfig, saveConfig } from "../src/config";
import { writeOutput, safeFilename } from "../src/output";
import { epubMetadata, uploadBook } from "../src/upload";
import { run } from "../src/main";
import { put } from "@vercel/blob/client";

vi.mock("@vercel/blob/client", () => ({ put: vi.fn() }));

const token = "12345678-1234-1234-1234-123456789abc";
const config = { url: "https://readmaxxing.example", token };
let directory: string;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "readmax-cli-"));
  vi.stubEnv("READMAXXING_CONFIG", join(directory, "config.json"));
  vi.stubEnv("READMAXXING_URL", config.url);
  vi.stubEnv("READMAXXING_TOKEN", token);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("credentials and transport", () => {
  it("defaults fresh installs and environment tokens to readmaxxing.app", async () => {
    delete process.env.READMAXXING_URL;
    expect(await loginUrl()).toBe("https://readmaxxing.app");
    expect(await readConfig()).toEqual({ url: "https://readmaxxing.app", token });
    delete process.env.READMAXXING_TOKEN;
    await expect(readConfig()).rejects.toThrow(
      "Not signed in to this server. Run readmaxxing login.",
    );
  });
  it("preserves explicit, environment, and saved URL precedence over the default", async () => {
    const saved = { url: "https://saved.example", token };
    await saveConfig(saved);
    expect(await loginUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(await loginUrl()).toBe(config.url);
    delete process.env.READMAXXING_URL;
    delete process.env.READMAXXING_TOKEN;
    expect(await loginUrl()).toBe(saved.url);
    expect(await readConfig()).toEqual(saved);
    await expect(readConfig("https://readmaxxing.app")).rejects.toThrow("Not signed in");
  });
  it("stores private credentials and never reuses them for a different origin", async () => {
    await saveConfig(config);
    delete process.env.READMAXXING_TOKEN;
    expect((await stat(join(directory, "config.json"))).mode & 0o777).toBe(0o600);
    expect(await readConfig()).toEqual(config);
    await expect(readConfig("https://different.example")).rejects.toThrow("Not signed in");
    expect(normalizeUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(() => normalizeUrl("http://example.com")).toThrow("HTTPS");
    expect(() => normalizeUrl("https://user:pass@example.com")).toThrow("origin");
  });
  it("sends the session only to the configured origin and disables redirects", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    const client = new Client(config);
    await client.json("/api/auth/session");
    const options = fetchMock.mock.calls[0][1]!;
    expect(new Headers(options.headers).get("cookie")).toBe(`readmax_session=${token}`);
    expect(options.redirect).toBe("error");
    await expect(client.request("https://evil.example/api")).rejects.toThrow("different server");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reports an expired session", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await expect(new Client(config).request("/api/sync/pull")).rejects.toThrow("login again");
  });
  it("collects every page, preserving opaque cursors and excluding tombstones", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        changes: [
          {
            entity: "book",
            records: [{ id: "one" }, { id: "deleted", deletedAt: "today" }],
            cursor: "opaque+cursor",
            hasMore: true,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({
        changes: [{ entity: "book", records: [{ id: "two" }], cursor: "last", hasMore: false }],
      }),
    );
    expect(await new Client(config).pull("book")).toEqual([{ id: "one" }, { id: "two" }]);
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(JSON.parse(url.searchParams.get("cursors")!)).toEqual([
      { entityType: "book", cursor: "opaque+cursor" },
    ]);
  });
});

describe("downloads and exports", () => {
  it("writes exact bytes and protects existing files", async () => {
    const path = join(directory, "book.epub");
    const bytes = new Uint8Array([0, 255, 10, 128]);
    const progress = vi.fn();
    await writeOutput(
      new Response(bytes, { headers: { "content-length": String(bytes.length) } }),
      path,
      false,
      progress,
    );
    expect(progress).toHaveBeenLastCalledWith(bytes.length, bytes.length);
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
    await expect(writeOutput(new Response("replacement"), path)).rejects.toThrow("File exists");
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
    await writeOutput(new Response("replacement"), path, true);
    expect(await readFile(path, "utf8")).toBe("replacement");
    const filename = safeFilename("../../bad\u001b[31m/title");
    expect(filename).not.toContain("/");
    expect(filename).not.toContain("\u001b");
  });
  it("does not leave partial downloads behind", async () => {
    const path = join(directory, "book.epub");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.error(new Error("connection lost"));
        },
      }),
    );
    await expect(writeOutput(response, path)).rejects.toThrow("connection lost");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("exports a book's notes as a Markdown file", async () => {
    const path = join(directory, "notes.md");
    fetchMock.mockResolvedValue(new Response("# Notes\n\n**Saved**\n"));
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await run(["export", "notes", "book/id", "-o", path]);
    expect(await readFile(path, "utf8")).toBe("# Notes\n\n**Saved**\n");
    expect(String(fetchMock.mock.calls[0][0])).toContain("bookId=book%2Fid");
  });
  it("rejects invalid commands and arguments before networking", async () => {
    await expect(run(["export", "outline", "--session", "abc"])).rejects.toThrow("Export kind");
    await expect(run(["upload"])).rejects.toThrow("Invalid arguments");
    await expect(run(["books", "--force"])).rejects.toThrow("not valid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("uploads", () => {
  it("reads metadata from the real EPUB fixture", async () => {
    const bytes = await readFile("e2e/fixtures/test-book.epub");
    const metadata = epubMetadata(bytes);
    expect(metadata.title).toBeTruthy();
    expect(metadata.author).toBeTruthy();
  });
  it("pushes metadata, uploads PDF bytes, and persists the URL", async () => {
    const path = join(directory, "Example.pdf");
    const bytes = Buffer.from("%PDF-1.4\nfixture");
    await writeFile(path, bytes);
    const pushed: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/auth/session") return Response.json({ user: { id: "user" } });
      if (url.pathname === "/api/sync/push") {
        const change = JSON.parse(String(init?.body)).changes[0];
        pushed.push(change.data);
        return Response.json({ accepted: [{ id: change.id }], rejected: [] });
      }
      if (new Headers(init?.headers).has("X-Readmax-Storage-Backend"))
        return Response.json({ backend: "local" });
      expect(init).toMatchObject({ duplex: "half" });
      expect(new Headers(init?.headers).get("content-length")).toBe(String(bytes.length));
      expect(Buffer.from(await new Response(init?.body as ReadableStream).arrayBuffer())).toEqual(
        bytes,
      );
      return Response.json({ url: "local://book.pdf" });
    });
    const progress = vi.fn();
    const result = await uploadBook(new Client(config), path, { author: "Writer" }, progress);
    expect(progress).toHaveBeenCalledWith({
      label: "Uploading book",
      loaded: bytes.length,
      total: bytes.length,
    });
    expect(progress).toHaveBeenLastCalledWith({ label: "Saving book" });
    expect(result).toMatchObject({ title: "Example", author: "Writer", format: "pdf" });
    expect(pushed[0].fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pushed[1]).toMatchObject({ remoteFileUrl: "local://book.pdf" });
  });
  it("uses a canonical duplicate without reuploading", async () => {
    const path = join(directory, "Example.pdf");
    await writeFile(path, "%PDF-1.4\nfixture");
    fetchMock.mockResolvedValueOnce(Response.json({ user: { id: "user" } }));
    fetchMock.mockImplementationOnce(async (_url, init) =>
      Response.json({
        accepted: [{ id: JSON.parse(String(init?.body)).changes[0].id, canonicalId: "canonical" }],
        rejected: [],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({
        changes: [
          {
            entity: "book",
            records: [{ id: "canonical", title: "Original title", fileBlobUrl: "existing" }],
            hasMore: false,
          },
        ],
      }),
    );
    expect(await uploadBook(new Client(config), path, {})).toMatchObject({
      id: "canonical",
      title: "Original title",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uploads to Vercel with a scoped token and persists the returned URL", async () => {
    const path = join(directory, "Example.pdf");
    await writeFile(path, "%PDF-1.4\nfixture");
    const remoteFileUrl = "https://store.private.blob.vercel-storage.com/books/user/book/book.pdf";
    vi.mocked(put).mockResolvedValue({ url: remoteFileUrl } as Awaited<ReturnType<typeof put>>);
    let persisted = false;
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/auth/session") return Response.json({ user: { id: "user" } });
      if (url.pathname === "/api/sync/push") {
        const change = JSON.parse(String(init?.body)).changes[0];
        if (change.data.remoteFileUrl === remoteFileUrl) persisted = true;
        return Response.json({ accepted: [{ id: change.id }], rejected: [] });
      }
      if (new Headers(init?.headers).has("X-Readmax-Storage-Backend"))
        return Response.json({ backend: "vercel" });
      const payload = JSON.parse(String(init?.body));
      expect(payload.type).toBe("blob.generate-client-token");
      expect(payload.payload.pathname).toMatch(/^books\/user\/.+\/book.pdf$/);
      expect(JSON.parse(payload.payload.clientPayload)).toMatchObject({ type: "file" });
      return Response.json({ clientToken: "scoped-blob-token" });
    });
    const progress = vi.fn();
    vi.mocked(put).mockImplementationOnce(async (_path, body, options) => {
      const total = (body as Blob).size;
      options.onUploadProgress?.({ loaded: total, total, percentage: 100 });
      return { url: remoteFileUrl } as Awaited<ReturnType<typeof put>>;
    });
    const result = await uploadBook(new Client(config), path, {}, progress);
    expect(progress).toHaveBeenCalledWith({ label: "Uploading book", loaded: 16, total: 16 });
    expect(result.fileBlobUrl).toBe(remoteFileUrl);
    expect(persisted).toBe(true);
    expect(put).toHaveBeenCalledWith(expect.any(String), expect.any(Blob), {
      access: "private",
      token: "scoped-blob-token",
      contentType: "application/pdf",
      multipart: true,
      onUploadProgress: expect.any(Function),
    });
  });
});
