import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidEbookPath } from "~/routes/api.standard-ebooks.download";

describe("isValidEbookPath", () => {
  describe("valid paths", () => {
    it.each([
      "/ebooks/jane-austen/pride-and-prejudice",
      "/ebooks/leo-tolstoy/war-and-peace",
      "/ebooks/h-g-wells/the-time-machine",
      "/ebooks/mark-twain/adventures-of-huckleberry-finn",
      "/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett",
    ])("accepts %s", (path) => {
      expect(isValidEbookPath(path)).toBe(true);
    });
  });

  describe("SSRF payloads", () => {
    it.each([
      ["@evil.com", "@ redirects host via URL userinfo syntax"],
      ["@169.254.169.254/latest/meta-data", "@ targeting cloud metadata endpoint"],
      ["@internal-service:8080/secret", "@ targeting internal service"],
    ])("rejects %s (%s)", (path) => {
      expect(isValidEbookPath(path)).toBe(false);
    });
  });

  describe("path traversal and injection", () => {
    it.each([
      ["/../../../etc/passwd", "path traversal with .."],
      ["/ebooks/../../../etc/passwd", "path traversal after /ebooks/"],
      ["/ebooks/foo%00bar", "null byte injection"],
      ["/ebooks/foo\nHost: evil.com", "header injection via newline"],
      ["/ebooks/foo\\bar", "backslash"],
    ])("rejects %s (%s)", (path) => {
      expect(isValidEbookPath(path)).toBe(false);
    });
  });

  describe("missing or malformed prefix", () => {
    it.each([
      ["", "empty string"],
      ["/", "root"],
      ["/ebooks/", "trailing slash only"],
      ["/ebooks", "no trailing content"],
      ["/books/some-author/some-title", "wrong prefix"],
      ["ebooks/jane-austen/pride-and-prejudice", "missing leading slash"],
    ])("rejects %s (%s)", (path) => {
      expect(isValidEbookPath(path)).toBe(false);
    });
  });

  describe("special characters", () => {
    it.each([
      ["/ebooks/foo/bar?query=1", "query string"],
      ["/ebooks/foo/bar#fragment", "fragment"],
      ["/ebooks/foo/bar ", "trailing space"],
      [" /ebooks/foo/bar", "leading space"],
      ["/ebooks/foo/bar/", "trailing slash"],
    ])("rejects %s (%s)", (path) => {
      expect(isValidEbookPath(path)).toBe(false);
    });
  });
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { loader } = await import("~/routes/api.standard-ebooks.download");

function makeRequest(path?: string): Request {
  const base = "http://localhost:3000/api/standard-ebooks/download";
  const url = path != null ? `${base}?path=${encodeURIComponent(path)}` : base;
  return new Request(url);
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("loader", () => {
  it("returns 400 when path is missing", async () => {
    await expect(loader({ request: makeRequest(), params: {} } as any)).rejects.toSatisfy(
      (r: Response) => r.status === 400,
    );
  });

  it("returns 400 for an SSRF path with @", async () => {
    await expect(
      loader({ request: makeRequest("@evil.com"), params: {} } as any),
    ).rejects.toSatisfy((r: Response) => r.status === 400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for path traversal", async () => {
    await expect(
      loader({ request: makeRequest("/../../../etc/passwd"), params: {} } as any),
    ).rejects.toSatisfy((r: Response) => r.status === 400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches from standardebooks.org for a valid path", async () => {
    const epub = new ArrayBuffer(8);
    fetchMock.mockResolvedValue(new Response(epub, { status: 200 }));

    const response = await loader({
      request: makeRequest("/ebooks/jane-austen/pride-and-prejudice"),
      params: {},
    } as any);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("https://standardebooks.org/ebooks/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/epub+zip");
  });
});
