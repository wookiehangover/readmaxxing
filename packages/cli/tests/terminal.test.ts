// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity, listing, tone } from "../src/terminal";
import { run } from "../src/main";

const ttyDescriptors = [process.stdout, process.stderr].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY"),
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TERM", "xterm-256color");
  vi.stubEnv("CI", "");
  vi.stubEnv("NO_COLOR", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  [process.stdout, process.stderr].forEach((stream, index) => {
    const descriptor = ttyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, "isTTY", descriptor);
    else Reflect.deleteProperty(stream, "isTTY");
  });
});

function capture(tty: boolean) {
  for (const stream of [process.stderr, process.stdout])
    Object.defineProperty(stream, "isTTY", { configurable: true, value: tty });
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return { stderr, stdout };
}

describe("terminal output", () => {
  it("keeps redirected listings as TSV and emits no animation", async () => {
    const { stderr, stdout } = capture(false);
    await new Activity("Loading").during(async () => vi.advanceTimersByTime(200));
    listing(["ID", "TITLE"], [["id", "A\nB\x1b[31m"]], "Empty");
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("ID\tTITLE\nid\tA B\n");
  });

  it("clears progress after failure, stops its timer, and never touches stdout", async () => {
    const { stderr, stdout } = capture(true);
    const activity = new Activity("Uploading");
    activity.update({ label: "Uploading", loaded: 512, total: 1024 });
    vi.advanceTimersByTime(80);
    expect(stderr.mock.calls.flat().join("")).toContain("50%");
    await expect(
      activity.during(async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(stderr).toHaveBeenLastCalledWith("\r\x1b[2K");
    const count = stderr.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(stderr).toHaveBeenCalledTimes(count);
    expect(stdout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors NO_COLOR, dumb terminals, and CI", async () => {
    const { stderr } = capture(true);
    vi.stubEnv("NO_COLOR", "1");
    expect(tone("text", 36)).toBe("text");
    vi.stubEnv("TERM", "dumb");
    await new Activity("Loading").during(async () => vi.advanceTimersByTime(160));
    vi.stubEnv("TERM", "xterm");
    vi.stubEnv("CI", "1");
    await new Activity("Loading").during(async () => vi.advanceTimersByTime(160));
    expect(stderr).not.toHaveBeenCalled();
  });

  it("offers command-specific help without reading credentials or networking", async () => {
    const { stdout } = capture(false);
    vi.stubEnv("READMAXXING_CONFIG", "/does/not/exist/config.json");
    await run(["upload", "--help"]);
    const output = String(stdout.mock.calls[0][0]);
    expect(output).toContain("--author");
    expect(output).not.toContain("--session");
    expect(output).not.toContain("localhost callback");
    stdout.mockClear();
    await run(["help", "upload"]);
    expect(stdout).toHaveBeenCalledWith(output);
  });

  it("prints valid JSON with no terminal styles or status mixed in", async () => {
    const { stdout } = capture(true);
    vi.stubEnv("READMAXXING_CONFIG", "/does/not/exist/config.json");
    vi.stubEnv("READMAXXING_URL", "https://readmaxxing.app");
    vi.stubEnv("READMAXXING_TOKEN", "12345678-1234-1234-1234-123456789abc");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        changes: [{ entity: "book", records: [{ id: "one", title: "Book" }], hasMore: false }],
      }),
    );
    await run(["books", "--json"]);
    expect(JSON.parse(stdout.mock.calls.map(([value]) => value).join(""))).toEqual([
      { id: "one", title: "Book" },
    ]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
