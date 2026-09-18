// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  output: vi.fn(),
  run: vi.fn(),
  wait: vi.fn(),
}));
vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("~/lib/repair/repair-jobs.server", () => ({
  getRepairJob: mocks.get,
  createRepairJob: mocks.create,
  readRepairOutput: mocks.output,
}));
vi.mock("~/lib/repair/repair-runner.server", () => ({ runRepairJob: mocks.run }));
vi.mock("@vercel/functions", () => ({ waitUntil: mocks.wait }));
import { action, loader } from "../api.book-repair.$bookId";

const params = { bookId: "local-book" };
function post(
  body: Uint8Array = new Uint8Array([0x50, 0x4b, 3, 4]),
  origin = "https://reader.test",
) {
  return {
    params,
    request: new Request("https://reader.test/api/book-repair/local-book", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/epub+zip" },
      body: body as BodyInit,
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "configured");
  vi.stubEnv("AI_GATEWAY_API_KEY", "configured");
  vi.stubEnv("REPAIR_SANDBOX_SNAPSHOT_ID", "snapshot");
  mocks.auth.mockResolvedValue({ userId: "owner" });
  mocks.get.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "job", status: "running" });
  mocks.run.mockResolvedValue(undefined);
});
it("requires authentication", async () => {
  mocks.auth.mockResolvedValue(null);
  await expect(action(post())).rejects.toMatchObject({ status: 401 });
  expect(mocks.create).not.toHaveBeenCalled();
});
it("rejects cross-origin launches and non-EPUB input", async () => {
  expect((await action(post(undefined, "https://elsewhere.test"))).status).toBe(403);
  expect((await action(post(new Uint8Array([1, 2, 3, 4])))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("fails clearly when the sandbox is not configured", async () => {
  vi.stubEnv("REPAIR_SANDBOX_SNAPSHOT_ID", "");
  expect((await action(post())).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("deduplicates a running job and starts new work in the background", async () => {
  mocks.get.mockResolvedValueOnce({ id: "existing", status: "running" });
  expect(await (await action(post())).json()).toMatchObject({ job: { id: "existing" } });
  expect(mocks.run).not.toHaveBeenCalled();
  expect((await action(post())).status).toBe(202);
  expect(mocks.create).toHaveBeenCalledWith(
    "owner",
    "local-book",
    expect.stringMatching(/^[a-f0-9]{64}$/),
  );
  expect(mocks.wait).toHaveBeenCalledOnce();
});
it("scopes output to the authenticated owner and selected book", async () => {
  const id = "12345678-1234-4123-8123-123456789012";
  mocks.output.mockResolvedValue(null);
  const result = await loader({
    params,
    request: new Request(`https://reader.test/api/book-repair/local-book?jobId=${id}&download=1`),
  });
  expect(result.status).toBe(404);
  expect(mocks.output).toHaveBeenCalledWith("owner", "local-book", id);
});
